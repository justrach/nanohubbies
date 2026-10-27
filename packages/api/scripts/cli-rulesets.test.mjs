import test,{after} from 'node:test';import assert from 'node:assert/strict';import{DatabaseSync}from'node:sqlite';import{build}from'esbuild';import{mkdtemp,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';import{pathToFileURL}from'node:url';
const dir=await mkdtemp(join(tmpdir(),'nh-ruleset-cli-'));after(()=>rm(dir,{recursive:true,force:true}));
await build({entryPoints:['repository/rulesets','repository/cli-rulesets','cli/credentials'].map(p=>new URL('../src/'+p+'.ts',import.meta.url).pathname),bundle:true,platform:'node',format:'esm',outdir:dir,outExtension:{'.js':'.mjs'}});
const load=p=>import(pathToFileURL(join(dir,p+'.mjs'))),{Rulesets}=await load('repository/rulesets'),{cliRulesets}=await load('repository/cli-rulesets'),{cliScopeAllowed,requestedScopes}=await load('cli/credentials');
const configuration={name:'Restricted creation',target:'branch',enforcement:'active',conditions:{ref_name:{include:['refs/heads/restricted/**'],exclude:[]}},rules:[{type:'creation'}],bypass_actors:[{actor_type:'User',actor_id:'owner',bypass_mode:'always'}]};
test('ruleset permission is a distinct current-admin grant; old grants do not acquire it',()=>{
 for(const role of ['reader','writer','member'])assert.equal(cliScopeAllowed('rulesets:write',role,true),false);
 for(const role of ['owner','admin']){assert.equal(cliScopeAllowed('rulesets:write',role,true),true);assert.equal(cliScopeAllowed('rulesets:write',role,false),false);}
 assert.deepEqual(requestedScopes(['read','protections:write']),['read','protections:write']);assert.deepEqual(requestedScopes(['read','rulesets:write']),['read','rulesets:write']);
});
test('ruleset storage revisions fence older SQL, ABA restoration, counter gaps, rollback and partial repair',()=>{
 const db=new DatabaseSync(':memory:'),sql={exec(q,...args){const rows=db.prepare(q).all(...args);return{toArray:()=>rows};}};
 try{
  db.exec('CREATE TABLE repository_rulesets(id INTEGER PRIMARY KEY AUTOINCREMENT,data TEXT NOT NULL);CREATE TABLE repository_rules_revision(id INTEGER PRIMARY KEY,revision INTEGER NOT NULL);INSERT INTO repository_rules_revision VALUES(1,8)');
  let rules=new Rulesets(sql);assert.equal(rules.plan().revision,9);assert.equal(rules.plan().revisionTracking,'storage');const created=rules.set(configuration);assert.equal(rules.plan().revision,10);
  const exported=rules.plan();sql.exec('UPDATE repository_rulesets SET data=? WHERE id=?',JSON.stringify({...configuration,name:'Changed'}),created.id).toArray();sql.exec('UPDATE repository_rulesets SET data=? WHERE id=?',JSON.stringify(configuration),created.id).toArray();assert.deepEqual(rules.plan().rulesets,exported.rulesets);assert.equal(rules.plan().revision,12);
  db.exec('BEGIN');sql.exec('DELETE FROM repository_rulesets WHERE id=?',created.id).toArray();assert.equal(rules.plan().revision,13);db.exec('ROLLBACK');assert.equal(rules.plan().revision,12);assert.equal(rules.plan().rulesets.length,1);
  db.exec('UPDATE repository_rules_revision SET revision=revision+1 WHERE id=1');rules.invalidate();assert.equal(rules.plan().revision,14);assert.equal(new Rulesets(sql).plan().revision,14);
  db.exec('DROP TRIGGER repository_rules_revision_delete');rules=new Rulesets(sql);assert.equal(rules.plan().revision,15);rules.remove(created.id);assert.equal(rules.plan().revision,16);
 }finally{db.close();}
});
test('CLI reads redact bypasses unless current admin scope permits a complete export; conditional edits never downgrade',async()=>{
 let writes=0;const plan={revision:4,revisionTracking:'storage',rulesets:[{...configuration,id:1}]};
 const seq={rulesetPlan:()=>plan,configureRuleset:()=>{writes++;return{...plan,revision:5};},setRuleset:()=>{throw Error('No legacy writes');}};
 const env={SEQUENCER:{idFromName:x=>x,get:()=>seq}},access={proof:{role:'admin'}},user={id:'owner',cli:{credentialId:'fixture',scopes:['read','protections:write']}};
 const request=(method,body,revision='"ruleset-4"')=>new Request('https://nanohub.invalid/api/trunks/fixture/rulesets/1',{method,headers:{...(revision===null?{}:{'If-Match':revision}),'Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(body)})});
 let response=await cliRulesets(env,request('GET'),'fixture','1',undefined,user,access);assert.equal((await response.json()).ruleset.bypass_actors,undefined);
 assert.equal((await cliRulesets(env,request('GET'),'fixture','1','configuration',user,access)).status,403);
 user.cli.scopes=['read','rulesets:write'];response=await cliRulesets(env,request('GET'),'fixture','1','configuration',user,access);assert.deepEqual(await response.json(),{revision:4,configuration});
 assert.equal((await cliRulesets(env,request('PUT',{configuration},null),'fixture','1',undefined,user,access)).status,428);
 for(const revision of ['*','4','"ruleset-04"','"ruleset-9007199254740992"'])assert.equal((await cliRulesets(env,request('PUT',{configuration},revision),'fixture','1',undefined,user,access)).status,400);
 for(const body of [null,[],{configuration,bypass:true},{configuration:{...configuration,bypass_actors:undefined}}])assert.equal((await cliRulesets(env,request('PUT',body),'fixture','1',undefined,user,access)).status,400);
 plan.revisionTracking=undefined;assert.equal((await cliRulesets(env,request('PUT',{configuration}),'fixture','1',undefined,user,access)).status,503);assert.equal(writes,0);
 plan.revisionTracking='storage';seq.configureRuleset=()=>{throw Error('The RPC receiver does not implement the method "configureRuleset".');};response=await cliRulesets(env,request('PUT',{configuration}),'fixture','1',undefined,user,access);assert.equal(response.status,503);assert.equal(response.headers.get('Retry-After'),'5');assert.equal(writes,0);
});
