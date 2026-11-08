import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
const built=await build({stdin:{contents:`export * from './src/deployments/store';export * from './src/deployments/requests';export * from './src/ci/store';export * from './src/repository/store';`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,platform:'node',format:'esm',write:false});
const {Environments,DeploymentRequests,CIStore,Repository}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const sha=c=>c.repeat(40),check={name:'test',state:'success',command:'bun test',log:'synthetic check passed',artifacts:[]};
const proof=(accounts={reader:'member'},now=Date.now())=>({accounts,checkedAt:now,expiresAt:now+30000});
function fixture(config={}){
 const db=new DatabaseSync(':memory:'),sql={exec(query,...args){const rows=db.prepare(query).all(...args);return{toArray:()=>rows};}};
 sql.exec('CREATE TABLE versions(version INTEGER PRIMARY KEY,commit_sha TEXT,tree_sha TEXT)');const repo=new Repository(sql);repo.initialize();repo.update('refs/heads/main',null,{commit:sha('a'),tree:sha('1')},true,'owner');
 const ci=new CIStore(sql),runner=ci.runner('primary'),other=ci.runner('other');let run=ci.claim(runner.token);ci.complete(runner.token,run.id,run.attempt,[],null);
 const envs=new Environments(sql),env=envs.set({name:'production',reviewers:['reader'],preventSelfReview:true,...config});repo.update('refs/heads/topic',null,{commit:sha('b'),tree:sha('2')},true,'owner');run=ci.claim(runner.token);
 const requests=new DeploymentRequests(sql),request=requests.request(run,'production',runner.id),report=(auth,now=Math.max(Date.now(),auth.issuedAt??0))=>({environment:'production',head:run.head,base:run.base,state:'success',deploymentId:'synthetic-only',url:'https://example.invalid/deploy',verifiedAt:now,authorizationId:auth.id});
 return{db,sql,repo,ci,runner,other,envs,env,requests,request,run,report};
}
test('environment reviewer and timer configuration validates limits and revisions',()=>{
 const f=fixture();try{
  for(const extra of [{reviewers:Array(7).fill('reader')},{reviewers:['']},{waitTimerMinutes:43201},{waitTimerMinutes:-1},{waitTimerMinutes:0.5},{preventSelfReview:'true'}])assert.throws(()=>f.envs.set({name:'bad',...extra}));
  const next=f.envs.set({name:f.env.name,reviewers:['reader'],waitTimerMinutes:43200},f.env.id);assert.equal(next.revision,2);assert.equal(f.requests.status(f.request,f.run,proof()).state,'stale');
 }finally{f.db.close();}
});
test('one configured current reader can approve; self approval is blocked but self rejection is allowed',()=>{
 const f=fixture({reviewers:['owner','reader']});try{
  let status=f.requests.status(f.request,f.run,proof({owner:'member'}),'owner');assert.equal(status.canReview,true);assert.equal(status.canApprove,false);
  assert.throws(()=>f.requests.review(f.request.id,f.run,'owner','approve','',0,proof({owner:'member'})),/self-review/);
  for(const access of ['absent','unavailable'])assert.throws(()=>f.requests.review(f.request.id,f.run,'reader','approve','',0,proof({reader:access})),/cannot review/);
  const review=f.requests.review(f.request.id,f.run,'reader','approve','Reviewed candidate',0,proof());assert.equal(review.revision,1);status=f.requests.status(review,f.run,proof());assert.equal(status.state,'ready');assert.deepEqual(status.approvals,['reader']);
  assert.deepEqual(f.requests.review(review.id,f.run,'reader','approve','Reviewed candidate',0,proof()),review);assert.throws(()=>f.requests.review(review.id,f.run,'reader','reject','',1,proof()),/already recorded/);
  const rejected=f.requests.review(review.id,f.run,'owner','reject','Stop deployment',1,proof({owner:'member'}));assert.equal(f.requests.status(rejected,f.run,proof()).state,'rejected');assert.throws(()=>f.requests.authorize(rejected.id,f.run,f.runner.id,proof()),/rejected/);
 }finally{f.db.close();}
});
test('durable timer releases both leases; same registration resumes saved checks after a 30 day wait with a new attempt',()=>{
 const f=fixture({waitTimerMinutes:43200});try{
  const now=f.request.waitUntil+1;f.requests.review(f.request.id,f.run,'reader','approve','',0,proof());
  assert.equal(f.requests.status(f.requests.get(f.request.id),f.run,proof()).state,'waiting');assert.throws(()=>f.requests.authorize(f.request.id,f.run,f.runner.id,proof()),/timer/);
  f.ci.defer(f.runner.token,f.run.id,f.run.attempt,f.request.id,[check]);assert.equal(f.ci.readable(f.run.readToken),false);assert.equal(f.ci.get(f.run.id).leaseUntil,0);assert.equal(f.ci.registrations().find(r=>r.id===f.runner.id).active,0);
  assert.equal(f.ci.claim(f.other.token,now,[f.run.id],()=>true),null);
  const ready=run=>f.requests.status(f.requests.get(run.environmentWait),run,proof(undefined,now),'',now).state==='ready';
  const run=f.ci.claim(f.runner.token,now,[f.run.id],ready);assert.equal(run.attempt,f.run.attempt+1);assert.equal(run.generation,f.run.generation);assert.deepEqual(run.results,[check]);assert.equal(f.ci.readable(run.readToken,now),true);
  assert.throws(()=>f.ci.complete(f.runner.token,f.run.id,f.run.attempt,[check],null,now),/Stale/);
  const auth=f.requests.authorize(f.request.id,run,f.runner.id,proof(undefined,now),now);assert.equal(auth.issuedAt,now);assert.deepEqual(f.requests.authorize(f.request.id,run,f.runner.id,proof(undefined,now),now),auth);
  f.ci.complete(f.runner.token,run.id,run.attempt,[check],null,now,[f.report(auth,now)],proof(undefined,now));assert.equal(f.envs.gate(['production'],run.head,run.base).ready,true);
 }finally{f.db.close();}
});
test('protected reports require pre-deployment authorization, current approver and exact generation, source and attempt',()=>{
 const f=fixture();try{
  assert.throws(()=>f.ci.complete(f.runner.token,f.run.id,f.run.attempt,[check],null,Date.now(),[{...f.report({id:'unknown-authorization'})}]),/expired|changed/);
  f.requests.review(f.request.id,f.run,'reader','approve','',0,proof());const auth=f.requests.authorize(f.request.id,f.run,f.runner.id,proof(),Date.now()+10);
  assert.throws(()=>f.ci.complete(f.runner.token,f.run.id,f.run.attempt,[check],null,Date.now(),[f.report(auth,auth.issuedAt-1)],proof()),/expired|changed/);
  for(const evidence of [undefined,proof({reader:'absent'}),proof({reader:'unavailable'}),proof(undefined,Date.now()-60000)])assert.throws(()=>f.ci.complete(f.runner.token,f.run.id,f.run.attempt,[check],null,Date.now(),[f.report(auth)],evidence),/approver/);
  assert.throws(()=>f.requests.authorize(f.request.id,f.run,f.other.id,proof()),/unavailable/);
  const changed={...f.run,generation:f.run.generation+1};f.sql.exec('UPDATE ci_runs SET data=? WHERE id=?',JSON.stringify(changed),f.run.id);assert.throws(()=>f.ci.complete(f.runner.token,f.run.id,f.run.attempt,[check],null,Date.now(),[f.report(auth)],proof()),/expired|changed/);
  f.sql.exec('UPDATE ci_runs SET data=? WHERE id=?',JSON.stringify(f.run),f.run.id);f.ci.complete(f.runner.token,f.run.id,f.run.attempt,[check],null,Date.now(),[f.report(auth)],proof());assert.equal(f.envs.gate(['production'],f.run.head,f.run.base).ready,true);
 }finally{f.db.close();}
});
test('retry, source revoke, candidate advance and environment changes invalidate approval context',()=>{
 for(const mutate of [f=>f.ci.retry(f.run.id,f.run.head,f.run.base,'writer'),f=>f.ci.revoke(f.runner.id),f=>f.repo.update('refs/heads/topic',f.run.head,{commit:sha('c'),tree:sha('3')},true,'owner'),f=>f.envs.set({name:'production',reviewers:['reader'],waitTimerMinutes:1},f.env.id)]){
  const f=fixture();try{f.requests.review(f.request.id,f.run,'reader','approve','',0,proof());f.ci.defer(f.runner.token,f.run.id,f.run.attempt,f.request.id,[check]);mutate(f);assert.equal(f.requests.status(f.requests.get(f.request.id),f.ci.get(f.run.id),proof()).state,'stale');}finally{f.db.close();}
 }
});
test('rejection completes a waiting run, cannot later authorize, and an empty combined pipeline may defer without faking check success',()=>{
 const f=fixture();try{
  f.ci.defer(f.runner.token,f.run.id,f.run.attempt,f.request.id,[]);f.requests.review(f.request.id,f.ci.get(f.run.id),'reader','reject','Candidate is not ready',0,proof());f.ci.rejectEnvironment(f.run.id,f.request.id,f.env.id);const run=f.ci.get(f.run.id);assert.equal(run.state,'complete');assert.ok(run.results.some(result=>result.state==='failure'));assert.equal(f.requests.status(f.requests.get(f.request.id),run,proof()).state,'rejected');assert.throws(()=>f.requests.authorize(f.request.id,run,f.runner.id,proof()),/rejected/);
 }finally{f.db.close();}
});
test('authorization and deployment completion rollback together if a late write fails',()=>{
 const f=fixture();try{
  f.requests.review(f.request.id,f.run,'reader','approve','',0,proof());const auth=f.requests.authorize(f.request.id,f.run,f.runner.id,proof());f.sql.exec("CREATE TRIGGER reject_done BEFORE UPDATE ON ci_runs WHEN json_extract(NEW.data,'$.state')='complete' BEGIN SELECT RAISE(ABORT,'late fixture failure'); END");
  f.db.exec('BEGIN');assert.throws(()=>f.ci.complete(f.runner.token,f.run.id,f.run.attempt,[check],null,Date.now(),[f.report(auth)],proof()),/late fixture/);f.db.exec('ROLLBACK');assert.equal(f.envs.gate(['production'],f.run.head,f.run.base).ready,false);assert.equal(f.ci.get(f.run.id).state,'running');
 }finally{f.db.close();}
});

test('reintroduced candidate generations attribute self-review to the new triggering actor',()=>{
 const f=fixture({reviewers:['writer']});try{
  f.ci.supersede('topic',null);const next=f.ci.enqueue('topic',f.run.head,f.run.base,'writer');assert.equal(next.initiator,'writer');assert.equal(next.generation,f.run.generation+1);
  const request=f.requests.request(next,'production','writer');const status=f.requests.status(request,next,proof({writer:'member'}),'writer');assert.equal(status.canApprove,false);assert.equal(status.canReview,true);assert.equal(f.requests.status(f.request,next,proof()).state,'stale');
 }finally{f.db.close();}
});

test('fresh deployment revalidation retains original issuance and expiry while rejecting changed current authority',()=>{
 const f=fixture();try{
  f.requests.review(f.request.id,f.run,'reader','approve','',0,proof());const auth=f.requests.authorize(f.request.id,f.run,f.runner.id,proof()),now=auth.issuedAt+60000;
  const result=f.requests.revalidate(f.request.id,auth.id,f.run,f.runner.id,proof(undefined,now),now);assert.deepEqual(result,{authorization:auth,checkedAt:now});
  assert.equal(f.sql.exec('SELECT count(*) AS n FROM deployment_authorizations').toArray()[0].n,1);
  for(const access of ['absent','unavailable'])assert.throws(()=>f.requests.revalidate(f.request.id,auth.id,f.run,f.runner.id,proof({reader:access},now),now),/eligible|Waiting/);
  assert.throws(()=>f.requests.revalidate(f.request.id,auth.id,f.run,f.other.id,proof(undefined,now),now),/unavailable/);
  assert.throws(()=>f.requests.revalidate(f.request.id,crypto.randomUUID(),f.run,f.runner.id,proof(undefined,now),now),/expired|changed/);
  const after=auth.expiresAt+1;assert.throws(()=>f.requests.revalidate(f.request.id,auth.id,{...f.run,leaseUntil:after+600000},f.runner.id,proof(undefined,after),after),/expired|changed/);
  f.envs.set({name:f.env.name,reviewers:['reader'],waitTimerMinutes:1},f.env.id);assert.throws(()=>f.requests.revalidate(f.request.id,auth.id,f.run,f.runner.id,proof(undefined,now),now),/changed/);
 }finally{f.db.close();}
});
