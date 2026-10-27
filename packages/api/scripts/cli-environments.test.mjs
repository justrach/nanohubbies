import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {build} from 'esbuild';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';import {after} from 'node:test';
const dir=await mkdtemp(join(tmpdir(),'nh-env-unit-'));after(()=>rm(dir,{recursive:true,force:true}));
await build({entryPoints:[new URL('../src/deployments/store.ts',import.meta.url).pathname,new URL('../src/cli/credentials.ts',import.meta.url).pathname,new URL('../src/repository/cli-environments.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',outdir:dir,outExtension:{'.js':'.mjs'}});
const {Environments}=await import(pathToFileURL(join(dir,'deployments/store.mjs'))),{cliScopeAllowed,requestedScopes}=await import(pathToFileURL(join(dir,'cli/credentials.mjs'))),{cliEnvironments}=await import(pathToFileURL(join(dir,'repository/cli-environments.mjs')));
const database=()=>{const db=new DatabaseSync(':memory:');return {db,sql:{exec(query,...args){const rows=db.prepare(query).all(...args);return {toArray:()=>rows};}}};};
test('environment delegation requires an explicit current-admin grant and active repository; older grants acquire no permission',()=>{
 for(const role of ['reader','writer','member'])assert.equal(cliScopeAllowed('environments:write',role,true),false);
 for(const role of ['owner','admin']){assert.equal(cliScopeAllowed('environments:write',role,true),true);assert.equal(cliScopeAllowed('environments:write',role,false),false);}
 assert.deepEqual(requestedScopes(['read','protections:write']),['read','protections:write']);assert.deepEqual(requestedScopes(['environments:write','read']),['read','environments:write']);
});
test('storage revision fences normal, legacy, ABA and delete/recreate writes without rewriting existing environment policy',()=>{
 const {db,sql}=database();try{sql.exec('CREATE TABLE deployment_environments(id TEXT PRIMARY KEY,name_key TEXT NOT NULL UNIQUE,data TEXT NOT NULL)').toArray();const legacy={id:'legacy-env',name:'Staging',revision:4,createdAt:1,updatedAt:1,waitTimerMinutes:7};sql.exec('INSERT INTO deployment_environments VALUES(?,?,?)',legacy.id,'staging',JSON.stringify(legacy)).toArray();const store=new Environments(sql);assert.equal(store.configuration().revision,1);assert.deepEqual(store.list(),[legacy]);assert.equal(new Environments(sql).configuration().revision,1);
 const next=store.set({name:'Staging',waitTimerMinutes:8},legacy.id);assert.equal(next.revision,5);assert.equal(store.configuration().revision,2);
 }finally{db.close();}
});
test('environment revision is monotonic across legacy update/ABA and deletion; failed and rolled-back writes preserve state',()=>{
 const {db,sql}=database();try{const store=new Environments(sql);assert.equal(store.configuration().revision,0);const first=store.set({name:'Staging',waitTimerMinutes:5});assert.equal(store.configuration().revision,1);assert.equal(store.set({name:'Staging',waitTimerMinutes:5},first.id).revision,1);assert.equal(store.configuration().revision,1);
 assert.throws(()=>store.set({name:'Staging',waitTimerMinutes:-1},first.id));assert.equal(store.configuration().revision,1);
 sql.exec('UPDATE deployment_environments SET data=? WHERE id=?',JSON.stringify({...first,waitTimerMinutes:9}),first.id).toArray();sql.exec('UPDATE deployment_environments SET data=? WHERE id=?',JSON.stringify(first),first.id).toArray();assert.equal(store.configuration().revision,3);
 db.exec('BEGIN');store.set({name:'Staging',waitTimerMinutes:10},first.id);assert.equal(store.configuration().revision,4);db.exec('ROLLBACK');assert.equal(store.configuration().revision,3);assert.equal(store.list()[0].waitTimerMinutes,5);
 store.remove(first.id);assert.equal(store.configuration().revision,4);sql.exec('INSERT INTO deployment_environments VALUES(?,?,?)',first.id,'staging',JSON.stringify(first)).toArray();assert.equal(new Environments(sql).configuration().revision,5);assert.equal(store.list()[0].revision,1);
 }finally{db.close();}
});
test('mixed receivers refuse CLI environment reads and writes without falling back to unconditional browser methods',async()=>{
 let writes=0;const seq={environmentConfiguration(){throw Error('The RPC receiver does not implement the method "environmentConfiguration".');},setEnvironment(){writes++;},removeEnvironment(){writes++;}};
 const env={SEQUENCER:{idFromName:x=>x,get:()=>seq}},user={id:'owner',cli:{credentialId:'fixture',scopes:['read','environments:write']}},access={proof:{role:'admin',agentId:null}};
 for(const method of ['GET','POST']){const response=await cliEnvironments(env,new Request('https://nanohub.invalid/api/cli/trunks/fixture/environments',{method,headers:{Origin:'https://nanohub.invalid','If-Match':'"environments-0"'},...(method==='POST'?{body:'{"name":"Staging"}'}:{})}),'fixture',undefined,undefined,user,access);assert.equal(response.status,503);assert.equal(response.headers.get('Retry-After'),'5');}assert.equal(writes,0);
 seq.environmentConfiguration=()=>({revision:0,environments:[],conditionalWrites:true,cliAudit:true});assert.equal((await cliEnvironments(env,new Request('https://nanohub.invalid/'),'fixture',undefined,undefined,user,access)).status,503);
});
