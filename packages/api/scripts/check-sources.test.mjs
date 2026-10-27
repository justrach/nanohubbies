import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
const out=await build({entryPoints:[new URL('../src/ci/store.ts',import.meta.url).pathname,new URL('../src/repository/policy.ts',import.meta.url).pathname,new URL('../src/review/store.ts',import.meta.url).pathname,new URL('../src/repository/store.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',write:false,outdir:'/virtual'});
const [{CIStore},{Policies},{ReviewStore},{Repository}]=await Promise.all(out.outputFiles.map(file=>import('data:text/javascript;base64,'+Buffer.from(file.text).toString('base64'))));
const sha=c=>c.repeat(40),policy={branch:'main',pullRequest:true,approvals:0,checks:['test'],beforeOpen:[],preventForce:true,preventDelete:true},result={name:'test',state:'success',command:'bun test',log:'https://logs.invalid/test',artifacts:[]};
function fixture(){const db=new DatabaseSync(':memory:'),sql={exec(query,...args){const rows=db.prepare(query).all(...args);return {toArray:()=>rows};}};sql.exec('CREATE TABLE versions(version INTEGER PRIMARY KEY,commit_sha TEXT,tree_sha TEXT)');const ci=new CIStore(sql),trusted=ci.runner('trusted-pool'),other=ci.runner('trusted-pool'),policies=new Policies(sql);return {db,sql,ci,trusted,other,policies};}
function delivered(f,runner=f.other){const queued=f.ci.enqueue('feature',sha('b'),sha('a')),run=f.ci.claim(runner.token);assert.equal(run.id,queued.id);f.ci.complete(runner.token,run.id,run.attempt,[result],null);return run;}
const pin=f=>[{name:'test',runner:f.trusted.id}];
test('source pins validate exact required check names and repository-local stable registrations',()=>{const f=fixture();try{
 for(const value of [null,{},[{name:'unused',runner:f.trusted.id}],[{name:'test',runner:'missing-source'}],[{name:'test',runner:f.trusted.id,source:'asserted'}],[...pin(f),...pin(f)],[{name:'test',runner:17}],[null]])assert.throws(()=>f.policies.set({...policy,checkSources:value}),/source/);
 const saved=f.policies.set({...policy,checkSources:pin(f)});assert.deepEqual(saved[0].checkSources,pin(f));
 assert.equal(f.ci.sources()[0].name,'trusted-pool');assert.equal('token' in f.ci.sources()[0],false);assert.equal('hash' in f.ci.sources()[0],false);
 const foreign=fixture();try{assert.throws(()=>foreign.policies.set({...policy,checkSources:pin(f)}),/registered in this repository/);}finally{foreign.db.close();}
}finally{f.db.close();}});
test('a successful same-name result from another registration cannot satisfy a source pin',()=>{const f=fixture();try{
 const run=delivered(f);assert.equal(f.ci.require('feature',sha('b'),sha('a'),['test']).id,run.id);
 assert.throws(()=>f.ci.require('feature',sha('b'),sha('a'),['test'],pin(f)),/must be reported by trusted-pool/);
 f.ci.retry(run.id,sha('b'),sha('a'));const trusted=f.ci.claim(f.trusted.token);
 assert.throws(()=>f.ci.complete(f.trusted.token,run.id,trusted.attempt,[{...result,runner:f.trusted.id}],null),/Invalid check/);
 f.ci.complete(f.trusted.token,run.id,trusted.attempt,[result],null);assert.equal(f.ci.require('feature',sha('b'),sha('a'),['test'],pin(f)).runner,f.trusted.id);
 assert.throws(()=>f.ci.require('feature',sha('c'),sha('a'),['test'],pin(f)),/Required check/);assert.throws(()=>f.ci.require('feature',sha('b'),sha('d'),['test'],pin(f)),/Required check/);
}finally{f.db.close();}});
test('overlapping any-source rules cannot erase pins and conflicting sources block',()=>{const f=fixture();try{
 f.policies.set({...policy,branch:'**',checkSources:pin(f)});f.policies.set({...policy,checks:['build'],branch:'main'});let p=f.policies.get('main');assert.deepEqual(p.checkSources,pin(f));assert.deepEqual(p.checks,['test','build']);
 f.policies.set({...policy,checkSources:[{name:'test',runner:f.other.id}]});p=f.policies.get('main');assert.equal(p.checkSources.length,2);delivered(f,f.trusted);assert.throws(()=>f.ci.require('feature',sha('b'),sha('a'),['test'],p.checkSources),/conflicting expected runner sources/);
 f.policies.remove('main');assert.equal(f.ci.require('feature',sha('b'),sha('a'),['test'],f.policies.get('main').checkSources).runner,f.trusted.id);
}finally{f.db.close();}});
test('revoking a pinned source invalidates its completed evidence and name reuse cannot revive it',()=>{const f=fixture();try{
 delivered(f,f.trusted);assert.ok(f.ci.require('feature',sha('b'),sha('a'),['test'],pin(f)));f.ci.revoke(f.trusted.id);
 assert.throws(()=>f.ci.require('feature',sha('b'),sha('a'),['test'],pin(f)),/revoked runner source/);const replacement=f.ci.runner('trusted-pool');assert.notEqual(replacement.id,f.trusted.id);
 f.policies.set({...policy,checkSources:pin(f)});assert.throws(()=>f.ci.require('feature',sha('b'),sha('a'),['test'],f.policies.get('main').checkSources),/revoked runner source/);
 // Explicit any-source policy retains the existing completed-result contract.
 assert.ok(f.ci.require('feature',sha('b'),sha('a'),['test']));
}finally{f.db.close();}});
function repository(f){const repo=new Repository(f.sql);repo.initialize();repo.update('refs/heads/main',null,{commit:sha('a'),tree:sha('1')},true,'owner');repo.update('refs/heads/feature',null,{commit:sha('b'),tree:sha('2')},true,'author');for(let r;(r=f.ci.claim(f.other.token));)f.ci.complete(f.other.token,r.id,r.attempt,[result],null);const reviews=new ReviewStore(f.sql,()=>repo.main(),true,{accounts:{},checkedAt:Date.now(),expiresAt:Date.now()+30000}),branches=reviews.snapshot().branches,head=branches.find(b=>b.name==='feature'),base=branches.find(b=>b.name==='main'),open=()=>reviews.run({op:'open',title:'Review source',body:'',head,base,anchor:base.commit,anchorTree:base.tree,author:{id:'author',name:'Author'}},()=>{}),merge=()=>reviews.run({op:'merge',number:1,head,base:repo.main(),anchor:base.commit,candidate:{commit:head.commit,tree:head.tree,base:base.commit},request:{owner:{id:'owner'}}},()=>{throw Error('unexpected text landing');});return {repo,reviews,open,merge};}
test('pre-open checks and final merge both recheck current source policy and delivery',()=>{const f=fixture();try{
 const r=repository(f);f.policies.set({...policy,beforeOpen:['test'],checkSources:pin(f)});assert.throws(r.open,/must be reported by/);assert.equal(r.reviews.snapshot().pulls.length,0);
 const run=f.ci.list().find(run=>run.branch==='feature');f.ci.retry(run.id,sha('b'),sha('a'));const lease=f.ci.claim(f.trusted.token);f.ci.complete(f.trusted.token,lease.id,lease.attempt,[result],null);r.open();
 f.policies.set({...policy,checkSources:[{name:'test',runner:f.other.id}]});assert.throws(r.merge,/must be reported by/);assert.equal(r.repo.main().commit,sha('a'));assert.equal(r.reviews.snapshot().pulls[0].state,'open');
 f.policies.set({...policy,checkSources:pin(f)});r.merge();assert.equal(r.repo.main().commit,sha('b'));assert.equal(r.reviews.snapshot().pulls[0].state,'merged');
}finally{f.db.close();}});
