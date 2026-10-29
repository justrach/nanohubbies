import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
const output=await build({stdin:{contents:"export * from './src/collaborators/administration';export * from './src/collaborators/store';export * from './src/collaborators/cli-route';export * from './src/cli/credentials';export * from './src/repository/archive';",resolveDir:new URL('..',import.meta.url).pathname},bundle:true,platform:'node',format:'esm',write:false});
const {CollaboratorAdministration,Collaborators,ArchiveStore,cliCollaborators,cliScopeAllowed,requestedScopes}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
function fixture(){const db=new DatabaseSync(':memory:'),sql={exec(query,...args){const rows=db.prepare(query).all(...args).map(row=>({...row}));return{toArray:()=>rows};}};sql.exec('CREATE TABLE team_bindings(trunk TEXT PRIMARY KEY,body TEXT NOT NULL)');sql.exec('INSERT INTO team_bindings VALUES(?,?)','repo',JSON.stringify({kind:'owner',boundBy:'codegraff:owner'}));return {db,sql,store:new Collaborators(sql),admin:new CollaboratorAdministration(sql,'repo','credential-one')};}
const invite=(revision,userId='codegraff:recipient',role='writer')=>({op:'invite',id:randomUUID(),userId,role,tokenHash:'a'.repeat(64),revision,credentialId:'credential-one'});
test('CLI invitations recover exactly once without extending expiry, exposing hashes or resurrecting accepted/canceled/expired invitations',()=>{
 const f=fixture();try {
  const input=invite(f.admin.configuration('codegraff:owner').revision),first=f.admin.edit('codegraff:owner',input);assert.equal(first.created,true);assert.equal(first.invitation.id,input.id);
  const again=f.admin.edit('codegraff:owner',input);assert.equal(again.created,false);assert.equal(again.invitation.expires,first.invitation.expires);assert.equal(again.audit.length,1);assert.equal(again.audit[0].credentialId,'credential-one');assert.ok(!JSON.stringify(again).includes(input.tokenHash));
  assert.throws(()=>f.admin.edit('codegraff:owner',{...input,tokenHash:'b'.repeat(64)}),/Conflicting/);
  f.store.accept('repo',input.userId,input.tokenHash);assert.throws(()=>f.admin.edit('codegraff:owner',input),/no longer available/);
  f.store.change('repo','codegraff:owner',input.userId,null);assert.throws(()=>f.admin.edit('codegraff:owner',input),/no longer available/);
  const canceled=invite(f.admin.configuration('codegraff:owner').revision);f.admin.edit('codegraff:owner',canceled);f.store.cancel('repo','codegraff:owner',canceled.id);assert.throws(()=>f.admin.edit('codegraff:owner',canceled),/no longer available/);
  const expired=invite(f.admin.configuration('codegraff:owner').revision);f.admin.edit('codegraff:owner',expired);f.sql.exec('UPDATE repo_invitations SET expires=0 WHERE id=?',expired.id);assert.throws(()=>f.admin.edit('codegraff:owner',expired),/no longer available/);
 }finally{f.db.close();}
});
test('browser and raw storage edits advance revisions, invalidate stale CLI actions and preserve the other repository',()=>{
 const f=fixture();try {
  const before=f.admin.configuration('codegraff:owner').revision,invitation=f.store.invite('repo','codegraff:owner','codegraff:member','writer','h');assert.ok(f.admin.configuration('codegraff:owner').revision>before);
  assert.equal(f.admin.edit('codegraff:owner',invite(before)).conflict,true);
  f.store.accept('repo','codegraff:member','h');const observed=f.admin.configuration('codegraff:owner').revision;f.sql.exec("UPDATE collaborators SET role='reader' WHERE trunk='repo' AND user_id='codegraff:member'");
  assert.equal(f.admin.edit('codegraff:owner',{op:'change',userId:'codegraff:member',role:null,revision:observed,credentialId:'credential-one'}).conflict,true);assert.equal(f.store.role('repo','codegraff:member'),'reader');
  const current=f.admin.configuration('codegraff:owner').revision;f.sql.exec('INSERT INTO team_bindings VALUES(?,?)','other',JSON.stringify({kind:'owner',boundBy:'codegraff:other'}));assert.equal(f.admin.configuration('codegraff:owner').revision,current);assert.ok(invitation.id);
 }finally{f.db.close();}
});
test('current authority and archive checks hold at the final Hub transaction, including invitation recovery',()=>{
 const f=fixture();try {
  const admin=f.store.invite('repo','codegraff:owner','codegraff:admin','admin','admin-hash');f.store.accept('repo','codegraff:admin','admin-hash');
  assert.throws(()=>f.admin.edit('codegraff:admin',invite(f.admin.configuration('codegraff:admin').revision,'codegraff:new','admin')),/Only the owner/);
  const input=invite(f.admin.configuration('codegraff:admin').revision);f.admin.edit('codegraff:admin',input);
  f.store.change('repo','codegraff:owner','codegraff:admin','writer');assert.throws(()=>f.admin.edit('codegraff:admin',input),/Current repository/);assert.throws(()=>f.store.accept('repo',input.userId,input.tokenHash),/unavailable/);
  const ownerInput=invite(f.admin.configuration('codegraff:owner').revision);f.admin.edit('codegraff:owner',ownerInput);new ArchiveStore(f.sql,'repo').prepare(true,0,'codegraff:owner');assert.throws(()=>f.admin.edit('codegraff:owner',ownerInput),/archived/);assert.equal(f.admin.configuration('codegraff:owner').canManage,false);assert.ok(admin.id);
 }finally{f.db.close();}
});
test('schema initialization rolled back by a surrounding transaction does not leave an isolate-only ready flag',()=>{
 const db=new DatabaseSync(':memory:'),sql={exec(query,...args){const rows=db.prepare(query).all(...args);return {toArray:()=>rows};}};
 try {sql.exec('CREATE TABLE team_bindings(trunk TEXT PRIMARY KEY,body TEXT)');sql.exec('BEGIN');new Collaborators(sql);sql.exec('ROLLBACK');const store=new Collaborators(sql);sql.exec('INSERT INTO team_bindings VALUES(?,?)','repo',JSON.stringify({kind:'owner',boundBy:'codegraff:owner'}));store.invite('repo','codegraff:owner','codegraff:recipient','reader','hash');assert.equal(store.list('repo').invitations.length,1);
 }finally{db.close();}
});
test('mixed receivers fail closed without legacy invitation fallback, and the scope remains explicitly admin-only',async()=>{
 for(const role of ['reader','writer','member'])assert.equal(cliScopeAllowed('collaborators:write',role,true),false);
 for(const role of ['owner','admin']){assert.equal(cliScopeAllowed('collaborators:write',role,true),true);assert.equal(cliScopeAllowed('collaborators:write',role,false),false);assert.equal(cliScopeAllowed('collaborators:write',role,true,false),false);}
 assert.deepEqual(requestedScopes(['read','collaborators:write']),['read','collaborators:write']);
 let writes=0;const hub={collaboratorConfiguration(){throw Error('The RPC receiver does not implement the method "collaboratorConfiguration".');},inviteCollaborator(){writes++;}},env={HUB:{idFromName:x=>x,get:()=>hub}},user={id:'owner',cli:{credentialId:'fixture',scopes:['read','collaborators:write']}},access={binding:{kind:'owner'},proof:{role:'owner',agentId:null}};
 for(const method of ['GET','POST']){const response=await cliCollaborators(env,new Request('https://nanohub.invalid/api/cli/trunks/repo/collaborators',{method,...(method==='POST'?{body:'{}'}:{})}),'repo',undefined,user,access);assert.equal(response.status,503);assert.equal(response.headers.get('Retry-After'),'5');}assert.equal(writes,0);
});
