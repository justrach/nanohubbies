import test,{after} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {build} from 'esbuild';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'nh-role-unit-'));after(()=>rm(dir,{recursive:true,force:true}));await build({entryPoints:['repository/rulesets','repository/store','repository/bypass','repository/actor','repository/ruleset-transfer','deployments/requirements','deployments/store','repository/policy','repository/cli-rulesets'].map(p=>new URL('../src/'+p+'.ts',import.meta.url).pathname),bundle:true,platform:'node',format:'esm',outdir:dir,outbase:new URL('../src/',import.meta.url).pathname,outExtension:{'.js':'.mjs'}});
const load=p=>import(pathToFileURL(join(dir,p+'.mjs'))),{Rulesets,validateRuleset}=await load('repository/rulesets'),{Repository}=await load('repository/store'),{rulesetBypass}=await load('repository/bypass'),{rulesetActor}=await load('repository/actor'),{exportRuleset,importRuleset}=await load('repository/ruleset-transfer'),{deploymentGate}=await load('deployments/requirements'),{Environments}=await load('deployments/store'),{Policies}=await load('repository/policy'),{cliRulesets}=await load('repository/cli-rulesets');
const input=(actors,extra={})=>({name:'Role restriction',target:'branch',enforcement:'active',conditions:{ref_name:{include:['~ALL'],exclude:[]}},rules:[{type:'creation'}],bypass_actors:actors,...extra}),actor=(id=5,mode='always')=>({actor_type:'RepositoryRole',actor_id:id,bypass_mode:mode});
const evidence=(role,extra={})=>({actor:'account',role,checkedAt:Date.now(),expiresAt:Date.now()+30000,...extra});
function fixture(){const db=new DatabaseSync(':memory:'),sql={exec(q,...args){const rows=db.prepare(q).all(...args);return{toArray:()=>rows};}};sql.exec('CREATE TABLE versions (version INTEGER PRIMARY KEY,commit_sha TEXT,tree_sha TEXT)');return{db,sql};}
test('supported role actors preserve numeric identity and reject invented IDs/types or invalid modes',()=>{
 for(const id of[4,5])assert.deepEqual(validateRuleset(input([actor(id)])).bypass_actors,[actor(id)]);
 for(const a of[actor('5'),actor(2),actor(1),actor(0),actor(6),{...actor(),actor_type:'OrganizationAdmin'},actor(5,'exempt')])assert.throws(()=>validateRuleset(input([a])),/Bypass/);
 assert.throws(()=>validateRuleset(input([actor(5,'pull_request')],{target:'tag',conditions:{ref_name:{include:['~ALL'],exclude:[]}}})),/Bypass/);
 assert.throws(()=>validateRuleset(input([actor(5),actor(5,'pull_request')])),/each repository role once/);
 const rule=validateRuleset(input([actor(5)]));assert.equal(exportRuleset(rule).bypass_actors,undefined);assert.throws(()=>importRuleset(rule),/Imported bypass/);
});
test('roles are exact, explicit, signed-human-only and bound to fresh matching membership',()=>{
 for(const role of['owner','admin'])assert.equal(rulesetBypass(input([actor(5)]),'account',true,false,evidence(role)).actor_id,5);
 for(const role of['writer','reader',null])assert.equal(rulesetBypass(input([actor(5)]),'account',true,false,evidence(role)),undefined);
 assert.equal(rulesetBypass(input([actor(4)]),'account',true,false,evidence('writer')).actor_id,4);
 assert.equal(rulesetBypass(input([actor(4)]),'account',true,false,evidence('admin')),undefined);
 assert.equal(rulesetBypass(input([actor(5)]),'account',false,true,evidence('admin')),undefined);
 assert.equal(rulesetBypass(input([{...actor(5),actor_type:'Team'}]),'account',true,true,evidence('admin')),undefined);
 for(const proof of[undefined,evidence('admin',{actor:'different'}),evidence('admin',{checkedAt:Date.now()-31000}),evidence('admin',{expiresAt:Date.now()-1}),evidence('admin',{checkedAt:Date.now()+5000}),evidence('admin',{expiresAt:NaN})])assert.equal(rulesetBypass(input([actor(5)]),'account',true,true,proof),undefined);
 assert.equal(rulesetBypass(input([actor(5,'pull_request')]),'account',true,false,evidence('admin')),undefined);
 assert.equal(rulesetBypass(input([actor(5,'pull_request')]),'account',true,true,evidence('admin')).actor_id,5);
});
test('native role lookup is fresh, uses stable account identity and does not infer admin from a display label',async()=>{
 let role='admin',calls=0;const env={HUB:{idFromName:x=>x,get:()=>({rulesetActor:(_trunk,id)=>{calls++;assert.equal(id,'account');return {binding:{kind:'owner'},role,checkedAt:Date.now()};}})}};
 assert.equal((await rulesetActor(env,'repo','account','https://fixture.invalid')).role,'admin');role='writer';assert.equal((await rulesetActor(env,'repo','account','https://fixture.invalid')).role,'writer');role=null;assert.equal((await rulesetActor(env,'repo','account','')).role,null);assert.equal(calls,3);
});
test('final rules and accepted audit use current role while independent policies and overlapping rules still block',()=>{
 const f=fixture();try{
  const rules=new Rulesets(f.sql),configured=rules.set(input([actor(5)])),proof=evidence('admin'),repo=new Repository(f.sql,undefined,proof);repo.initialize();
  repo.update('refs/heads/allowed',null,{commit:'a'.repeat(40),tree:'b'.repeat(40)},false,'account',false,undefined,true);
  const event=repo.activity({kind:'refs'}).events[0];assert.deepEqual(event.bypassedRulesets,[configured.id]);assert.equal(event.bypassRole.role,'admin');
  assert.throws(()=>new Repository(f.sql,undefined,evidence('writer')).update('refs/heads/denied',null,{commit:'a'.repeat(40),tree:'b'.repeat(40)},false,'account',false,undefined,true),/creation is restricted/);
  rules.set(input([],{name:'Independent restriction'}));assert.throws(()=>repo.update('refs/heads/overlap',null,{commit:'a'.repeat(40),tree:'b'.repeat(40)},false,'account',false,undefined,true),/Independent restriction/);
  assert.throws(()=>new Repository(f.sql,undefined,evidence('admin',{expiresAt:0})).update('refs/heads/stale',null,{commit:'a'.repeat(40),tree:'b'.repeat(40)},false,'account',false,undefined,true),/Current repository write membership/);
 }finally{f.db.close();}
});
test('deployment gate and rule insights agree on PR-only role bypass, without changing classic requirements',()=>{
 const f=fixture();try{
  new Environments(f.sql).set({name:'staging'});
  const rules=new Rulesets(f.sql);rules.set(input([actor(5,'pull_request')],{rules:[{type:'required_deployments',parameters:{required_deployment_environments:['staging']}}]}));
  assert.equal(deploymentGate(f.sql,'main','a'.repeat(40),'b'.repeat(40),'account',true).ready,false);
  assert.equal(deploymentGate(f.sql,'main','a'.repeat(40),'b'.repeat(40),'account',true,evidence('admin')).ready,true);
  new Policies(f.sql).set({branch:'main',pullRequest:false,approvals:0,checks:[],beforeOpen:[],preventForce:true,preventDelete:true,environments:['staging']});
  assert.equal(deploymentGate(f.sql,'main','a'.repeat(40),'b'.repeat(40),'account',true,evidence('admin')).ready,false);
 }finally{f.db.close();}
 const g=fixture();try{
  const rules=new Rulesets(g.sql),r=rules.set(input([actor(5,'pull_request')]));let attempt;
  assert.throws(()=>rules.enforce('refs/heads/topic',null,'a'.repeat(40),false,'account',true,false,undefined,undefined,v=>{attempt=v;},undefined,evidence('admin')),/creation is restricted/);
  rules.enforce('refs/heads/topic',null,'a'.repeat(40),false,'account',true,true,undefined,undefined,v=>{attempt=v;},undefined,evidence('admin'));
  assert.equal(attempt.evaluations[0].bypass.actor_type,'RepositoryRole');assert.equal(attempt.evaluations[0].bypass.role,'admin');assert.equal(attempt.evaluations[0].id,r.id);
 }finally{g.db.close();}
});

test('role-aware CLI edits wait for the stateful capability without falling back to a generic rule writer',async()=>{
 let writes=0,ready=false;const seq={rulesetPlan:()=>({revision:0,revisionTracking:'storage',rulesets:[],...(ready?{roleBypass:true}:{})}),configureRuleset:()=>{writes++;return{revision:1,rulesets:[]};}};
 const env={SEQUENCER:{idFromName:x=>x,get:()=>seq}},user={id:'account',cli:{credentialId:'fixture',scopes:['read','rulesets:write']}},access={proof:{role:'admin',agentId:null}};
 const request=()=>new Request('https://fixture.invalid/api/trunks/repo/rulesets',{method:'POST',headers:{'If-Match':'"ruleset-0"','Content-Type':'application/json'},body:JSON.stringify({configuration:input([actor(5)])})});
 let response=await cliRulesets(env,request(),'repo',undefined,undefined,user,access);assert.equal(response.status,503);assert.equal(response.headers.get('Retry-After'),'5');assert.equal(writes,0);
 ready=true;response=await cliRulesets(env,request(),'repo',undefined,undefined,user,access);assert.equal(response.status,201);assert.equal(writes,1);
});
