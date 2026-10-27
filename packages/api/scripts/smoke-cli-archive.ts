import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {teamFixture} from './team/fixture.ts';
const f=await teamFixture(),exec=promisify(execFile),trunk='cli-archive',base='/api/trunks/'+trunk,gateway='/api/cli/trunks/'+trunk;
const sourceBin=resolve(import.meta.dirname,'../../cli/bin/nh.mjs'),environment={...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0',NANOHUB_API_TOKEN:''};
const scopes=['read','repository:archive'],credentials:{id:string;cookie:any}[]=[],auth=(c:any)=>({Authorization:'Bearer '+c.token}),condition=(c:any,revision:number)=>({...auth(c),'If-Match':`"archive-${revision}"`});
let owner:any,gitToken:any,bin=sourceBin;
const cli=async(args:string[],credential:any)=>{try{return {code:0,...await exec('bun',[bin,'repo',...args,'--host',f.origin,'--trunk',trunk,'--json'],{cwd:f.dir,env:{...environment,NANOHUB_API_TOKEN:credential.token}})};}catch(error){const e=error as Error&{code:number;stdout:string;stderr:string};return {code:e.code,stdout:e.stdout,stderr:e.stderr};}};
try{
 if(process.argv.includes('--bundle')){bin=join(f.dir,"Archive CLI's standalone module.mjs");await exec('bun',['build',sourceBin,'--target=bun','--outfile',bin],{env:environment});}
 owner=await f.login('owner','101');const admin=await f.login('admin','202'),writer=await f.login('writer','303'),reader=await f.login('reader','404');
 await f.json('POST',base,{mode:'git'},owner);await f.json('POST','/api/trunks/archive-other',{mode:'git'},owner);
 for(const [id,cookie,role]of[['admin',admin,'admin'],['writer',writer,'writer'],['reader',reader,'reader']]as const){const invitation=await f.json('POST',base+'/collaborators',{userId:'codegraff:'+id,role},owner);await f.json('POST','/api/invitations/accept',{trunk,token:invitation.token},cookie);}
 const make=async(cookie:any,permissions=scopes)=>{const c=await f.json('POST',base+'/cli-credentials',{label:'Archive CLI fixture',scopes:permissions,days:1},cookie);credentials.push({id:c.id,cookie});return c;};
 for(const cookie of[writer,reader]){assert.ok(!(await f.json('GET',base+'/cli-credentials',undefined,cookie)).allowedScopes.includes('repository:archive'));assert.equal((await f.request('POST',base+'/cli-credentials',{label:'Denied lifecycle control',scopes,days:1},cookie)).status,403);}
 const grant=await make(admin),ordinary=await make(owner,['read','protections:write','contents:read','contents:write']),read=await make(reader,['read']);
 const body=(archived:boolean,revision:number)=>({archived,revision,confirmation:trunk});
 for(const c of[ordinary,read]){assert.equal((await f.request('POST',gateway+'/archive',body(true,0),condition(c,0))).status,403);assert.equal((await f.json('GET',gateway+'/archive',undefined,auth(c))).canManage,false);}
 assert.equal((await f.request('POST',base+'/archive',body(true,0),auth(grant))).status,401);
 assert.equal((await f.request('POST','/api/cli/trunks/archive-other/archive',body(true,0),condition(grant,0))).status,404);
 assert.equal((await f.request('POST',gateway+'/archive',body(true,0),auth(grant))).status,428);
 for(const header of['*','0','"archive-00"','"archive-9007199254740992"','"archive-1"'])assert.equal((await f.request('POST',gateway+'/archive',body(true,0),{...auth(grant),'If-Match':header})).status,400);
 for(const value of[{...body(true,0),confirmation:'wrong'},{...body(true,0),bypass:true},{...body(true,0),revision:-1}])assert.equal((await f.request('POST',gateway+'/archive',value,condition(grant,0))).status,400);
 // The final Hub writer independently rejects an old name and a non-admin,
 // even if a trusted HTTP preflight had observed the earlier configuration.
 let direct=await f.request('POST','/fixture/conditional-archive',{trunk,actor:'codegraff:admin',archived:true,revision:0,confirmation:'earlier-name'});assert.equal(direct.status,400);assert.match(await direct.text(),/name changed/);
 direct=await f.request('POST','/fixture/conditional-archive',{trunk,actor:'codegraff:writer',archived:true,revision:0,confirmation:trunk});assert.equal(direct.status,400);assert.match(await direct.text(),/current repository owner or admin/);
 // A still-valid grant never preserves a removed admin role.
 await f.json('PATCH',base+'/collaborators',{userId:'codegraff:admin',role:'writer'},owner);
 assert.equal((await f.request('POST',gateway+'/archive',body(true,0),condition(grant,0))).status,403);
 await f.json('PATCH',base+'/collaborators',{userId:'codegraff:admin',role:'admin'},owner);
 gitToken=await f.json('POST',base+'/git-tokens',{label:'Archive transport fixture'},owner);const source=join(f.dir,'source');await mkdir(source);
 const remote=f.origin+'/git/'+trunk+'.git',gitEnvironment={...environment,GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'http.extraHeader',GIT_CONFIG_VALUE_0:'Authorization: Basic '+btoa('git:'+gitToken.token)};
 const git=async(...args:string[])=>(await exec('git',['-C',source,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args],{env:gitEnvironment})).stdout.trim();
 await git('init','-b','main');await writeFile(join(source,'README.md'),'Retained repository\n');await git('add','.');await git('commit','-m','Seed');const main=await git('rev-parse','HEAD');await git('push',remote,'main');
 await f.json('PUT',base+'/protection',{branch:'main',pullRequest:false,approvals:0,checks:[],beforeOpen:[],preventForce:true,preventDelete:true,locked:true},owner);
 const before=await f.json('GET',base+'/protection',undefined,owner);let result=await cli(['archive-status'],grant);assert.equal(result.code,0,result.stdout);assert.equal(JSON.parse(result.stdout).revision,0);
 result=await cli(['archive','--revision','0','--confirm',trunk],grant);assert.equal(result.code,0,result.stdout);assert.equal(JSON.parse(result.stdout).archived,true);assert.equal(JSON.parse(result.stdout).revision,1);
 // Treat the successful answer as lost: an old repeat cannot toggle or revive it.
 result=await cli(['archive','--revision','0','--confirm',trunk],grant);assert.notEqual(result.code,0);assert.match(result.stdout,/state changed/);
 assert.equal((await f.request('POST',base+'/issues',{title:'Blocked',body:''},owner)).status,403);
 await assert.rejects(git('push',remote,'HEAD:refs/heads/while-archived'),/403|archived/);
 assert.equal((await f.request('PUT',gateway+'/protection',{...before.policies[0],locked:false},{...auth(grant),'If-Match':`"protection-${before.revision}"`})).status,403);
 const allowed=(await f.json('GET',base+'/cli-credentials',undefined,admin)).allowedScopes;assert.ok(allowed.includes('repository:archive'));for(const scope of['contents:write','protections:write','reviews:write'])assert.ok(!allowed.includes(scope));
 assert.equal((await f.request('POST',base+'/cli-credentials',{label:'Cannot smuggle content writes',scopes:[...scopes,'contents:read','contents:write'],days:1},admin)).status,403);
 const recovery=await make(admin);assert.ok(recovery.scopes.includes('repository:archive'));
 // Device consent may retain lifecycle control while dropping archived content permissions.
 const device=await f.json('POST','/api/cli/device',{trunk,label:'Archived device fixture',scopes:[...scopes,'contents:read','contents:write'],days:1});
 const preview=await f.json('GET','/api/cli/authorize?code='+device.user_code,undefined,admin);assert.ok(preview.archived);assert.ok(preview.allowedScopes.includes('repository:archive'));assert.ok(!preview.allowedScopes.includes('contents:write'));
 await f.json('POST','/api/cli/authorize',{userCode:device.user_code,decision:'approve',scopes,days:1,codeConfirmed:true},admin);
 const exchanged=await f.json('POST','/api/cli/token',{device_code:device.device_code});credentials.push({id:exchanged.credential_id,cookie:admin});assert.equal(exchanged.scope,'read repository:archive');
 const deviceGrant={id:exchanged.credential_id,token:exchanged.access_token};assert.equal((await f.json('GET',gateway+'/archive',undefined,auth(deviceGrant))).canManage,true);
 await f.restart();owner=await f.login('owner','101');assert.equal((await f.json('GET',gateway+'/archive',undefined,auth(recovery))).archived,true);
 const clone=join(f.dir,'clone');await git('clone',remote,clone);await exec('git',['-C',clone,'fsck','--strict']);
 result=await cli(['unarchive','--revision','0','--confirm',trunk],recovery);assert.notEqual(result.code,0);assert.match(result.stdout,/state changed/);
 result=await cli(['unarchive','--revision','1','--confirm',trunk],recovery);assert.equal(result.code,0,result.stdout);assert.equal(JSON.parse(result.stdout).readOnly,false);assert.equal(JSON.parse(result.stdout).revision,2);
 await git('push',remote,'HEAD:refs/heads/after-unarchive');await writeFile(join(source,'README.md'),'Next commit\n');await git('commit','-am','Next');await assert.rejects(git('push',remote,'main'),/locked/);
 assert.equal((await git('ls-remote',remote,'refs/heads/main')).split(/\s/)[0],main);assert.deepEqual((await f.json('GET',base+'/protection',undefined,owner)).policies,before.policies);
 const events=(await f.json('GET',base+'/repository/audit?kind=archive',undefined,owner)).events;assert.equal(events.length,2);assert.deepEqual(events.map((e:any)=>e.archive.archived),[false,true]);assert.equal(events[0].via.credentialId,recovery.id);assert.equal(events[1].via.credentialId,grant.id);assert.ok(events.every((e:any)=>e.actor==='codegraff:admin'));
 // Demotion between device approval and exchange invalidates the requested admin permission.
 const late=await f.json('POST','/api/cli/device',{trunk,label:'Demoted device fixture',scopes,days:1});await f.json('POST','/api/cli/authorize',{userCode:late.user_code,decision:'approve',scopes,days:1,codeConfirmed:true},admin);
 await f.json('PATCH',base+'/collaborators',{userId:'codegraff:admin',role:'writer'},owner);assert.equal((await f.request('POST','/api/cli/token',{device_code:late.device_code})).status,400);
 assert.equal((await f.request('POST',gateway+'/archive',body(true,2),condition(recovery,2))).status,403);
 await f.json('DELETE','/api/cli/credentials/'+grant.id,undefined,admin);assert.equal((await f.request('GET',gateway+'/archive',undefined,auth(grant))).status,401);
 console.log('PASS: '+(process.argv.includes('--bundle')?'standalone bundled':'source')+' CLI archive/unarchive, role and scope boundaries, revision/name checks, no retry after lost answer, archived recovery and reduced device consent, native Git fence/clone/fsck, restart, retained branch lock, CLI audit, demotion at exchange and revocation');
}finally{if(owner){if(gitToken)await f.request('DELETE','/api/tokens/'+gitToken.id,undefined,owner).catch(()=>{});for(const c of credentials)await f.request('DELETE','/api/cli/credentials/'+c.id,undefined,c.cookie).catch(()=>{});}await f.close();}

for(const failure of ['after','unarchive-after']){
 const fixture=await teamFixture({ARCHIVE_TEST_FAILURE:failure}),id='cli-archive-fault-'+failure,path='/api/trunks/'+id,cliPath='/api/cli/trunks/'+id;
 try{
  let cookie=await fixture.login('owner','101');await fixture.json('POST',path,{mode:'git'},cookie);
  const grant=await fixture.json('POST',path+'/cli-credentials',{label:'Interrupted CLI lifecycle fixture',scopes,days:1},cookie);
  if(failure.startsWith('unarchive'))await fixture.json('POST',path+'/archive',{archived:true,revision:0,confirmation:id},cookie);
  const archived=!failure.startsWith('unarchive'),revision=archived?0:1,input={archived,revision,confirmation:id};
  assert.equal((await fixture.request('POST',cliPath+'/archive',input,condition(grant,revision))).status,503);
  let state=await fixture.json('GET',cliPath+'/archive',undefined,auth(grant));assert.ok(state.transition);assert.equal(state.transition.archived,archived);
  await fixture.restart();cookie=await fixture.login('owner','101');
  state=await fixture.json('POST',cliPath+'/archive',input,condition(grant,revision));assert.equal(state.archived,archived);assert.equal(state.transition,null);assert.equal(state.revision,revision+1);
  const events=(await fixture.json('GET',path+'/repository/audit?kind=archive',undefined,cookie)).events;assert.equal(events.filter((event:any)=>event.via?.credentialId===grant.id).length,1);
  assert.equal((await fixture.request('POST',cliPath+'/archive',input,condition(grant,revision))).status,412);
  await fixture.json('DELETE','/api/cli/credentials/'+grant.id,undefined,cookie);assert.equal((await fixture.request('GET',cliPath+'/archive',undefined,auth(grant))).status,401);
  console.log('PASS: conditional CLI '+failure+' interruption resumes across restart with one attributed audit and then rejects stale repeats');
 }finally{await fixture.close();}
}
