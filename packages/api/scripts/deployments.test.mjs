import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
const built=await build({stdin:{contents:`export * from './src/deployments/store';export * from './src/deployments/requirements';export * from './src/ci/store';export * from './src/repository/store';export * from './src/repository/policy';export * from './src/repository/rulesets';export * from './src/repository/ruleset-transfer';export * from './src/repository/insights';`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,platform:'node',format:'esm',write:false});
const {Environments,environmentNames,CIStore,Repository,Policies,Rulesets,importRuleset,exportRuleset,ruleTransaction,RuleInsights,deploymentGate}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const sha=c=>c.repeat(40),result={name:'test',state:'success',command:'bun test',log:'ok',artifacts:[]};
function fixture(){
 const db=new DatabaseSync(':memory:'),sql={exec(q,...args){const rows=db.prepare(q).all(...args);return{toArray:()=>rows};}};
 sql.exec('CREATE TABLE versions(version INTEGER PRIMARY KEY,commit_sha TEXT,tree_sha TEXT)');const repo=new Repository(sql);repo.initialize();repo.update('refs/heads/main',null,{commit:sha('a'),tree:sha('1')},true,'owner');
 const ci=new CIStore(sql),environments=new Environments(sql),runner=ci.runner('primary'),other=ci.runner('secondary');const seed=ci.claim(runner.token);if(seed)ci.complete(runner.token,seed.id,seed.attempt,[],null);
 const tx=run=>{db.exec('BEGIN');try{const value=run();db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}};
 const report=(environment='staging',extra={})=>({environment,head:sha('b'),base:sha('a'),state:'success',deploymentId:'synthetic-deploy-1',url:'https://staging.example.invalid/build',verifiedAt:Date.now(),...extra});
 const claim=(branch='feature')=>{ci.enqueue(branch,sha('b'),sha('a'));return ci.claim(runner.token);};
 return{db,sql,repo,ci,environments,runner,other,tx,report,claim};
}
const policy=(extra={})=>({branch:'main',pullRequest:false,approvals:0,checks:[],beforeOpen:[],preventForce:true,preventDelete:true,...extra});
const ruleset=(extra={})=>({name:'Deploy staging first',target:'branch',enforcement:'active',conditions:{ref_name:{include:['~DEFAULT_BRANCH'],exclude:[]}},rules:[{type:'required_deployments',parameters:{required_deployment_environments:['staging']}}],...extra});

test('environments bind case-insensitive stable names, active sources and revisions; unknown fields and cross-repo sources reject',()=>{
 const f=fixture();try{
  const env=f.environments.set({name:'Staging',runner:f.runner.id});assert.equal(f.environments.find('STAGING').id,env.id);assert.deepEqual(f.environments.set({name:'Staging',runner:f.runner.id},env.id),env);
  assert.throws(()=>f.environments.set({name:'staging'}),/already exists/);assert.throws(()=>f.environments.set({name:'different'},env.id),/names cannot/);
  const next=f.environments.set({name:'Staging',runner:f.other.id},env.id);assert.equal(next.revision,2);assert.equal(next.id,env.id);
  for(const value of [{name:' bad '},{name:'x\n'},{name:'x',runner:'not-a-source'},{name:'x',secrets:['private']},{name:''}])assert.throws(()=>f.environments.set(value));
  f.ci.revoke(f.other.id);assert.throws(()=>f.environments.set({name:'Staging',runner:f.other.id},env.id),/active/);
  f.environments.remove(env.id);assert.notEqual(f.environments.set({name:'staging'}).id,env.id);
  assert.deepEqual(environmentNames(['Staging','STAGING']),['STAGING']);assert.throws(()=>environmentNames(Array.from({length:31},(_,i)=>`env-${i}`)),/30/);
 }finally{f.db.close();}
});

test('successful checks do not satisfy deployments; authenticated lease reports bind exact head/base and cannot spoof source',()=>{
 const f=fixture();try{
  f.environments.set({name:'staging',runner:f.runner.id});const run=f.claim();f.ci.complete(f.runner.token,run.id,run.attempt,[result],null);assert.equal(f.environments.gate(['staging'],sha('b'),sha('a')).ready,false);
  f.ci.retry(run.id,sha('b'),sha('a'));const retry=f.ci.claim(f.runner.token),report=f.report();
  for(const bad of [{...report,runner:f.runner.id},{...report,head:sha('c')},{...report,base:sha('c')},{...report,environment:'missing'},{...report,url:'javascript:alert(1)'},{...report,url:'https://user:pass@host.invalid'},{...report,verifiedAt:1},{...report,verifiedAt:Date.now()+60000}])assert.throws(()=>f.tx(()=>f.ci.complete(f.runner.token,retry.id,retry.attempt,[result],null,Date.now(),[bad])));
  assert.throws(()=>f.ci.complete(f.other.token,retry.id,retry.attempt,[result],null,Date.now(),[report]),/Stale/);
  f.tx(()=>f.ci.complete(f.runner.token,retry.id,retry.attempt,[result],null,Date.now(),[report]));const gate=f.environments.gate(['staging'],sha('b'),sha('a'));assert.equal(gate.ready,true);assert.equal(gate.environments[0].deployment.runner,f.runner.id);assert.equal(gate.environments[0].deployment.attempt,2);
  assert.equal(f.environments.gate(['staging'],sha('c'),sha('a')).ready,false);assert.equal(f.environments.gate(['staging'],sha('b'),sha('c')).ready,false);
  assert.equal(f.environments.gate(['staging','missing'],sha('b'),sha('a')).ready,false);
 }finally{f.db.close();}
});

test('latest failed/cancelled reports override success; exact completion retry is idempotent and payload changes reject',()=>{
 const f=fixture();try{
  f.environments.set({name:'staging'});const run=f.claim(),report=f.report();f.ci.complete(f.runner.token,run.id,run.attempt,[],null,Date.now(),[report]);f.ci.complete(f.runner.token,run.id,run.attempt,[],null,Date.now(),[report]);assert.equal(f.sql.exec('SELECT COUNT(*) AS n FROM deployment_records').toArray()[0].n,1);
  assert.throws(()=>f.ci.complete(f.runner.token,run.id,run.attempt,[],null,Date.now(),[{...report,state:'failure'}]),/Conflicting/);
  for(const state of ['failure','cancelled']){f.ci.retry(run.id,sha('b'),sha('a'));const retry=f.ci.claim(f.runner.token);f.ci.complete(f.runner.token,retry.id,retry.attempt,[],null,Date.now(),[f.report('staging',{state})]);assert.equal(f.environments.gate(['staging'],sha('b'),sha('a')).ready,false);assert.match(f.environments.gate(['staging'],sha('b'),sha('a')).environments[0].error,new RegExp(state));}
 }finally{f.db.close();}
});

test('current environment revisions, reporter revocation and deletion prevent stale success reuse',()=>{
 const f=fixture();try{
  const env=f.environments.set({name:'staging'}),run=f.claim();f.ci.complete(f.runner.token,run.id,run.attempt,[],null,Date.now(),[f.report()]);assert.equal(f.environments.gate(['staging'],sha('b'),sha('a')).ready,true);
  f.environments.set({name:'staging',runner:f.runner.id},env.id);assert.match(f.environments.gate(['staging'],sha('b'),sha('a')).environments[0].error,/changed/);
  f.ci.retry(run.id,sha('b'),sha('a'));const retry=f.ci.claim(f.runner.token);f.ci.complete(f.runner.token,retry.id,retry.attempt,[],null,Date.now(),[f.report()]);assert.equal(f.environments.gate(['staging'],sha('b'),sha('a')).ready,true);
  f.ci.revoke(f.runner.id);assert.equal(f.environments.gate(['staging'],sha('b'),sha('a')).ready,false);f.ci.runner('primary');assert.equal(f.environments.gate(['staging'],sha('b'),sha('a')).ready,false);
  f.environments.remove(env.id);f.environments.set({name:'staging'});assert.equal(f.environments.gate(['staging'],sha('b'),sha('a')).ready,false);
 }finally{f.db.close();}
});

test('classic requirements compose with rulesets; evaluate observes, human bypass is scoped, and failed writes retain insights',()=>{
 const f=fixture();try{
  f.environments.set({name:'staging'});f.environments.set({name:'production'});const policies=new Policies(f.sql),rules=new Rulesets(f.sql);
  policies.set(policy({branch:'ma*',environments:['staging']}));policies.set(policy({environments:['production']}));assert.deepEqual([...policies.get('main').environments].sort(),['production','staging']);
  assert.throws(()=>policies.set(policy({environments:['missing']})),/Unknown/);
  rules.set(ruleset({enforcement:'evaluate'}));const change=repo=>repo.update('refs/heads/main',sha('a'),{commit:sha('b'),tree:sha('2')},true,'owner',true,undefined,true);
  assert.throws(()=>ruleTransaction(f.sql,f.tx,'merge',observe=>change(new Repository(f.sql,observe))),/deployment/);assert.equal(f.repo.main().commit,sha('a'));assert.equal(new RuleInsights(f.sql).list().suites[0].accepted,false);
  policies.remove('main');policies.remove('ma*');ruleTransaction(f.sql,f.tx,'merge',observe=>change(new Repository(f.sql,observe)));assert.equal(f.repo.main().commit,sha('b'));assert.equal(new RuleInsights(f.sql).list().suites[0].evaluations[0].enforcement,'evaluate');
  const r=rules.set(ruleset({enforcement:'active',bypass_actors:[{actor_type:'User',actor_id:'owner',bypass_mode:'always'}]}),1);
  assert.throws(()=>f.tx(()=>f.repo.update('refs/heads/main',sha('b'),{commit:sha('c'),tree:sha('3')},true,'owner',true)),/deployment/);
  f.tx(()=>f.repo.update('refs/heads/main',sha('b'),{commit:sha('c'),tree:sha('3')},true,'owner',true,undefined,true));assert.equal(f.repo.main().commit,sha('c'));
  policies.set(policy({environments:['staging']}));assert.throws(()=>f.tx(()=>f.repo.update('refs/heads/main',sha('c'),{commit:sha('d'),tree:sha('4')},true,'owner',true,undefined,true)),/deployment/);
  assert.equal(deploymentGate(f.sql,'main',sha('d'),sha('c'),'owner',true).ready,false);assert.equal(r.id,1);
 }finally{f.db.close();}
});

test('deployment event and CI completion rollback together on a late write failure',()=>{
 const f=fixture();try{
  f.environments.set({name:'staging'});const run=f.claim(),report=f.report();
  f.sql.exec("CREATE TRIGGER reject_complete BEFORE UPDATE ON ci_runs WHEN json_extract(NEW.data,'$.state')='complete' BEGIN SELECT RAISE(ABORT,'synthetic late failure'); END");
  assert.throws(()=>f.tx(()=>f.ci.complete(f.runner.token,run.id,run.attempt,[],null,Date.now(),[report])),/late failure/);assert.equal(f.ci.get(run.id).state,'running');assert.equal(f.sql.exec('SELECT COUNT(*) AS n FROM deployment_records').toArray()[0].n,0);
  f.sql.exec('DROP TRIGGER reject_complete');f.tx(()=>f.ci.complete(f.runner.token,run.id,run.attempt,[],null,Date.now(),[report]));assert.equal(f.environments.gate(['staging'],sha('b'),sha('a')).ready,true);
 }finally{f.db.close();}
});

test('legacy approved staging evidence bridges to the configured staging environment without treating a bare check as deployment',()=>{
 const f=fixture();try{
  f.environments.set({name:'staging'});const queued=f.ci.enqueue('feature',sha('b'),sha('a'));f.ci.approveDeployment(queued.id,'owner',sha('b'),sha('a'));const run=f.ci.claim(f.runner.token);
  const staging={runId:'synthetic-staging',head:sha('b'),candidate:sha('b'),base:sha('a'),version:sha('b'),verifiedAt:Date.now(),acceptance:[{url:'https://stage.example.invalid/health',realService:true}]};
  f.ci.complete(f.runner.token,run.id,run.attempt,[{...result,name:'staging'}],staging);assert.equal(f.environments.gate(['staging'],sha('b'),sha('a')).ready,true);
  assert.equal(f.environments.gate(['staging'],sha('b'),sha('a')).environments[0].deployment.deploymentId,staging.runId);
 }finally{f.db.close();}
});

test('required_deployments JSON preserves mode and environment names; wrong targets, parameters and unknown environments reject',()=>{
 const f=fixture();try{
  f.environments.set({name:'staging'});const rule=ruleset({enforcement:'evaluate'}),saved=new Rulesets(f.sql).set(rule),portable=exportRuleset(saved);assert.deepEqual(importRuleset(portable).configuration.rules,rule.rules);assert.equal(portable.enforcement,'evaluate');
  for(const bad of [{...rule,target:'tag'},{...rule,target:'push',conditions:undefined},{...rule,rules:[{type:'required_deployments',parameters:{required_deployment_environments:[]}}]},{...rule,rules:[{type:'required_deployments',parameters:{required_deployment_environments:['missing']}}]}])assert.throws(()=>new Rulesets(f.sql).set(bad));
 }finally{f.db.close();}
});


test('a report verified before an environment change cannot acquire its new revision at delivery',()=>{
 const f=fixture();try{
  const env=f.environments.set({name:'staging'}),run=f.claim(),report=f.report();const changed={...env,revision:env.revision+1,runner:f.runner.id,updatedAt:report.verifiedAt+10};
  f.sql.exec('UPDATE deployment_environments SET data=? WHERE id=?',JSON.stringify(changed),env.id);
  assert.throws(()=>f.tx(()=>f.ci.complete(f.runner.token,run.id,run.attempt,[],null,report.verifiedAt+20,[report])),/changed/);
  assert.equal(f.sql.exec('SELECT COUNT(*) AS n FROM deployment_records').toArray()[0].n,0);
  f.tx(()=>f.ci.complete(f.runner.token,run.id,run.attempt,[],null,changed.updatedAt+1,[{...report,verifiedAt:changed.updatedAt+1}]));assert.equal(f.environments.gate(['staging'],sha('b'),sha('a')).ready,true);
 }finally{f.db.close();}
});


test('required deployments also protect ref creation; a deployed exact candidate may be copied to a protected branch',()=>{
 const f=fixture();try{
  f.environments.set({name:'staging'});new Policies(f.sql).set(policy({branch:'protected/*',environments:['staging']}));
  assert.throws(()=>f.tx(()=>f.repo.update('refs/heads/protected/topic',null,{commit:sha('b'),tree:sha('2')},true,'owner')),/deployment/);
  const run=f.claim();f.ci.complete(f.runner.token,run.id,run.attempt,[],null,Date.now(),[f.report()]);f.tx(()=>f.repo.update('refs/heads/protected/topic',null,{commit:sha('b'),tree:sha('2')},true,'owner'));
  new Rulesets(f.sql).set(ruleset({conditions:{ref_name:{include:['refs/heads/rules/**'],exclude:[]}}}));
  assert.throws(()=>f.tx(()=>f.repo.update('refs/heads/rules/blocked',null,{commit:sha('c'),tree:sha('3')},true,'owner')),/deployment/);
  f.tx(()=>f.repo.update('refs/heads/rules/deployed',null,{commit:sha('b'),tree:sha('2')},true,'owner'));assert.ok(f.repo.refs().some(r=>r.name==='refs/heads/rules/deployed'));
 }finally{f.db.close();}
});


test('one atomic main-plus-release batch uses the pre-push deployment base for every ref',()=>{
 const f=fixture();try{
  f.environments.set({name:'staging'});new Policies(f.sql).set(policy({environments:['staging']}));new Rulesets(f.sql).set(ruleset({conditions:{ref_name:{include:['refs/heads/release/**'],exclude:[]}}}));
  const run=f.claim();f.ci.complete(f.runner.token,run.id,run.attempt,[],null,Date.now(),[f.report()]);
  f.tx(()=>{const before=f.repo.main().commit;f.repo.update('refs/heads/main',sha('a'),{commit:sha('b'),tree:sha('2')},true,'owner',false,undefined,false,undefined,before);f.repo.update('refs/heads/release/one',null,{commit:sha('b'),tree:sha('2')},true,'owner',false,undefined,false,undefined,before);});
  assert.equal(f.repo.main().commit,sha('b'));assert.ok(f.repo.refs().some(r=>r.name==='refs/heads/release/one'&&r.commit===sha('b')));
 }finally{f.db.close();}
});
