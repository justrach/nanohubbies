import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'nh-success-only-'));after(()=>rm(dir,{recursive:true,force:true}));
await build({entryPoints:['ci/store','repository/store','repository/policy','repository/routes','review/store'].map(p=>new URL('../src/'+p+'.ts',import.meta.url).pathname),bundle:true,platform:'node',format:'esm',outdir:dir,outbase:new URL('../src/',import.meta.url).pathname,outExtension:{'.js':'.mjs'}});
const load=p=>import(pathToFileURL(join(dir,p+'.mjs'))),{CIStore}=await load('ci/store'),{Repository}=await load('repository/store'),{Policies}=await load('repository/policy'),{repositoryRoute}=await load('repository/routes'),{ReviewStore}=await load('review/store');
const sha=c=>c.repeat(40),result=state=>({name:'test',state,command:'Trusted synthetic report',log:'',artifacts:[]}),policy={branch:'main',pullRequest:true,approvals:0,checks:['test'],beforeOpen:['test'],preventForce:true,preventDelete:true};
function fixture(){const db=new DatabaseSync(':memory:'),sql={exec(q,...args){const rows=db.prepare(q).all(...args);return {toArray:()=>rows};}};sql.exec('CREATE TABLE versions(version INTEGER PRIMARY KEY,commit_sha TEXT,tree_sha TEXT)');const ci=new CIStore(sql),runner=ci.runner('trusted');return{db,sql,ci,runner};}
test('success-only checks reject every other conclusion while ordinary GitHub-compatible checks retain neutral/skipped behavior',()=>{
 for(const state of ['success','neutral','skipped','failure','cancelled','timed_out','action_required','stale']){
  const f=fixture();try{const run=f.ci.enqueue('feature',sha('b'),sha('a')),lease=f.ci.claim(f.runner.token);f.ci.complete(f.runner.token,run.id,lease.attempt,[result(state)],null);
   if(state==='success')assert.equal(f.ci.require('feature',sha('b'),sha('a'),['test'],[],true).id,run.id);else assert.throws(()=>f.ci.require('feature',sha('b'),sha('a'),['test'],[],true),/Required check/);
   if(['success','neutral','skipped'].includes(state))assert.equal(f.ci.require('feature',sha('b'),sha('a'),['test']).id,run.id);else assert.throws(()=>f.ci.require('feature',sha('b'),sha('a'),['test']),/Required check/);
  }finally{f.db.close();}
 }
});
test('a newer same-SHA queued/running/neutral/failed attempt cannot inherit an older Success in strict mode',()=>{
 const f=fixture();try{const run=f.ci.enqueue('feature',sha('b'),sha('a')),required=()=>f.ci.require('feature',sha('b'),sha('a'),['test'],[{name:'test',runner:f.runner.id}],true);let lease=f.ci.claim(f.runner.token);f.ci.complete(f.runner.token,run.id,lease.attempt,[result('success')],null);assert.ok(required());
  for(const state of ['neutral','skipped','failure','cancelled']){f.ci.retry(run.id,sha('b'),sha('a'));assert.throws(required,/Required check/);lease=f.ci.claim(f.runner.token);assert.throws(required,/Required check/);f.ci.complete(f.runner.token,run.id,lease.attempt,[result(state)],null);assert.throws(required,/Required check/);}
  f.ci.retry(run.id,sha('b'),sha('a'));lease=f.ci.claim(f.runner.token);f.ci.complete(f.runner.token,run.id,lease.attempt,[result('success')],null);assert.ok(required());f.ci.revoke(f.runner.id);assert.throws(required,/revoked runner source/);
 }finally{f.db.close();}
});
test('matching success-only requirements compose, validate booleans and remain an explicit opt-in for existing policies',()=>{
 const f=fixture();try{const policies=new Policies(f.sql);policies.set({...policy,branch:'release/**',successOnlyChecks:true});policies.set({...policy,branch:'release/v1',successOnlyChecks:false});assert.equal(policies.get('release/v1').successOnlyChecks,true);assert.equal(policies.get('release/v2').successOnlyChecks,true);
  for(const value of [null,'true',1,[],{}])assert.throws(()=>policies.set({...policy,successOnlyChecks:value}),/Invalid branch policy/);
  policies.remove('release/**');assert.equal(policies.get('release/v1').successOnlyChecks,false);policies.set(policy);assert.equal(policies.get('main').successOnlyChecks,false);
  policies.set({...policy,successOnlyChecks:true});assert.throws(()=>policies.set(policy),/Include successOnlyChecks/);assert.equal(policies.get('main').successOnlyChecks,true);policies.set({...policy,successOnlyChecks:false});assert.equal(policies.get('main').successOnlyChecks,false);
  const legacy={...policy,branch:'legacy'};f.sql.exec('INSERT INTO branch_policies VALUES(?,?)','legacy',JSON.stringify(legacy));assert.equal(policies.get('legacy').successOnlyChecks,false);
 }finally{f.db.close();}
});
test('strict policy changes are re-read at both PR creation and final serialized merge',()=>{
 for(const state of ['neutral','skipped']){const f=fixture();try{
  const repo=new Repository(f.sql);repo.initialize();repo.update('refs/heads/main',null,{commit:sha('a'),tree:sha('1')},true,'owner');repo.update('refs/heads/feature',null,{commit:sha('b'),tree:sha('2')},true,'author');
  const policies=new Policies(f.sql);policies.set({...policy,successOnlyChecks:true});const reviews=new ReviewStore(f.sql,()=>repo.main(),true,{accounts:{},checkedAt:Date.now(),expiresAt:Date.now()+30000}),s=reviews.snapshot(),head=s.branches.find(b=>b.name==='feature'),base=s.branches.find(b=>b.name==='main');
  const open=()=>reviews.run({op:'open',title:'Strict checks',body:'',head,base,anchor:base.commit,anchorTree:base.tree,author:{id:'author',name:'Author'}},()=>{}),merge=()=>reviews.run({op:'merge',number:1,head,base:repo.main(),anchor:base.commit,candidate:{commit:head.commit,tree:head.tree,base:base.commit},request:{owner:{id:'owner'}}},()=>{throw Error('Unexpected generated commit');});
  let run=f.ci.claim(f.runner.token);while(run.branch!=='feature'){f.ci.complete(f.runner.token,run.id,run.attempt,[],null);run=f.ci.claim(f.runner.token);}f.ci.complete(f.runner.token,run.id,run.attempt,[result(state)],null);
  assert.throws(open,/requires Success/);policies.set({...policy,successOnlyChecks:false});open();policies.set({...policy,successOnlyChecks:true});assert.throws(merge,/requires Success/);assert.equal(repo.main().commit,sha('a'));
  f.ci.retry(run.id,head.commit,base.commit);run=f.ci.claim(f.runner.token);f.ci.complete(f.runner.token,run.id,run.attempt,[result('success')],null);merge();assert.equal(repo.main().commit,head.commit);
 }finally{f.db.close();}}
});
test('browser and CLI edits refuse new conclusion fields on old stateful receivers, including explicit false',async()=>{
 let writes=0;const seq={protectionConfiguration:()=>({revisionTracking:'storage',revision:2,policies:[]}),setPolicy:()=>{writes++;return [];},configureProtection:()=>{writes++;return {policies:[],revision:3};}},env={SEQUENCER:{idFromName:x=>x,get:()=>seq},HUB:{idFromName:x=>x,get:()=>({find:()=>({owner:'owner'})})}},access={proof:{role:'admin',agentId:null}},browser={id:'owner'},cli={...browser,cli:{credentialId:'fixture',scopes:['read','protections:write']}};
 const request=(body,method='PUT')=>new Request('https://nanohub.invalid/api/trunks/fixture/protection',{method,headers:{Origin:'https://nanohub.invalid','Content-Type':'application/json','If-Match':'"protection-2"'},body:JSON.stringify(body)});
 for(const successOnlyChecks of [false,true])for(const user of [browser,cli])assert.equal((await repositoryRoute(env,request({...policy,successOnlyChecks}),'fixture','protection',undefined,user,access)).status,503);assert.equal(writes,0);
 assert.equal((await repositoryRoute(env,request(policy),'fixture','protection',undefined,browser,access)).status,200);assert.equal(writes,1);
 seq.protectionConfiguration=()=>({revisionTracking:'storage',revision:2,policies:[],successOnlyCheckConclusions:true});for(const user of [browser,cli])assert.equal((await repositoryRoute(env,request({...policy,successOnlyChecks:true}),'fixture','protection',undefined,user,access)).status,200);assert.equal(writes,3);
 seq.protectionConfiguration=()=>({revisionTracking:'storage',revision:2,policies:[{...policy,successOnlyChecks:true}],successOnlyCheckConclusions:true});
 for(const user of [browser,cli])assert.equal((await repositoryRoute(env,request(policy),'fixture','protection',undefined,user,access)).status,400);assert.equal(writes,3);
 assert.equal((await repositoryRoute(env,request({branch:'main'},'DELETE'),'fixture','protection',undefined,cli,access)).status,200);assert.equal(writes,4);
 seq.protectionConfiguration=()=>{throw Error('The RPC receiver does not implement the method "protectionConfiguration".');};seq.policies=()=>[{...policy,successOnlyChecks:true}];assert.equal((await repositoryRoute(env,request(policy),'fixture','protection',undefined,browser,access)).status,503);assert.equal(writes,4);
});
