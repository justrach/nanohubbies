import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {teamFixture,ROOM} from './team/fixture.ts';
const f=await teamFixture(),exec=promisify(execFile),trunk='cli-default',base='/api/trunks/'+trunk,gateway='/api/cli/trunks/'+trunk;
const environment={...process.env,NANOHUB_API_TOKEN:'',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'},scopes=['read','repository:default'],credentials:{id:string;cookie:any}[]=[],auth=(c:any)=>({Authorization:'Bearer '+c.token});
let owner:any,key:any,bin=resolve(import.meta.dirname,'../../cli/bin/nh.mjs');
const cli=async(args:string[],credential:any,repo?:string)=>{try{return {code:0,...await exec('bun',[bin,'repo',...args,'--host',f.origin,...(repo?['-R',repo]:['--trunk',trunk]),'--json'],{cwd:f.dir,env:{...environment,NANOHUB_API_TOKEN:credential.token}})};}catch(error){const e=error as Error&{code:number;stdout:string;stderr:string};return {code:e.code,stdout:e.stdout,stderr:e.stderr};}};
try{
 if(process.argv.includes('--bundle')){bin=join(f.dir,"Default CLI's standalone module.mjs");await exec('bun',['build',resolve(import.meta.dirname,'../../cli/bin/nh.mjs'),'--target=bun','--outfile',bin],{env:environment});}
 owner=await f.login('owner','101');const admin=await f.login('admin','202'),writer=await f.login('writer','303'),reader=await f.login('reader','404');
 await f.json('POST',base,{mode:'git'},owner);await f.json('POST','/api/trunks/default-other',{mode:'git'},owner);
 for(const [id,cookie,role]of [['admin',admin,'admin'],['writer',writer,'writer'],['reader',reader,'reader']]as const){const invite=await f.json('POST',base+'/collaborators',{userId:'codegraff:'+id,role},owner);await f.json('POST','/api/invitations/accept',{trunk,token:invite.token},cookie);}
 const make=async(cookie:any,permissions=scopes)=>{const value=await f.json('POST',base+'/cli-credentials',{label:'Default branch CLI fixture',scopes:permissions,days:1},cookie);credentials.push({id:value.id,cookie});return value;};
 for(const cookie of[writer,reader]){assert.ok(!(await f.json('GET',base+'/cli-credentials',undefined,cookie)).allowedScopes.includes('repository:default'));assert.equal((await f.request('POST',base+'/cli-credentials',{label:'Denied settings grant',scopes,days:1},cookie)).status,403);}
 const grant=await make(admin),ordinary=await make(owner,['read','rulesets:write','protections:write','repository:archive']),read=await make(reader,['read']);
 key=await f.json('POST',base+'/git-tokens',{label:'Default CLI transport fixture'},owner);const source=join(f.dir,'source');await mkdir(source);
 const remote=f.origin+'/git/'+trunk+'.git',gitEnv={...environment,GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'http.extraHeader',GIT_CONFIG_VALUE_0:'Authorization: Basic '+btoa('git:'+key.token)};
 const git=async(...args:string[])=>(await exec('git',['-C',source,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args],{env:gitEnv})).stdout.trim();
 await git('init','-b','main');await writeFile(join(source,'README.md'),'Initial default\n');await git('add','.');await git('commit','-m','Seed');const main=await git('rev-parse','HEAD');await git('push',remote,'main');
 const selected="trunk/日本語/'-$USER;$(literal)";await git('switch','-c',selected);await writeFile(join(source,'README.md'),'Selected default\n');await git('commit','-am','Selected');const head=await git('rev-parse','HEAD');await git('push',remote,`HEAD:refs/heads/${selected}`);
 const before=(await f.json('GET',base+'/repository',undefined,owner)).refs,body=(branch:string,commit:string,revision:number)=>({branch,commit,revision}),write=(c:any,input:any)=>f.request('PUT',gateway+'/default-branch',input,{...auth(c),'If-Match':`"default-${input.revision}"`});
 let status=await f.json('GET',gateway+'/default-branch',undefined,auth(grant));assert.equal(status.defaultBranch,'main');assert.equal(status.revision,0);assert.ok(status.canManage);assert.equal(status.revisionTracking,'storage');
 for(const c of [ordinary,read]){assert.equal((await write(c,body(selected,head,0))).status,403);assert.equal((await f.json('GET',gateway+'/default-branch',undefined,auth(c))).canManage,false);}
 assert.equal((await f.request('GET','/api/cli/trunks/default-other/default-branch',undefined,auth(grant))).status,404);
 assert.equal((await f.request('PUT',base+'/default-branch',body(selected,head,0),auth(grant))).status,401);
 assert.equal((await f.request('PUT',gateway+'/default-branch',body(selected,head,0),auth(grant))).status,428);
 assert.equal((await f.request('PUT',gateway+'/default-branch',body(selected,head,0),{...auth(grant),'If-Match':'"default-1"'})).status,400);
 assert.equal((await write(grant,{...body(selected,head,0),credentialId:'spoof'})).status,400);
 assert.equal((await write(grant,body(selected,main,0))).status,400);
 // Both classic locks and moving default rules remain in force after selection.
 await f.json('PUT',base+'/protection',{branch:'main',pullRequest:false,approvals:0,checks:[],beforeOpen:[],preventForce:true,preventDelete:true,locked:true},owner);
 const rule=await f.json('POST',base+'/rulesets',{name:'Follow default',target:'branch',enforcement:'active',conditions:{ref_name:{include:['~DEFAULT_BRANCH'],exclude:[]}},rules:[{type:'update'}]},owner);
 let result=await cli(['default-branch'],read);assert.equal(result.code,0,result.stdout);assert.equal(JSON.parse(result.stdout).defaultBranch,'main');
 result=await cli(['edit','--default-branch',selected,'--revision','0'],grant);assert.equal(result.code,0,result.stdout);assert.equal(JSON.parse(result.stdout).defaultBranch,selected);assert.equal(JSON.parse(result.stdout).revision,1);
 assert.deepEqual((await f.json('GET',base+'/repository',undefined,owner)).refs,before);assert.equal(await(await fetch(remote+'/HEAD',{headers:{Authorization:'Basic '+btoa('git:'+key.token)}})).text(),`ref: refs/heads/${selected}\n`);
 result=await cli(['edit','--default-branch','main','--revision','0'],grant);assert.notEqual(result.code,0);assert.match(result.stdout,/settings changed/);
 assert.equal((await write(grant,body('main',main,0))).status,412);
 const events=(await f.json('GET',base+'/repository/audit?kind=settings',undefined,owner)).events;assert.equal(events.length,1);assert.equal(events[0].via.credentialId,grant.id);assert.equal(events[0].actor,'codegraff:admin');
 await writeFile(join(source,'next.txt'),'Protected next\n');await git('add','.');await git('commit','-m','Protected');await assert.rejects(git('push',remote,`HEAD:refs/heads/${selected}`),/updates are restricted/);await assert.rejects(git('push','--force',remote,'HEAD:refs/heads/main'),/locked/);
 // The final RPC independently rechecks current membership; a valid grant is
 // not an administrator identity after demotion.
 await f.json('PATCH',base+'/collaborators',{userId:'codegraff:admin',role:'writer'},owner);assert.equal((await write(grant,body('main',main,1))).status,403);
 const direct=await f.request('POST','/fixture/conditional-default',{trunk,...body('main',main,1),actor:'codegraff:admin'});assert.equal(direct.status,400);assert.match(await direct.text(),/Current repository admin/);
 await f.json('PATCH',base+'/collaborators',{userId:'codegraff:admin',role:'admin'},owner);
 // Legacy SQL and old manual counters cannot make an earlier export current.
 await f.json('POST','/fixture/legacy-default',{trunk,branch:'main'});await f.json('POST','/fixture/legacy-default',{trunk,branch:selected,manualCounter:true});
 status=await f.json('GET',gateway+'/default-branch',undefined,auth(grant));assert.equal(status.revision,4);assert.equal((await write(grant,body('main',main,1))).status,412);
 const rolled=await f.request('POST','/fixture/legacy-default',{trunk,branch:'main',rollback:true});assert.equal(rolled.status,400);assert.equal((await f.json('GET',gateway+'/default-branch',undefined,auth(grant))).revision,4);
 await f.json('POST',base+'/archive',{archived:true,revision:0,confirmation:trunk},owner);assert.ok(!(await f.json('GET',base+'/cli-credentials',undefined,admin)).allowedScopes.includes('repository:default'));assert.equal((await write(grant,body('main',main,4))).status,403);assert.equal((await f.json('GET',gateway+'/default-branch',undefined,auth(grant))).canManage,false);
 await f.json('POST',base+'/archive',{archived:false,revision:1,confirmation:trunk},owner);
 // Namespace renames retain the immutable credential boundary.
 await f.json('POST','/api/namespaces',{name:'default-cli-owner'},owner);await f.json('POST','/api/repository-addresses/'+trunk,{namespace:'default-cli-owner',name:'before'},owner);await f.json('POST','/api/repos/default-cli-owner/before/address',{name:'after'},owner);
 result=await cli(['edit','--default-branch','main','--revision','4'],grant,'default-cli-owner/before');assert.equal(result.code,0,result.stdout);assert.equal(JSON.parse(result.stdout).revision,5);
 await f.restart();owner=await f.login('owner','101');assert.equal((await f.json('GET',gateway+'/default-branch',undefined,auth(read))).defaultBranch,'main');
 const clone=join(f.dir,'clone');await git('clone',remote,clone);assert.equal((await exec('git',['-C',clone,'symbolic-ref','HEAD'])).stdout.trim(),'refs/heads/main');await exec('git',['-C',clone,'fsck','--strict']);
 assert.equal((await f.json('GET',base+'/protection',undefined,owner)).policies[0].locked,true);assert.equal((await f.json('GET',base+'/rulesets/'+rule.id,undefined,owner)).rules[0].type,'update');
 await f.json('POST',base+'/branches',{name:'release',from:'main'},owner);
 const raced=await Promise.all([write(grant,body(selected,head,5)),write(grant,body('release',main,5))]);assert.deepEqual(raced.map(r=>r.status).sort(),[200,412]);
 status=await f.json('GET',gateway+'/default-branch',undefined,auth(grant));assert.equal(status.revision,6);assert.equal((await write(grant,body('main',main,6))).status,200);
 await git('push',remote,'HEAD:refs/heads/release');assert.equal((await write(grant,body('release',main,7))).status,400);assert.equal((await f.json('GET',gateway+'/default-branch',undefined,auth(grant))).defaultBranch,'main');
 // Consent and token exchange both retain the current-admin requirement.
 const device=await f.json('POST','/api/cli/device',{trunk,label:'Default device fixture',scopes,days:1});assert.ok((await f.json('GET','/api/cli/authorize?code='+device.user_code,undefined,admin)).allowedScopes.includes('repository:default'));
 await f.json('POST','/api/cli/authorize',{userCode:device.user_code,decision:'approve',scopes,days:1,codeConfirmed:true},admin);await f.json('PATCH',base+'/collaborators',{userId:'codegraff:admin',role:'writer'},owner);assert.equal((await f.request('POST','/api/cli/token',{device_code:device.device_code})).status,400);
 // External identity must also be current at the final configuration writer.
 const team='default-cli-team',path='/api/trunks/'+team;await f.json('POST',path,{mode:'git'},owner);await f.json('POST',path+'/team',{roomId:ROOM},owner);
 f.provider.down=true;const calls=f.provider.calls;assert.equal((await f.request('POST','/fixture/conditional-default',{trunk:team,...body('main',main,0),actor:'codegraff:owner'})).status,400);assert.ok(f.provider.calls>calls);f.provider.down=false;
 await f.json('DELETE','/api/cli/credentials/'+grant.id,undefined,admin);assert.equal((await f.request('GET',gateway+'/default-branch',undefined,auth(grant))).status,401);
 console.log('PASS: '+(process.argv.includes('--bundle')?'bundled':'source')+' native default-branch CLI, literal names, exact heads/settings revisions, separate current-admin scope, final membership check, storage/legacy/ABA/rollback fences, unchanged locks/refs, moving default rules, namespace aliases, archive, device demotion, audit/restart and clone/fsck');
}finally{f.provider.down=false;if(owner){if(key)await f.request('DELETE','/api/tokens/'+key.id,undefined,owner).catch(()=>{});for(const c of credentials)await f.request('DELETE','/api/cli/credentials/'+c.id,undefined,c.cookie).catch(()=>{});}await f.close();}
