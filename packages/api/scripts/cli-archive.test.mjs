import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const directory=await mkdtemp(join(tmpdir(),'nh-archive-cli-unit-'));after(()=>rm(directory,{recursive:true,force:true}));
await build({entryPoints:['cli/credentials','repository/archive','repository/archive-route'].map(p=>new URL('../src/'+p+'.ts',import.meta.url).pathname),bundle:true,platform:'node',format:'esm',outdir:directory,outbase:new URL('../src/',import.meta.url).pathname,outExtension:{'.js':'.mjs'}});
const {cliScopeAllowed,requestedScopes}=await import(pathToFileURL(join(directory,'cli/credentials.mjs')));
const {ArchiveStore}=await import(pathToFileURL(join(directory,'repository/archive.mjs')));
const {archiveRoute}=await import(pathToFileURL(join(directory,'repository/archive-route.mjs')));
test('archive delegation requires current admin even while writable; archived delegation enables lifecycle control only',()=>{
 for(const role of ['reader','writer','member'])for(const writable of [false,true])assert.equal(cliScopeAllowed('repository:archive',role,writable),false);
 for(const role of ['owner','admin']){
  assert.equal(cliScopeAllowed('repository:archive',role,false),true);assert.equal(cliScopeAllowed('repository:archive',role,true),true);
  for(const scope of ['contents:write','reviews:write','protections:write','rulesets:write'])assert.equal(cliScopeAllowed(scope,role,false),false);
 }
 assert.deepEqual(requestedScopes(['read','reviews:write']),['read','reviews:write']);
 assert.deepEqual(requestedScopes(['repository:archive','read']),['read','repository:archive']);
 assert.throws(()=>requestedScopes(['repository:archive']),/read access/);
});
test('conditional lifecycle edits reject stale no-ops and ABA, resume interrupted changes and preserve original CLI audit provenance',()=>{
 const db=new DatabaseSync(':memory:'),sql={exec(q,...args){const rows=db.prepare(q).all(...args);return {toArray:()=>rows};}};
 try{
  const store=new ArchiveStore(sql),via={kind:'cli',credentialId:'fixture-credential'};
  let state=store.prepare(true,0,'owner',1,{conditional:true,via}),change=state.transition;
  assert.deepEqual(new ArchiveStore(sql).state().transition.via,via);
  assert.equal(store.prepare(true,0,'admin',2,{conditional:true,via:{kind:'cli',credentialId:'another'}}).transition.id,change.id);
  store.complete(change);assert.throws(()=>store.prepare(true,0,'owner',3,{conditional:true}),/state changed/);
  assert.equal(store.prepare(true,1,'owner',3,{conditional:true}).revision,1);
  state=store.prepare(false,1,'owner',4,{conditional:true,via});change=state.transition;store.beginOpening(change);
  assert.equal(store.prepare(false,1,'owner',5,{conditional:true}).transition.id,change.id);store.complete(change);
  assert.equal(store.state().revision,2);assert.throws(()=>store.prepare(true,0,'owner',6,{conditional:true}),/state changed/);
  // Browser retry compatibility is retained; no new unsafe RPC uses this mode.
  assert.equal(store.prepare(false,1,'owner').revision,2);
 }finally{db.close();}
});
test('archive gateway keeps browser reads during rollout and never downgrades a delegated conditional write',async()=>{
 let legacyWrites=0,conditionalWrites=0;
 const missing=method=>{throw Error(`The RPC receiver does not implement the method "${method}".`);};
 const state={archived:false,revision:0,actor:null,updatedAt:null,transition:null};
 const hub={find:()=>({owner:'owner'}),repositoryAddress:()=>({name:'fixture'}),repositoryArchive:()=>state,archiveConfiguration:()=>missing('archiveConfiguration'),archiveRepository:()=>{legacyWrites++;return state;},configureRepositoryArchive:()=>missing('configureRepositoryArchive')};
 const receiver={archiveConfiguration:()=>({cliAudit:true})},env={HUB:{idFromName:x=>x,get:()=>hub},SEQUENCER:{idFromName:x=>x,get:()=>receiver}},access={proof:{role:'admin',agentId:null}},browser={id:'owner'},delegate={...browser,cli:{credentialId:'fixture',scopes:['read','repository:archive']}};
 const request=(method,extra={})=>new Request('https://nanohub.invalid/api/trunks/fixture/archive',{method,headers:{Origin:'https://nanohub.invalid','Content-Type':'application/json',...extra},...(method==='GET'?{}:{body:JSON.stringify({archived:true,revision:0,confirmation:'fixture'})})});
 assert.equal((await archiveRoute(env,request('GET'),'fixture',browser,access)).status,200);
 let response=await archiveRoute(env,request('GET'),'fixture',delegate,access);assert.equal(response.status,503);assert.equal(response.headers.get('Retry-After'),'5');
 assert.equal((await archiveRoute(env,request('POST'),'fixture',delegate,access)).status,428);
 assert.equal((await archiveRoute(env,request('POST',{'If-Match':'"archive-1"'}),'fixture',delegate,access)).status,400);
 assert.equal((await archiveRoute(env,request('POST',{'If-Match':'"archive-0"'}),'fixture',delegate,access)).status,503);
 hub.archiveConfiguration=()=>({...state,conditionalWrites:true,nameConfirmation:true});
 assert.equal((await archiveRoute(env,request('POST',{'If-Match':'"archive-0"'}),'fixture',delegate,access)).status,503);assert.equal(legacyWrites,0);
 hub.configureRepositoryArchive=()=>{conditionalWrites++;throw Error('Archive state changed; refresh before continuing');};
 assert.equal((await archiveRoute(env,request('POST',{'If-Match':'"archive-0"'}),'fixture',delegate,access)).status,412);assert.equal(conditionalWrites,1);
 const readOnly={...browser,cli:{credentialId:'fixture',scopes:['read']}};
 response=await archiveRoute(env,request('GET'),'fixture',readOnly,access);assert.equal((await response.json()).canManage,false);
 assert.equal((await archiveRoute(env,request('POST',{'If-Match':'"archive-0"'}),'fixture',readOnly,access)).status,403);
 hub.archiveConfiguration=()=>({...state});assert.equal((await archiveRoute(env,request('GET'),'fixture',delegate,access)).status,503);
 hub.archiveConfiguration=()=>({...state,conditionalWrites:true,nameConfirmation:true});receiver.archiveConfiguration=()=>({cliAudit:false});assert.equal((await archiveRoute(env,request('GET'),'fixture',delegate,access)).status,503);
 receiver.archiveConfiguration=()=>missing('archiveConfiguration');assert.equal((await archiveRoute(env,request('POST',{'If-Match':'"archive-0"'}),'fixture',delegate,access)).status,503);assert.equal(legacyWrites,0);
 receiver.archiveConfiguration=()=>({cliAudit:true});
 hub.archiveConfiguration=()=>{throw Error('Storage failure');};await assert.rejects(archiveRoute(env,request('GET'),'fixture',delegate,access),/Storage failure/);
});
