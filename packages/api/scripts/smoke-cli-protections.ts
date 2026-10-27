import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {teamFixture} from './team/fixture.ts';

const f=await teamFixture(),exec=promisify(execFile),trunk='cli-protections',base=`/api/trunks/${trunk}`,gateway=`/api/cli/trunks/${trunk}`,bin=resolve(import.meta.dirname,'../../cli/bin/nh.mjs');
const environment={...process.env,HOME:join(f.dir,'home'),GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0',NANOHUB_API_TOKEN:''};
const scopes=['read','protections:write'],credentials:{id:string;cookie:any}[]=[];
const policy=(branch:string,locked=true)=>({branch,pullRequest:false,approvals:0,checks:[],beforeOpen:[],preventForce:true,preventDelete:true,locked});
const auth=(c:any)=>({Authorization:`Bearer ${c.token}`});
const condition=(c:any,revision:number)=>({...auth(c),'If-Match':`"protection-${revision}"`});
const cli=async(args:string[],credential:any)=>{
 try {const r=await exec('bun',[bin,...args,'--host',f.origin,'--trunk',trunk,'--credential-helper','cache','--json'],{cwd:f.dir,env:{...environment,NANOHUB_API_TOKEN:credential.token}});return {code:0,...r};}
 catch(error){const e=error as Error&{code:number;stdout:string;stderr:string};return {code:e.code,stdout:e.stdout,stderr:e.stderr};}
};
let owner:any,gitToken:any;
try {
 await mkdir(environment.HOME);
 owner=await f.login('owner','101');const admin=await f.login('admin','202'),writer=await f.login('writer','303'),reader=await f.login('reader','404');
 await f.json('POST',base,{mode:'git'},owner);await f.json('POST','/api/trunks/cli-protection-other',{mode:'git'},owner);
 for(const [id,cookie,role] of [['admin',admin,'admin'],['writer',writer,'writer'],['reader',reader,'reader']] as const){const invitation=await f.json('POST',base+'/collaborators',{userId:'codegraff:'+id,role},owner);await f.json('POST','/api/invitations/accept',{trunk,token:invitation.token},cookie);}
 const make=async(cookie:any,permissions=scopes)=>{const c=await f.json('POST',base+'/cli-credentials',{label:'Protection CLI fixture',scopes:permissions,days:1},cookie);credentials.push({id:c.id,cookie});return c;};
 for(const cookie of [writer,reader]) {
  assert.ok(!(await f.json('GET',base+'/cli-credentials',undefined,cookie)).allowedScopes.includes('protections:write'));
  assert.equal((await f.request('POST',base+'/cli-credentials',{label:'Cannot delegate admin',scopes,days:1},cookie)).status,403);
 }
 assert.ok((await f.json('GET',base+'/cli-credentials',undefined,admin)).allowedScopes.includes('protections:write'));
 const grant=await make(admin),ordinary=await make(owner,['read','contents:read','contents:write','pulls:write','reviews:write','pulls:merge']),readonly=await make(reader,['read']);
 const snapshot=()=>f.json('GET',gateway+'/protection',undefined,auth(grant));
 assert.equal((await snapshot()).revision,0);
 assert.equal((await snapshot()).revisionTracking,'storage');
 for(const c of [ordinary,readonly])assert.equal((await f.request('PUT',gateway+'/protection',policy('main'),condition(c,0))).status,403);
 assert.equal((await f.request('PUT',base+'/protection',policy('main'),auth(grant))).status,401,'A CLI bearer is not a browser session');
 assert.equal((await f.request('PUT',gateway+'/protection',policy('main'),auth(grant))).status,428);
 for(const value of ['*','0','"protection-00"','"protection--1"','"protection-9007199254740992"'])assert.equal((await f.request('PUT',gateway+'/protection',policy('main'),{...auth(grant),'If-Match':value})).status,400);
 assert.equal((await f.request('PUT',gateway+'/protection',{...policy('main'),bypass:true},condition(grant,0))).status,400);
 assert.equal((await snapshot()).revision,0);
 const file=join(f.dir,'protection export.json');
 await writeFile(file,Buffer.alloc(131073,32));
 let invalid=await cli(['rules','set','--file',file],grant);assert.notEqual(invalid.code,0);assert.match(invalid.stdout,/128 KiB/);
 await writeFile(file,Buffer.concat([Buffer.from('{"revision":0,"policy":{"branch":"'),Buffer.from([0xff]),Buffer.from('"}}')]));
 invalid=await cli(['rules','set','--file',file],grant);assert.notEqual(invalid.code,0);assert.match(invalid.stdout,/Cannot read protection export/);assert.equal((await snapshot()).revision,0);
 await writeFile(file,JSON.stringify({revision:0,policy:policy('ci/**')}));
 let result=await cli(['rules','set','--file',file],grant);assert.equal(result.code,0,result.stdout+result.stderr);assert.equal(JSON.parse(result.stdout).revision,1);
 result=await cli(['rules','list'],readonly);assert.equal(result.code,0,result.stdout);assert.equal(JSON.parse(result.stdout).policies[0].branch,'ci/**');
 result=await cli(['rules','get','ci/**'],grant);assert.equal(result.code,0,result.stdout);const exported=JSON.parse(result.stdout);assert.equal(exported.revision,1);assert.equal(exported.policy.locked,true);
 // A browser edit increments the same revision, including unrelated patterns.
 await f.json('PUT',base+'/protection',policy('browser-only',false),owner);
 await writeFile(file,JSON.stringify({...exported,policy:{...exported.policy,locked:false}}));
 result=await cli(['rules','set','--file',file],grant);assert.notEqual(result.code,0);assert.match(result.stdout,/changed/);assert.equal((await snapshot()).policies.find((p:any)=>p.branch==='ci/**').locked,true);
 assert.equal((await f.request('DELETE',gateway+'/protection',{branch:'ci/**',revision:2},condition(grant,2))).status,400);
 // Same revision, different writes: only one is allowed to commit.
 const attempts=await Promise.all(['race/a','race/b'].map(branch=>f.request('PUT',gateway+'/protection',policy(branch),condition(grant,2))));
 assert.deepEqual(attempts.map(r=>r.status).sort(),[200,412]);assert.equal((await snapshot()).revision,3);
 const events=await f.json('GET',base+'/repository/audit?kind=protections',undefined,owner);
 assert.equal(events.events.filter((e:any)=>e.via?.credentialId===grant.id).length,2);assert.equal(events.events[0].actor,'codegraff:admin');assert.equal(events.events[0].via.kind,'cli');
 // The lock created by the actual CLI must reject ordinary native Git writes.
 gitToken=await f.json('POST',base+'/git-tokens',{label:'Protection Git fixture'},owner);
 const source=join(f.dir,'source');await mkdir(source);const remote=f.origin+'/git/'+trunk+'.git';
 const git=async(...args:string[])=>(await exec('git',['-C',source,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args],{env:environment})).stdout.trim();
 const push=(...refs:string[])=>exec('git',['-C',source,'push',remote,...refs],{env:{...environment,GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:`http.${remote}.extraHeader`,GIT_CONFIG_VALUE_0:'Authorization: Basic '+btoa('git:'+gitToken.token)}});
 await git('init','-b','main');await writeFile(join(source,'README.md'),'Protection fixture\n');await git('add','.');await git('commit','-m','Seed');const main=await git('rev-parse','HEAD');await push('main');
 const branch='ci/テスト-🔒';await assert.rejects(push('HEAD:refs/heads/'+branch),/locked/);
 assert.equal((await f.request('POST',base+'/branches',{name:branch,from:'main'},owner)).status,400);
 // An exact unlocked rule cannot waive an overlapping wildcard lock.
 await writeFile(file,JSON.stringify({revision:3,policy:policy(branch,false)}));result=await cli(['rules','set','--file',file],grant);assert.equal(result.code,0,result.stdout);
 await assert.rejects(push('HEAD:refs/heads/'+branch),/locked/);
 result=await cli(['rules','delete','ci/**','--revision','4','--confirm','wrong'],grant);assert.notEqual(result.code,0);assert.equal((await snapshot()).revision,4);
 result=await cli(['rules','delete','ci/**','--revision','4','--confirm','ci/**'],grant);assert.equal(result.code,0,result.stdout);assert.equal(JSON.parse(result.stdout).revision,5);
 result=await cli(['rules','delete','ci/**','--revision','4','--confirm','ci/**'],grant);assert.notEqual(result.code,0);assert.match(result.stdout,/changed/);
 await push('HEAD:refs/heads/'+branch);
 const refs=(await f.json('GET',base+'/repository',undefined,owner)).refs;assert.equal(refs.find((r:any)=>r.name==='refs/heads/main').commit,main);assert.equal(refs.find((r:any)=>r.name==='refs/heads/'+branch).commit,main);
 // Existing scope is ineffective immediately after demotion; it cannot widen itself.
 await f.json('PATCH',base+'/collaborators',{userId:'codegraff:admin',role:'writer'},owner);
 assert.equal((await f.request('PUT',gateway+'/protection',policy('denied'),condition(grant,5))).status,403);
 assert.equal((await f.request('GET',gateway+'/protection',undefined,auth(grant))).status,200);
 assert.equal((await f.request('POST',gateway+'/ci/runners',{},auth(grant))).status,403);
 for(const path of ['/secrets','/collaborators','/cli-credentials'])assert.equal((await f.request('POST',gateway+path,{},auth(grant))).status,404);
 await f.json('PATCH',base+'/collaborators',{userId:'codegraff:admin',role:'admin'},owner);
 await f.json('POST',base+'/archive',{archived:true,revision:0,confirmation:trunk},owner);
 assert.equal((await f.request('PUT',gateway+'/protection',policy('archived'),condition(grant,5))).status,403);
 assert.equal((await snapshot()).revision,5);await f.json('POST',base+'/archive',{archived:false,revision:1,confirmation:trunk},owner);
 await f.json('POST','/api/namespaces',{name:'cli-protection-owner'},owner);await f.json('POST',`/api/repository-addresses/${trunk}`,{namespace:'cli-protection-owner',name:'canary'},owner);
 assert.equal((await f.json('GET','/api/cli/repos/cli-protection-owner/canary/protection',undefined,auth(grant))).revision,5);
 assert.equal((await f.request('GET','/api/cli/trunks/cli-protection-other/protection',undefined,auth(grant))).status,404);
 await f.restart();assert.equal((await snapshot()).revision,5);assert.ok((await snapshot()).policies.some((p:any)=>p.branch===branch));
 const beforeLegacy=await snapshot(),legacyBranch='legacy/sql-lock',legacy=async(input:Record<string,unknown>)=>f.json('POST','/fixture/legacy-protection',{trunk,branch:legacyBranch,...input});
 await legacy({policy:policy(legacyBranch)});let current=await snapshot();assert.equal(current.revision,beforeLegacy.revision+1);
 assert.equal((await f.request('PUT',gateway+'/protection',policy('stale/legacy'),condition(grant,beforeLegacy.revision))).status,412);
 const exportedLegacy=current;
 await legacy({policy:policy(legacyBranch,false)});await legacy({policy:policy(legacyBranch)});current=await snapshot();assert.deepEqual(current.policies,exportedLegacy.policies);assert.ok(current.revision>exportedLegacy.revision);
 assert.equal((await f.request('DELETE',gateway+'/protection',{branch:legacyBranch},condition(grant,exportedLegacy.revision))).status,412,'Identical restored policy content cannot revive an old revision');
 const beforeDouble=current.revision;await legacy({policy:policy(legacyBranch),manualCounter:true});current=await snapshot();assert.equal(current.revision,beforeDouble+2,'Older application increments can create opaque revision gaps');
 const beforeRollback=current;assert.equal((await f.request('POST','/fixture/legacy-protection',{trunk,branch:legacyBranch,policy:policy(legacyBranch,false),rollback:true})).status,400);assert.deepEqual(await snapshot(),beforeRollback,'Failed legacy transaction rolls back both data and revision');
 await legacy({});current=await snapshot();assert.deepEqual(current.policies,beforeLegacy.policies);
 await f.restart();assert.deepEqual(await snapshot(),current,'Storage triggers and their revision survive restart');
 await f.json('DELETE','/api/cli/credentials/'+grant.id,undefined,admin);assert.equal((await f.request('GET',gateway+'/protection',undefined,auth(grant))).status,401);
 assert.equal((await f.request('POST',gateway+'/rulesets',{},auth(ordinary))).status,403);
 // Consent and token exchange both re-evaluate the admin role.
 const flow=await f.json('POST','/api/cli/device',{trunk,scopes,days:1,label:'Explicit protection consent'});
 assert.deepEqual((await f.json('GET','/api/cli/authorize?code='+flow.user_code,undefined,writer)).allowedScopes,['read']);
 assert.equal((await f.request('POST','/api/cli/authorize',{userCode:flow.user_code,decision:'approve',codeConfirmed:true,scopes,days:1},writer)).status,403);
 assert.equal((await f.request('POST','/api/cli/authorize',{userCode:flow.user_code,decision:'approve',codeConfirmed:true,scopes,days:1},admin)).status,200);
 await f.json('PATCH',base+'/collaborators',{userId:'codegraff:admin',role:'writer'},owner);
 const denied=await (await f.request('POST','/api/cli/token',{device_code:flow.device_code})).json() as any;assert.equal(denied.error,'access_denied');
 assert.equal((await f.request('GET',gateway+'/protection',undefined,auth(ordinary))).status,200);
 console.log('PASS: real Bun protection export/edit/delete, explicit admin-only grants and current demotion checks, browser/device scope consent, revision races, browser invalidation, CLI audit, overlapping locks enforce real Git/HTTP writes, archive/namespace/restart, legacy SQL/ABA/double-counter/transaction rollback fences, revocation and unchanged main');
} finally {
 for(const c of credentials)await f.request('DELETE','/api/cli/credentials/'+c.id,undefined,c.cookie).catch(()=>{});
 if(owner&&gitToken)await f.request('DELETE','/api/tokens/'+gitToken.id,undefined,owner).catch(()=>{});
 await f.close();
}
