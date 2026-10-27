import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
const output=await build({entryPoints:['review/store','repository/store','repository/policy'].map(n=>new URL(`../src/${n}.ts`,import.meta.url).pathname),bundle:true,platform:'node',format:'esm',write:false,outdir:'/virtual'});
const [{ReviewStore},{Repository},{Policies}]=await Promise.all(output.outputFiles.map(o=>import('data:text/javascript;base64,'+Buffer.from(o.text).toString('base64'))));
const sha=c=>c.repeat(40),policy={branch:'main',pullRequest:true,approvals:1,checks:[],beforeOpen:[],preventForce:true,preventDelete:true,dismissStaleReviews:false};
const member=accounts=>({accounts,checkedAt:Date.now(),expiresAt:Date.now()+30000});
function fixture(){
 const db=new DatabaseSync(':memory:'),sql={exec(q,...args){const rows=db.prepare(q).all(...args);return{toArray:()=>rows};}};
 sql.exec('CREATE TABLE versions(version INTEGER PRIMARY KEY,commit_sha TEXT,tree_sha TEXT)');const repo=new Repository(sql);repo.initialize();repo.update('refs/heads/main',null,{commit:sha('a'),tree:sha('1')},false,'author');repo.update('refs/heads/feature',null,{commit:sha('b'),tree:sha('2')},true,'author');
 const store=new ReviewStore(sql,()=>repo.main(),true),run=c=>store.run(c,()=>{throw Error('Unexpected landing');}),snapshot=()=>store.snapshot(),branch=name=>snapshot().branches.find(b=>b.name===name);
 run({op:'open',title:'Review',body:'',head:branch('feature'),base:branch('main'),anchor:sha('a'),anchorTree:sha('1'),author:{id:'author',name:'Author'}});new Policies(sql).set(policy);
 const review=(id='reviewer',verdict='APPROVE',independent=true)=>run({op:'review',number:1,author:{id,name:id},verdict,body:'Original review',commit:branch('feature').commit,anchor:sha('a'),independent});
 const gate=membership=>{const s=snapshot();return new Policies(sql,membership).reviewGate(s.pulls[0],s.reviews,branch('feature').commit);};
 const merge=membership=>new ReviewStore(sql,()=>repo.main(),true,membership).run({op:'merge',number:1,head:branch('feature'),base:repo.main(),anchor:sha('a'),candidate:{commit:branch('feature').commit,tree:branch('feature').tree,base:sha('a')},request:{owner:{id:'author'}}},()=>{throw Error('Unexpected landing');});
 return{db,sql,repo,review,gate,merge,snapshot,branch};
}
test('stored independent approval cannot merge without fresh membership evidence',()=>{
 const f=fixture();try{f.review();assert.equal(f.gate(undefined).approvals,1,'The proof planner can discover candidates');assert.throws(()=>f.merge(undefined),/membership evidence/);assert.equal(f.repo.main().commit,sha('a'));assert.equal(f.merge(member({reviewer:'writer'})).pulls[0].state,'merged');}finally{f.db.close();}
});
test('demoted, removed and unavailable reviewers cannot count retained approvals or mutate historical feedback',()=>{
 const f=fixture();try{f.review();for(const accounts of [{reviewer:'no_write'},{reviewer:'unavailable'},{}]){const proof=member(accounts);assert.equal(f.gate(proof).approvals,0);assert.equal(f.gate(proof).ready,false);assert.throws(()=>f.merge(proof),/independent approval|write access could not be verified/);assert.equal(f.repo.main().commit,sha('a'));}const saved=f.snapshot().reviews[0];assert.equal(saved.verdict,'APPROVE');assert.equal(saved.body,'Original review');assert.equal(saved.dismissed,undefined);assert.equal(f.gate(member({reviewer:'writer'})).ready,true);}finally{f.db.close();}
});
test('current writer filtering composes with the latest reviewable push and author/agent exclusions',()=>{
 const f=fixture();try{new Policies(f.sql).set({...policy,approvals:0,requireLastPushApproval:true});f.review();f.review('author');f.review('agent','APPROVE',false);assert.equal(f.gate(member({reviewer:'no_write',author:'writer',agent:'writer'})).ready,false);assert.equal(f.gate(member({reviewer:'writer'})).ready,true);f.repo.update('refs/heads/feature',sha('b'),{commit:sha('c'),tree:sha('3')},true,'reviewer');assert.match(f.gate(member({reviewer:'writer'})).error,/latest push/);f.review('backup');assert.equal(f.gate(member({reviewer:'writer',backup:'no_write'})).ready,false);assert.equal(f.gate(member({reviewer:'writer',backup:'writer'})).ready,true);}finally{f.db.close();}
});
test('expired, invalid and future membership evidence cannot advance main',()=>{
 const f=fixture();try{f.review();for(const change of [{checkedAt:NaN},{expiresAt:NaN},{checkedAt:Date.now()-31000,expiresAt:Date.now()+1000},{expiresAt:Date.now()-1},{checkedAt:Date.now()+10000}])assert.throws(()=>f.merge({...member({reviewer:'writer'}),...change}),/membership evidence/);assert.equal(f.repo.main().commit,sha('a'));}finally{f.db.close();}
});
test('removing write access never silently resolves an outstanding change request',()=>{
 const f=fixture();try{f.review('reviewer','REQUEST_CHANGES');f.review('backup');const proof=member({reviewer:'no_write',backup:'writer'});assert.match(f.gate(proof).error,/requested changes/);assert.throws(()=>f.merge(proof),/requested changes/);assert.equal(f.snapshot().reviews[0].dismissed,undefined);}finally{f.db.close();}
});
test('reviews arriving after membership lookup cannot count an unverified new reviewer or hide requested changes',()=>{
 const f=fixture();try{f.review();const oldProof=member({reviewer:'writer'});new Policies(f.sql).set({...policy,approvals:2});f.review('backup');assert.equal(f.gate(oldProof).approvals,1);assert.throws(()=>f.merge(oldProof),/2 independent approvals/);const fresh=member({reviewer:'writer',backup:'writer'});f.review('late-reviewer','REQUEST_CHANGES');assert.throws(()=>f.merge(fresh),/requested changes/);assert.equal(f.repo.main().commit,sha('a'));}finally{f.db.close();}
});
