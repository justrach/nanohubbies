import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {after} from 'node:test';
const directory=await mkdtemp(join(tmpdir(),'nh-protections-unit-'));after(()=>rm(directory,{recursive:true,force:true}));
await build({entryPoints:[new URL('../src/cli/credentials.ts',import.meta.url).pathname,new URL('../src/repository/policy.ts',import.meta.url).pathname,new URL('../src/repository/activity.ts',import.meta.url).pathname,new URL('../src/repository/routes.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',outdir:directory,outExtension:{'.js':'.mjs'}});
const {cliScopeAllowed,requestedScopes}=await import(pathToFileURL(join(directory,'cli/credentials.mjs')));
const {Policies}=await import(pathToFileURL(join(directory,'repository/policy.mjs')));
const {repositoryActivity}=await import(pathToFileURL(join(directory,'repository/activity.mjs')));
const {repositoryRoute}=await import(pathToFileURL(join(directory,'repository/routes.mjs')));
const rule={branch:'main',pullRequest:false,approvals:0,checks:[],beforeOpen:[],preventForce:true,preventDelete:true};
test('protection delegation requires current admin role and writable repository; old grants remain unchanged',()=>{
 for(const role of ['reader','writer','member'])assert.equal(cliScopeAllowed('protections:write',role,true),false);
 for(const role of ['owner','admin']){assert.equal(cliScopeAllowed('protections:write',role,true),true);assert.equal(cliScopeAllowed('protections:write',role,false),false);}
 assert.equal(cliScopeAllowed('read','reader',false),true);
 assert.deepEqual(requestedScopes(['read','reviews:write']),['read','reviews:write']);
 assert.deepEqual(requestedScopes(['protections:write','read']),['read','protections:write']);
 assert.throws(()=>requestedScopes(['protections:write']),/read access/);
});
test('existing stored protections acquire a revision without rewriting policy; only successful changes increment it',()=>{
 const db=new DatabaseSync(':memory:'),sql={exec(q,...args){const rows=db.prepare(q).all(...args);return {toArray:()=>rows};}};
 try {
  sql.exec('CREATE TABLE branch_policies (branch TEXT PRIMARY KEY,data TEXT NOT NULL)').toArray();sql.exec('INSERT INTO branch_policies VALUES (?,?)',rule.branch,JSON.stringify(rule)).toArray();
  const p=new Policies(sql);assert.equal(p.revision(),0);assert.deepEqual(p.list(),[rule]);
  p.set({...rule,locked:true});assert.equal(p.revision(),1);assert.throws(()=>p.set({...rule,approvals:-1}),/Invalid branch policy/);assert.equal(p.revision(),1);assert.equal(p.get('main').locked,true);
  p.remove('main');assert.equal(p.revision(),2);assert.deepEqual(p.list(),[]);assert.equal(new Policies(sql).revision(),2);
 }finally{db.close();}
});
test('admin activity projects only known CLI provenance and never arbitrary internal data',()=>{
 const db=new DatabaseSync(':memory:'),sql={exec(q,...args){const rows=db.prepare(q).all(...args);return {toArray:()=>rows};}};
 try {
  sql.exec('CREATE TABLE repository_audit (id INTEGER PRIMARY KEY,data TEXT NOT NULL)');
  sql.exec('INSERT INTO repository_audit VALUES (?,?)',1,JSON.stringify({actor:'owner',at:1,policy:rule,via:{kind:'cli',credentialId:'fixture-id',token:'should-not-project'},privateValue:'hidden'}));
  const event=repositoryActivity(sql).events[0];assert.deepEqual(event.via,{kind:'cli',credentialId:'fixture-id'});assert.ok(!JSON.stringify(event).includes('should-not-project'));assert.equal(event.privateValue,undefined);
 }finally{db.close();}
});
test('mixed-version RPC preserves existing reads and refuses conditional edits without a legacy downgrade',async()=>{
 let unconditionalWrites=0;
 const missing=name=>{throw Error(`The RPC receiver does not implement the method "${name}".`);};
 const seq={protectionConfiguration:()=>missing('protectionConfiguration'),configureProtection:()=>missing('configureProtection'),policies:()=>[rule],setPolicy:()=>{unconditionalWrites++;},removePolicy:()=>{unconditionalWrites++;}};
 const env={SEQUENCER:{idFromName:x=>x,get:()=>seq},HUB:{idFromName:x=>x,get:()=>({find:()=>({owner:'owner'}),repositoryArchive:()=>({archived:false})})}};
 const access={proof:{role:'admin',agentId:null}},browser={id:'owner'},delegate={...browser,cli:{credentialId:'fixture',scopes:['read','protections:write']}};
 const request=method=>new Request('https://nanohub.invalid/api/trunks/fixture/protection',{method,headers:{Origin:'https://nanohub.invalid','If-Match':'"protection-0"','Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(rule)})});
 let response=await repositoryRoute(env,request('GET'),'fixture','protection',undefined,browser,access);assert.equal(response.status,200);assert.deepEqual(await response.json(),{policies:[rule],revision:null,updating:true});assert.equal(response.headers.get('ETag'),null);
 response=await repositoryRoute(env,request('GET'),'fixture','protection',undefined,delegate,access);assert.equal(response.status,503);assert.equal(response.headers.get('Retry-After'),'5');
 response=await repositoryRoute(env,request('PUT'),'fixture','protection',undefined,delegate,access);assert.equal(response.status,503);assert.equal(unconditionalWrites,0);
 seq.protectionConfiguration=()=>({policies:[rule],revision:0});response=await repositoryRoute(env,request('GET'),'fixture','protection',undefined,delegate,access);assert.equal(response.status,503,'A numeric revision from a pre-storage-fence receiver is not readiness');
 seq.configureProtection=()=>{unconditionalWrites++;return {policies:[rule],revision:1};};response=await repositoryRoute(env,request('PUT'),'fixture','protection',undefined,delegate,access);assert.equal(response.status,503);assert.equal(unconditionalWrites,0,'An older edit method is never called before storage readiness');
 seq.protectionConfiguration=()=>{throw Error('Storage failure');};await assert.rejects(repositoryRoute(env,request('GET'),'fixture','protection',undefined,browser,access),/Storage failure/);
});
test('persistent revision triggers fence legacy SQL writes, ABA edits and older application counters',()=>{
 const db=new DatabaseSync(':memory:'),sql={exec(q,...args){const rows=db.prepare(q).all(...args);return {toArray:()=>rows};}};
 try {
  db.exec('CREATE TABLE branch_policies (branch TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE branch_policy_revision (id INTEGER PRIMARY KEY,revision INTEGER NOT NULL); INSERT INTO branch_policy_revision VALUES (1,12)');
  const p=new Policies(sql);assert.equal(p.revision(),13,'Installing the storage fence invalidates earlier exports');
  sql.exec('INSERT INTO branch_policies VALUES (?,?)','main',JSON.stringify(rule));assert.equal(p.revision(),14);
  const exported=p.revision();
  sql.exec('UPDATE branch_policies SET data=? WHERE branch=?',JSON.stringify({...rule,locked:true}),'main');assert.equal(p.revision(),15);
  sql.exec('UPDATE branch_policies SET data=? WHERE branch=?',JSON.stringify(rule),'main');assert.equal(p.revision(),16);assert.deepEqual(p.list(),[rule]);assert.notEqual(p.revision(),exported,'Returning to identical content does not revive an old export');
  sql.exec('UPDATE branch_policy_revision SET revision=revision+1 WHERE id=1');assert.equal(p.revision(),17,'An older application increment is harmless');
  sql.exec('INSERT OR REPLACE INTO branch_policies VALUES (?,?)','main',JSON.stringify({...rule,locked:true}));assert.ok(p.revision()>17);
  const beforeDelete=p.revision();sql.exec('DELETE FROM branch_policies WHERE branch=?','main');assert.equal(p.revision(),beforeDelete+1);
  assert.equal(new Policies(sql).revision(),p.revision(),'Repeated initialization never invalidates another export');
 }finally{db.close();}
});
test('policy data and revision roll back together, including interrupted migration and partial trigger recovery',()=>{
 const db=new DatabaseSync(':memory:'),sql={exec(q,...args){const rows=db.prepare(q).all(...args);return {toArray:()=>rows};}};
 try {
  db.exec('CREATE TABLE branch_policies (branch TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE branch_policy_revision (id INTEGER PRIMARY KEY,revision INTEGER NOT NULL); INSERT INTO branch_policy_revision VALUES (1,7); BEGIN');
  let p=new Policies(sql);assert.equal(p.revision(),8);db.exec('ROLLBACK');
  assert.equal(sql.exec('SELECT revision FROM branch_policy_revision').toArray()[0].revision,7);assert.equal(sql.exec("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger'").toArray()[0].n,0);
  db.exec('BEGIN');p=new Policies(sql);db.exec('COMMIT');assert.equal(p.revision(),8);
  db.exec('BEGIN');sql.exec('INSERT INTO branch_policies VALUES (?,?)','main',JSON.stringify(rule));assert.equal(p.revision(),9);db.exec('ROLLBACK');assert.equal(p.revision(),8);assert.deepEqual(p.list(),[]);
  db.exec('DROP TRIGGER branch_policy_revision_delete');p=new Policies(sql);assert.equal(p.revision(),9,'Repairing a partial fence invalidates existing exports');
  sql.exec('INSERT INTO branch_policies VALUES (?,?)','main',JSON.stringify(rule));sql.exec('DELETE FROM branch_policies');assert.equal(p.revision(),11);
 }finally{db.close();}
});
