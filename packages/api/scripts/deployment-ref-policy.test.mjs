import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
const built=await build({stdin:{contents:`export * from './src/deployments/store';export * from './src/deployments/requests';export * from './src/deployments/ref-policy';export * from './src/ci/store';export * from './src/repository/store';export * from './src/repository/policy';export * from './src/repository/rulesets';`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,platform:'node',format:'esm',write:false});
const {Environments,DeploymentRequests,CIStore,Repository,Policies,Rulesets,deploymentRefPolicy,deploymentRefError}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const sha=c=>c.repeat(40),policy=branch=>({branch,pullRequest:false,approvals:0,checks:[],beforeOpen:[],preventForce:true,preventDelete:true});
const selected=rules=>({mode:'selected',rules}),rule=(type,name)=>({type,name});
function fixture(){const db=new DatabaseSync(':memory:'),sql={exec(query,...args){const rows=db.prepare(query).all(...args);return{toArray:()=>rows};}};sql.exec('CREATE TABLE versions(version INTEGER PRIMARY KEY,commit_sha TEXT,tree_sha TEXT)');const repo=new Repository(sql);repo.initialize();repo.update('refs/heads/main',null,{commit:sha('a'),tree:sha('1')},true,'owner');const ci=new CIStore(sql),runner=ci.runner('primary');let seed=ci.claim(runner.token);ci.complete(runner.token,seed.id,seed.attempt,[],null);repo.update('refs/heads/topic',null,{commit:sha('b'),tree:sha('2')},true,'owner');const branch=ci.claim(runner.token);repo.update('refs/tags/topic',null,{commit:sha('c'),tree:sha('2')},true,'owner',false,{old:null,next:sha('c'),linear:true,peeledCommit:sha('b')});const tag=ci.claim(runner.token);return{db,sql,repo,ci,runner,branch,tag,envs:new Environments(sql),requests:new DeploymentRequests(sql)};}
const report=(run,auth)=>({environment:'production',head:run.head,base:run.base,state:'success',deploymentId:'synthetic',url:'https://example.invalid/deployment',verifiedAt:Math.max(Date.now(),auth?.issuedAt??0),...(auth?{authorizationId:auth.id}:{})});
test('deployment policy validates and normalizes configuration; empty selection denies every ref',()=>{
 assert.equal(deploymentRefPolicy(undefined),undefined);assert.equal(deploymentRefPolicy({mode:'all'}),undefined);
 for(const value of [null,[],{}, {mode:'unknown'},{mode:'protected',rules:[]},{mode:'selected'},{mode:'selected',rules:Array(101).fill(rule('branch','main'))},selected([rule('branch','main'),rule('branch','main')]),selected([rule('branch','../bad')]),selected([rule('tag','[')]),selected([{type:'all',name:'*'}])])assert.throws(()=>deploymentRefPolicy(value));
 const f=fixture();try{const env=f.envs.set({name:'production',deploymentBranchPolicy:selected([])});assert.match(deploymentRefError(f.sql,env,'refs/heads/topic'),/not allowed/);assert.match(deploymentRefError(f.sql,env,'refs/tags/topic'),/not allowed/);assert.equal(f.envs.set({name:'production',deploymentBranchPolicy:selected([])},env.id).revision,env.revision);assert.equal(f.envs.set({name:'production'},env.id).revision,env.revision+1);}finally{f.db.close();}
});
test('selected policies distinguish branch/tag identities and apply path-aware, case-sensitive globs',()=>{
 const f=fixture();try{const env=f.envs.set({name:'production',deploymentBranchPolicy:selected([rule('branch','topic'),rule('tag','v*'),rule('branch','release/*')])});
  assert.equal(deploymentRefError(f.sql,env,'refs/heads/topic'),null);assert.equal(deploymentRefError(f.sql,env,'refs/tags/v1'),null);assert.equal(deploymentRefError(f.sql,env,'refs/heads/release/stable'),null);
  for(const ref of ['refs/tags/topic','refs/heads/v1','refs/heads/Topic','refs/heads/release/2026/stable'])assert.match(deploymentRefError(f.sql,env,ref),/not allowed/);
  assert.match(deploymentRefError(f.sql,env,undefined),/verified/);assert.throws(()=>f.requests.request(f.tag,env.name,f.runner.id),/not allowed/);
 }finally{f.db.close();}
});
test('restricted refs require pre-deployment authorization and reports cannot assert a different ref',()=>{
 const f=fixture();try{f.envs.set({name:'production',deploymentBranchPolicy:selected([rule('tag','topic')])});assert.throws(()=>f.requests.request(f.branch,'production',f.runner.id),/not allowed/);
  const request=f.requests.request(f.tag,'production',f.runner.id);assert.equal(request.ref,'refs/tags/topic');assert.equal(request.refTarget,sha('c'));assert.equal(f.requests.status(request,f.tag).state,'ready');
  assert.throws(()=>f.ci.complete(f.runner.token,f.tag.id,f.tag.attempt,[],null,Date.now(),[report(f.tag)]),/authorization/);
  const auth=f.requests.authorize(request.id,f.tag,f.runner.id);assert.throws(()=>f.ci.complete(f.runner.token,f.tag.id,f.tag.attempt,[],null,Date.now(),[{...report(f.tag,auth),ref:'refs/heads/topic'}]),/exact candidate/);
  f.ci.complete(f.runner.token,f.tag.id,f.tag.attempt,[],null,Date.now(),[report(f.tag,auth)]);const result=f.envs.gate(['production'],f.tag.head,f.tag.base);assert.equal(result.ready,true);assert.equal(result.environments[0].deployment.ref,'refs/tags/topic');assert.equal(result.environments[0].deployment.refTarget,sha('c'));
 }finally{f.db.close();}
});
test('current active protection gates authorization, final completion and stored success; bypass identities do not alter protected status',()=>{
 const f=fixture();try{const env=f.envs.set({name:'production',deploymentBranchPolicy:{mode:'protected'}});assert.equal(deploymentRefError(f.sql,env,'refs/heads/topic'),null);assert.match(deploymentRefError(f.sql,env,'refs/tags/topic'),/tags cannot/);
  const request=f.requests.request(f.branch,env.name,f.runner.id),auth=f.requests.authorize(request.id,f.branch,f.runner.id),policies=new Policies(f.sql);policies.set(policy('main'));assert.equal(f.requests.status(request,f.branch).state,'stale');assert.throws(()=>f.requests.authorize(request.id,f.branch,f.runner.id),/no active branch protection/);assert.throws(()=>f.ci.complete(f.runner.token,f.branch.id,f.branch.attempt,[],null,Date.now(),[report(f.branch,auth)]),/no active branch protection/);
  const rules=new Rulesets(f.sql),draft={name:'topic guard',target:'branch',enforcement:'evaluate',conditions:{ref_name:{include:['refs/heads/topic'],exclude:[]}},rules:[{type:'deletion'}],bypass_actors:[{actor_type:'User',actor_id:'owner',bypass_mode:'always'}]};const saved=rules.set(draft);assert.match(deploymentRefError(f.sql,env,'refs/heads/topic'),/no active/);rules.set({...draft,enforcement:'active'},saved.id);assert.equal(deploymentRefError(f.sql,env,'refs/heads/topic'),null);
  f.ci.complete(f.runner.token,f.branch.id,f.branch.attempt,[],null,Date.now(),[report(f.branch,auth)]);assert.equal(f.envs.gate(['production'],f.branch.head,f.branch.base).ready,true);rules.remove(saved.id);assert.equal(f.envs.gate(['production'],f.branch.head,f.branch.base).ready,false);policies.remove('main');assert.equal(deploymentRefError(f.sql,env,'refs/heads/topic'),null);
 }finally{f.db.close();}
});
test('environment policy revision invalidates pending requests, authorization and recorded successes',()=>{
 const f=fixture();try{let env=f.envs.set({name:'production',deploymentBranchPolicy:selected([rule('branch','topic')])});const request=f.requests.request(f.branch,env.name,f.runner.id),auth=f.requests.authorize(request.id,f.branch,f.runner.id);env=f.envs.set({name:env.name,deploymentBranchPolicy:selected([rule('branch','topic'),rule('tag','v*')])},env.id);assert.equal(f.requests.status(request,f.branch).state,'stale');assert.throws(()=>f.ci.complete(f.runner.token,f.branch.id,f.branch.attempt,[],null,Date.now(),[report(f.branch,auth)]),/expired|changed/);
  const fresh=f.requests.request(f.branch,env.name,f.runner.id),next=f.requests.authorize(fresh.id,f.branch,f.runner.id);f.ci.complete(f.runner.token,f.branch.id,f.branch.attempt,[],null,Date.now(),[report(f.branch,next)]);assert.equal(f.envs.gate(['production'],f.branch.head,f.branch.base).ready,true);f.envs.set({name:env.name,deploymentBranchPolicy:selected([rule('tag','v*')])},env.id);assert.equal(f.envs.gate(['production'],f.branch.head,f.branch.base).ready,false);
 }finally{f.db.close();}
});
test('annotated tag target changes and same-named branch pushes have independent run identities and leases',()=>{
 const f=fixture();try{assert.equal(f.tag.head,f.branch.head);assert.notEqual(f.tag.id,f.branch.id);assert.equal(f.tag.refTarget,sha('c'));f.envs.set({name:'production',deploymentBranchPolicy:selected([rule('tag','topic')])});const request=f.requests.request(f.tag,'production',f.runner.id);
  f.repo.update('refs/tags/topic',sha('c'),{commit:sha('d'),tree:sha('2')},true,'owner',false,{old:sha('c'),next:sha('d'),linear:true,peeledCommit:sha('b')});assert.equal(f.ci.get(f.tag.id).state,'superseded');assert.equal(f.ci.get(f.branch.id).state,'running');assert.equal(f.ci.readable(f.tag.readToken),false);assert.equal(f.requests.status(request,f.ci.get(f.tag.id)).state,'stale');const replacement=f.ci.claim(f.runner.token);assert.notEqual(replacement.id,f.tag.id);assert.equal(replacement.head,f.tag.head);assert.equal(replacement.refTarget,sha('d'));
  f.repo.update('refs/heads/topic',sha('b'),{commit:sha('e'),tree:sha('3')},true,'owner');assert.equal(f.ci.get(replacement.id).state,'running');assert.equal(f.ci.get(f.branch.id).state,'superseded');
 }finally{f.db.close();}
});
