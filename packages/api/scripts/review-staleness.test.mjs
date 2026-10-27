import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
const names=['review/store','repository/store','repository/policy','repository/codeowners'];
const output=await build({entryPoints:names.map(n=>new URL(`../src/${n}.ts`,import.meta.url).pathname),bundle:true,platform:'node',format:'esm',write:false,outdir:'/virtual'});
const [{ReviewStore},{Repository},{Policies},{codeOwnerDecision}]=await Promise.all(output.outputFiles.map(o=>import('data:text/javascript;base64,'+Buffer.from(o.text).toString('base64'))));
const sha=c=>c.repeat(40),policy={branch:'main',pullRequest:true,approvals:1,checks:[],beforeOpen:[],preventForce:true,preventDelete:true};
function fixture(){
 const db=new DatabaseSync(':memory:'),sql={exec(q,...args){const rows=db.prepare(q).all(...args);return{toArray:()=>rows};}};
 sql.exec('CREATE TABLE versions(version INTEGER PRIMARY KEY,commit_sha TEXT,tree_sha TEXT)');
 const repo=new Repository(sql);repo.initialize();repo.update('refs/heads/main',null,{commit:sha('a'),tree:sha('1')},false,'author');repo.update('refs/heads/feature',null,{commit:sha('b'),tree:sha('2')},true,'author');
 const reviews=new ReviewStore(sql,()=>repo.main(),true),policies=new Policies(sql),run=c=>reviews.run(c,()=>{throw Error('Unexpected landing');}),state=()=>reviews.snapshot(),branch=name=>state().branches.find(b=>b.name===name);
 run({op:'open',title:'Change',body:'',head:branch('feature'),base:branch('main'),anchor:sha('a'),anchorTree:sha('1'),author:{id:'author',name:'Author'}});policies.set(policy);
 const review=(id='reviewer',verdict='APPROVE',independent=true)=>run({op:'review',number:1,author:{id,name:id},body:'Reviewed files',verdict,commit:branch('feature').commit,anchor:state().pulls[0].anchor,independent}).reviews.at(-1);
 const push=(commit,tree,actor='author')=>repo.update('refs/heads/feature',branch('feature').commit,{commit:sha(commit),tree:sha(tree)},true,actor);
 const gate=()=>{const s=state();return policies.reviewGate(s.pulls[0],s.reviews,branch('feature').commit);};
 const compare=(anchor=repo.main(),extra={})=>run({op:'compare',number:1,head:branch('feature'),base:branch('main'),previousAnchor:state().pulls[0].anchor,anchor:anchor.commit,anchorTree:anchor.tree,...extra});
 return{db,sql,repo,reviews,policies,run,state,branch,review,push,gate,compare};
}
test('existing policies stay strict and changed files irreversibly dismiss approvals with one audit',()=>{
 const f=fixture();try{
  assert.equal(f.policies.get('main').dismissStaleReviews,true);const r=f.review();assert.equal(f.gate().ready,true);
  f.push('c','3');let saved=f.state().reviews.find(x=>x.id===r.id);assert.equal(saved.dismissed.kind,'stale');assert.equal(saved.body,'Reviewed files');assert.equal(saved.verdict,'APPROVE');assert.equal(f.gate().ready,false);
  f.push('d','2');assert.equal(f.gate().approvals,0,'Returning the original tree cannot resurrect a dismissed review');
  const events=f.repo.activity({kind:'reviews'}).events;assert.equal(events.length,1);assert.equal(events[0].dismissal.automatic,true);assert.equal(events[0].ref,undefined);
  f.policies.set({...policy,dismissStaleReviews:false});assert.equal(f.gate().approvals,0,'Changing policy cannot undo an earlier dismissal');
  f.review();assert.equal(f.gate().ready,true);
 }finally{f.db.close();}
});
test('metadata-only commits retain approvals and do not move latest-reviewable-push attribution',()=>{
 const f=fixture();try{
  f.policies.set({...policy,requireLastPushApproval:true});const r=f.review(),push=f.policies.pushEvent('feature');
  f.push('c','2','reviewer');assert.equal(f.gate().ready,true);assert.equal(f.policies.pushEvent('feature'),push);assert.equal(f.state().reviews.find(x=>x.id===r.id).dismissed,undefined);
  f.push('d','3','reviewer');assert.equal(f.gate().ready,false);assert.notEqual(f.policies.pushEvent('feature'),push);
  f.review('reviewer');assert.equal(f.gate().ready,false);f.review('another');assert.equal(f.gate().ready,true);
 }finally{f.db.close();}
});
test('retention permits older independent approvals while latest-push approval still requires a fresh other reviewer',()=>{
 const f=fixture();try{
  f.policies.set({...policy,approvals:2,dismissStaleReviews:false,requireLastPushApproval:true});f.review('reviewer');f.review('another');assert.equal(f.gate().ready,true);
  f.push('c','3','reviewer');assert.equal(f.gate().approvals,2);assert.match(f.gate().error,/latest push/);assert.ok(f.state().reviews.every(r=>!r.dismissed));
  f.review('reviewer');assert.match(f.gate().error,/other than its pusher/);f.review('another');assert.equal(f.gate().ready,true);
  f.review('author');f.review('agent','APPROVE',false);assert.equal(f.gate().approvals,2,'Retention does not count author or agent approvals');
  const s=f.state(),evidence={base:sha('a'),head:sha('c'),file:'CODEOWNERS',warnings:[],groups:[{line:1,pattern:'*',owners:['@reviewer'],files:1,paths:['README']}]};
  assert.equal(codeOwnerDecision(evidence,{'@reviewer':'reviewer'},f.policies.eligibleApprovals(s.pulls[0],s.reviews,sha('c')).map(r=>r.author.id),true).missing,0);
 }finally{f.db.close();}
});
test('overlapping rules cannot disable stale dismissal and invalid policy values are rejected',()=>{
 const f=fixture();try{
  f.policies.set({...policy,branch:'ma*',dismissStaleReviews:false});f.policies.set({...policy,dismissStaleReviews:false});assert.equal(f.policies.get('main').dismissStaleReviews,false);
  f.policies.set({...policy,branch:'ma*'});assert.equal(f.policies.get('main').dismissStaleReviews,true);
  f.review();f.push('c','3');assert.equal(f.state().reviews.at(-1).dismissed.kind,'stale');
  for(const value of [null,0,'false',[]])assert.throws(()=>f.policies.set({...policy,dismissStaleReviews:value}),/Invalid branch policy/);
 }finally{f.db.close();}
});
test('comparison-base changes dismiss approvals without requiring a head change; stale evidence cannot mutate state',()=>{
 const f=fixture();try{
  const reviewed=f.review(),oldHead=f.branch('feature'),oldBase=f.branch('main');
  f.repo.update('refs/heads/main',sha('a'),{commit:sha('c'),tree:sha('3')},true,'another',true);
  assert.throws(()=>f.compare(undefined,{base:oldBase}),/changed/);assert.equal(f.state().reviews.at(-1).dismissed,undefined);
  f.compare();assert.equal(f.branch('feature').commit,oldHead.commit);assert.equal(f.state().reviews.find(r=>r.id===reviewed.id).dismissed.kind,'stale');assert.equal(f.gate().ready,false);
  const count=f.repo.activity({kind:'reviews'}).events.length;f.compare();assert.equal(f.repo.activity({kind:'reviews'}).events.length,count);
  f.review();assert.equal(f.gate().ready,true);
 }finally{f.db.close();}
});
test('same-tree comparison metadata preserves approvals; latest-push still needs review of a changed comparison',()=>{
 const f=fixture();try{
  f.review();f.repo.update('refs/heads/main',sha('a'),{commit:sha('c'),tree:sha('1')},true,'another',true);f.compare();assert.equal(f.gate().ready,true);
  f.policies.set({...policy,dismissStaleReviews:false,requireLastPushApproval:true});f.repo.update('refs/heads/main',sha('c'),{commit:sha('d'),tree:sha('3')},true,'another',true);f.compare();assert.equal(f.gate().approvals,1);assert.equal(f.gate().ready,false);
  f.review();assert.equal(f.gate().ready,true);
 }finally{f.db.close();}
});
test('requested changes survive new commits and retained approvals can still be manually dismissed',()=>{
 const f=fixture();try{
  f.policies.set({...policy,dismissStaleReviews:false});const approved=f.review();f.review('another','REQUEST_CHANGES');f.push('c','3');assert.match(f.gate().error,/requested changes/);
  assert.equal(f.state().reviews.at(-1).dismissed,undefined);f.run({op:'dismiss',number:1,reviewId:approved.id,actor:{id:'maintainer',name:'Maintainer'},human:true,origin:'https://nanohub.test',reason:'No longer approved'});assert.equal(f.gate().approvals,0);
 }finally{f.db.close();}
});
test('legacy review records without tree evidence keep conservative exact-ID eligibility',()=>{
 const f=fixture();try{
  const review=f.review();delete review.tree;delete review.anchorTree;f.sql.exec('UPDATE review_reviews SET data = ? WHERE id = ?',JSON.stringify(review),review.id);
  assert.equal(f.gate().ready,true);f.push('c','2');assert.equal(f.gate().ready,false);
  f.policies.set({...policy,dismissStaleReviews:false});assert.equal(f.gate().ready,true);
 }finally{f.db.close();}
});
