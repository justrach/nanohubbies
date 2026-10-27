import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'nh-cli-default-unit-'));after(()=>rm(dir,{recursive:true,force:true}));
await build({entryPoints:['cli/credentials','repository/store','repository/default-route'].map(p=>new URL('../src/'+p+'.ts',import.meta.url).pathname),bundle:true,platform:'node',format:'esm',outdir:dir,outbase:new URL('../src/',import.meta.url).pathname,outExtension:{'.js':'.mjs'}});
const load=p=>import(pathToFileURL(join(dir,p+'.mjs'))),{cliScopeAllowed,requestedScopes}=await load('cli/credentials'),{Repository}=await load('repository/store'),{defaultBranchRoute}=await load('repository/default-route');
const sha=c=>c.repeat(40),head=c=>({commit:sha(c),tree:sha(c)});
test('default branch delegation is separate from other admin grants and unavailable after archive or demotion',()=>{
 for(const role of ['writer','reader','member'])for(const writable of [true,false])assert.equal(cliScopeAllowed('repository:default',role,writable),false);
 for(const role of ['admin','owner']){assert.equal(cliScopeAllowed('repository:default',role,true),true);assert.equal(cliScopeAllowed('repository:default',role,false),false);}
 assert.deepEqual(requestedScopes(['repository:default','read']),['read','repository:default']);assert.throws(()=>requestedScopes(['repository:default']),/read access/);
 for(const scopes of [['read'],['read','rulesets:write'],['read','repository:archive'],['read','protections:write']])assert.ok(!requestedScopes(scopes).includes('repository:default'));
});
test('settings storage fences legacy SQL, ABA, delete/reinsert and old manual counters; rollback restores both revisions',()=>{
 const db=new DatabaseSync(':memory:'),sql={exec(q,...args){const rows=db.prepare(q).all(...args);return {toArray:()=>rows};}};
 try{
  sql.exec('CREATE TABLE versions(version INTEGER PRIMARY KEY,commit_sha TEXT,tree_sha TEXT)');const repo=new Repository(sql);repo.initialize();repo.update('refs/heads/main',null,head('a'),true,'owner');repo.update('refs/heads/develop',null,head('b'),true,'owner');
  const revision=repo.configuration().revision;assert.equal(revision,0);const rules=()=>sql.exec('SELECT revision FROM repository_rules_revision WHERE id=1').toArray()[0].revision,oldRules=rules();
  sql.exec("UPDATE repository_config SET default_branch='develop' WHERE id=1");assert.equal(repo.configuration().revision,1);assert.equal(rules(),oldRules+1);assert.equal(repo.selectDefault('develop',sha('b'),revision,'owner').conflict,true);
  sql.exec("UPDATE repository_config SET default_branch='main' WHERE id=1");assert.equal(repo.configuration().revision,2);assert.equal(repo.selectDefault('develop',sha('b'),revision,'owner').conflict,true);
  sql.exec("UPDATE repository_config SET default_branch='develop' WHERE id=1");sql.exec('UPDATE repository_settings_revision SET revision=revision+1 WHERE id=1');assert.equal(repo.configuration().revision,4);
  const current=repo.configuration(),ruleRevision=rules();sql.exec('BEGIN');sql.exec("UPDATE repository_config SET default_branch='main' WHERE id=1");sql.exec('ROLLBACK');assert.deepEqual(repo.configuration(),current);assert.equal(rules(),ruleRevision);
  sql.exec('DELETE FROM repository_config WHERE id=1');sql.exec("INSERT INTO repository_config VALUES(1,'develop')");assert.equal(repo.configuration().revision,6);assert.equal(repo.selectDefault('main',sha('a'),4,'owner').conflict,true);
  const selected=repo.selectDefault('main',sha('a'),6,'admin',{kind:'cli',credentialId:'credential-fixture'});assert.equal(selected.revision,7);assert.equal(repo.activity({kind:'settings'}).events[0].via.credentialId,'credential-fixture');const events=repo.activity({kind:'settings'}).events.length;
  assert.deepEqual(repo.selectDefault('main',sha('a'),7,'admin'),selected);assert.equal(repo.activity({kind:'settings'}).events.length,events);assert.equal(repo.selectDefault('main',sha('a'),6,'admin').conflict,true);
 }finally{db.close();}
});
test('delegated settings never fall back to a legacy writer and require exact conditional requests plus current permission',async()=>{
 const base={mode:'git',defaultBranch:'main',revision:0,branches:[{name:'main',commit:sha('a')}]},missing=method=>{throw Error(`The RPC receiver does not implement the method "${method}".`);};let legacy=0,writes=0;
 const seq={repositoryConfiguration:()=>base,defaultBranchConfiguration:()=>missing('defaultBranchConfiguration'),selectRepositoryDefault:()=>{legacy++;return base;},configureRepositoryDefault:()=>{writes++;return {conflict:true,...base};}};
 const hub={find:()=>({owner:'owner'}),repositoryArchive:()=>({archived:false,transition:null}),assertRepositoryWritable:()=>{}},env={HUB:{idFromName:x=>x,get:()=>hub},SEQUENCER:{idFromName:x=>x,get:()=>seq}},access={proof:{role:'admin',agentId:null}},browser={id:'owner'},delegate={...browser,cli:{credentialId:'fixture',scopes:['read','repository:default']}},body={branch:'main',commit:sha('a'),revision:0};
 const request=(method,condition,content=body)=>new Request('https://nanohub.invalid/api/trunks/fixture/default-branch',{method,headers:{Origin:'https://nanohub.invalid','Content-Type':'application/json',...(condition?{'If-Match':condition}:{})},...(method==='GET'?{}:{body:JSON.stringify(content)})});
 assert.equal((await defaultBranchRoute(env,request('GET'),'fixture',browser,access)).status,200);
 assert.equal((await defaultBranchRoute(env,request('GET'),'fixture',delegate,access)).status,503);
 assert.equal((await defaultBranchRoute(env,request('PUT'),'fixture',delegate,access)).status,428);
 assert.equal((await defaultBranchRoute(env,request('PUT','"default-1"'),'fixture',delegate,access)).status,400);
 assert.equal((await defaultBranchRoute(env,request('PUT','"default-0"'),'fixture',delegate,access)).status,503);assert.equal(legacy,0);assert.equal(writes,0);
 seq.defaultBranchConfiguration=()=>({...base,conditionalWrites:true,cliAudit:true,revisionTracking:'storage'});
 assert.equal((await defaultBranchRoute(env,request('PUT','"default-0"'),'fixture',delegate,access)).status,412);assert.equal(writes,1);
 const reader={...delegate,cli:{...delegate.cli,scopes:['read']}};assert.equal((await(await defaultBranchRoute(env,request('GET'),'fixture',reader,access)).json()).canManage,false);assert.equal((await defaultBranchRoute(env,request('PUT','"default-0"'),'fixture',reader,access)).status,403);
 assert.equal((await defaultBranchRoute(env,request('PUT','"default-0"'),'fixture',delegate,{proof:{role:'writer'}})).status,403);
 assert.equal((await defaultBranchRoute(env,request('PUT','"default-0"',{...body,credentialId:'spoof'}),'fixture',delegate,access)).status,400);
 seq.configureRepositoryDefault=()=>missing('configureRepositoryDefault');assert.equal((await defaultBranchRoute(env,request('PUT','"default-0"'),'fixture',delegate,access)).status,503);assert.equal(legacy,0);
 seq.defaultBranchConfiguration=()=>({...base,conditionalWrites:true,cliAudit:false,revisionTracking:'storage'});assert.equal((await defaultBranchRoute(env,request('GET'),'fixture',delegate,access)).status,503);
});
