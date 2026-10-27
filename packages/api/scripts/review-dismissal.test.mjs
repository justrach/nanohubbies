import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
const names=['review/store','repository/store','repository/policy','repository/codeowners'];
const output=await build({entryPoints:names.map(n=>new URL(`../src/${n}.ts`,import.meta.url).pathname),bundle:true,platform:'node',format:'esm',write:false,outdir:'/virtual'});
const [{ReviewStore},{Repository},{Policies},{codeOwnerDecision}]=await Promise.all(output.outputFiles.map(o=>import('data:text/javascript;base64,'+Buffer.from(o.text).toString('base64'))));
const sha=c=>c.repeat(40),actor={id:'maintainer',name:'Maintainer'},policy={branch:'main',pullRequest:true,approvals:1,checks:[],beforeOpen:[],preventForce:true,preventDelete:true};
function fixture(){
 const db=new DatabaseSync(':memory:'),sql={exec(q,...args){const rows=db.prepare(q).all(...args);return {toArray:()=>rows};}};
 sql.exec('CREATE TABLE versions(version INTEGER PRIMARY KEY,commit_sha TEXT,tree_sha TEXT)');
 const repo=new Repository(sql);repo.initialize();repo.update('refs/heads/main',null,{commit:sha('a'),tree:sha('1')},false,'author');
 repo.update('refs/heads/feature',null,{commit:sha('b'),tree:sha('2')},true,'author');
 const reviews=new ReviewStore(sql,()=>repo.main(),true,{accounts:{reviewer:"writer",another:"writer",author:"writer",maintainer:"writer"},checkedAt:Date.now(),expiresAt:Date.now()+30000}),policies=new Policies(sql),run=c=>reviews.run(c,()=>{throw Error('Unexpected landing');});
 const branch=name=>reviews.snapshot().branches.find(b=>b.name===name);
 run({op:'open',title:'Change',body:'',head:branch('feature'),base:branch('main'),anchor:sha('a'),anchorTree:sha('1'),author:{id:'author',name:'Author'}});policies.set(policy);
 const review=(verdict='APPROVE',id='reviewer')=>run({op:'review',number:1,author:{id,name:id},verdict,body:'Original feedback',commit:sha('b'),anchor:sha('a'),independent:true}).reviews.at(-1);
 const dismiss=(id,extra={})=>run({op:'dismiss',number:1,reviewId:id,actor,reason:'Superseded after discussion',human:true,origin:'https://nanohub.test',...extra});
 const gate=()=>{const s=reviews.snapshot();return policies.reviewGate(s.pulls[0],s.reviews,sha('b'));};
 const merge=()=>run({op:'merge',number:1,head:branch('feature'),base:repo.main(),anchor:sha('a'),candidate:{commit:sha('b'),tree:sha('2'),base:sha('a')},request:{owner:actor}});
 return{db,sql,repo,policies,reviews,run,review,dismiss,gate,merge};
}
test('a dismissed requested-change review stops blocking without resurrecting an earlier approval',()=>{
 const f=fixture();try{
  f.review();const blocking=f.review('REQUEST_CHANGES');assert.match(f.gate().error,/requested changes/);
  f.dismiss(blocking.id);assert.equal(f.gate().approvals,0);assert.match(f.gate().error,/independent approval/);
  assert.throws(f.merge,/independent approval/);
  const saved=f.reviews.snapshot().reviews.at(-1);assert.equal(saved.verdict,'REQUEST_CHANGES');assert.equal(saved.body,'Original feedback');assert.equal(saved.dismissed.actor.id,actor.id);
  f.review();assert.equal(f.gate().ready,true);assert.equal(f.merge().pulls[0].state,'merged');
 }finally{f.db.close();}
});
test('dismissed approvals no longer satisfy ordinary or code-owner gates',()=>{
 const f=fixture();try{
  const first=f.review();f.review();assert.equal(f.gate().approvals,1);
  const latest=f.reviews.snapshot().reviews.at(-1);f.dismiss(latest.id);assert.equal(f.gate().approvals,0,'Older approval must not be revived');
  const s=f.reviews.snapshot(),evidence={base:sha('a'),head:sha('b'),file:'CODEOWNERS',warnings:[],groups:[{line:1,pattern:'*',owners:['@reviewer'],files:1,paths:['README']}]};
  assert.equal(codeOwnerDecision(evidence,{'@reviewer':'reviewer'},f.policies.eligibleApprovals(s.pulls[0],s.reviews,sha('b')).map(r=>r.author.id),true).missing,1);
  f.dismiss(first.id);assert.equal(f.gate().approvals,0);
 }finally{f.db.close();}
});
test('dismissal restrictions intersect, preserve empty lists and are re-read at the final writer',()=>{
 const f=fixture();try{
  const r=f.review();assert.equal(f.policies.canDismiss('main',actor.id),true);
  f.policies.set({...policy,branch:'*',allowDismiss:['maintainer','other']});
  f.policies.set({...policy,allowDismiss:['other']});assert.deepEqual(f.policies.get('main').allowDismiss,['other']);assert.throws(()=>f.dismiss(r.id),/not allowed/);
  f.policies.set({...policy,allowDismiss:[]});assert.equal(f.policies.canDismiss('main','other'),false);
  f.policies.set({...policy,allowDismiss:['maintainer','maintainer']});assert.deepEqual(f.policies.get('main').allowDismiss,['maintainer']);f.dismiss(r.id);
  for(const allowDismiss of [null,'maintainer',[1],[''],['x\n'],Array(101).fill('x')])assert.throws(()=>f.policies.set({...policy,allowDismiss}),/Invalid branch policy/);
 }finally{f.db.close();}
});
test('only reasoned human dismissals of a verdict on the open PR are accepted',()=>{
 const f=fixture();try{
  const r=f.review();assert.throws(()=>f.dismiss(r.id,{human:false}),/signed-in/);
  for(const reason of ['','  ','x'.repeat(16001),null])assert.throws(()=>f.dismiss(r.id,{reason}),/dismissal reason/);
  assert.throws(()=>f.dismiss(999),/No such review/);assert.throws(()=>f.dismiss(1.2),/review ID/);
  const comment=f.review('COMMENT');assert.throws(()=>f.dismiss(comment.id),/Comment-only/);
  f.sql.exec('UPDATE review_reviews SET pull = 2, data = ? WHERE id = ?',JSON.stringify({...r,pull:2}),r.id);
  assert.throws(()=>f.dismiss(r.id),/No such review/);
  f.run({op:'close',number:1});assert.throws(()=>f.dismiss(comment.id),/no longer open/);
 }finally{f.db.close();}
});
test('identical retries emit one dismissal audit and never appear as ref updates',()=>{
 const f=fixture();try{
  const r=f.review();f.dismiss(r.id,{reason:'  Superseded after discussion  '});f.dismiss(r.id);
  assert.throws(()=>f.dismiss(r.id,{reason:'Different reason'}),/already been dismissed/);
  const events=f.repo.activity({kind:'reviews'}).events;assert.equal(events.length,1);assert.equal(events[0].actor,actor.id);assert.equal(events[0].dismissal.reason,'Superseded after discussion');
  assert.equal(events[0].dismissal.previousVerdict,'APPROVE');assert.equal(events[0].ref,undefined);
  assert.ok(f.repo.activity({kind:'refs'}).events.every(e=>!e.dismissal));
  assert.equal(f.policies.pushEvent('feature'),2,'Dismissal must not change last-push identity');
 }finally{f.db.close();}
});
