import assert from 'node:assert/strict';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {mkdir,writeFile} from 'node:fs/promises';import {join,resolve} from 'node:path';import {teamFixture,ROOM} from './team/fixture.ts';
const f=await teamFixture(),exec=promisify(execFile),trunk='ruleset-roles',base='/api/trunks/'+trunk,tokens:{id:string;cookie:any;cli?:boolean}[]=[];
const role=(id:4|5,mode:'always'|'pull_request'='always')=>({actor_type:'RepositoryRole',actor_id:id,bypass_mode:mode});
const rule=(name:string,actors:any[],rules:any[]=[{type:'creation'}],refs=['refs/heads/guarded/**'])=>({name,target:'branch',enforcement:'active',conditions:{ref_name:{include:refs,exclude:[]}},bypass_actors:actors,rules});
let owner:any;
try{
 owner=await f.login('owner','101');const admin=await f.login('admin','303'),writer=await f.login('writer','202'),reader=await f.login('reader','404');await f.json('POST',base,{mode:'git'},owner);
 for(const[id,cookie,access]of[['admin',admin,'admin'],['writer',writer,'writer'],['reader',reader,'reader']]as const){const invitation=await f.json('POST',base+'/collaborators',{userId:'codegraff:'+id,role:access},owner);await f.json('POST','/api/invitations/accept',{trunk,token:invitation.token},cookie);}
 const key=await f.json('POST',base+'/git-tokens',{label:'Role bypass Git fixture'},owner);tokens.push({id:key.id,cookie:owner});const source=join(f.dir,'source');await mkdir(source);
 const git=async(...args:string[])=>(await exec('git',['-C',source,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args])).stdout.trim(),remote=f.origin+'/git/'+trunk+'.git';
 const push=async(credential:any,ref:string)=>exec('git',['-C',source,'push',remote,`HEAD:refs/heads/${ref}`],{env:{...process.env,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'http.extraHeader',GIT_CONFIG_VALUE_0:'Authorization: Basic '+btoa((credential.handle??'git')+':'+credential.token)}});
 await git('init','-b','main');await writeFile(join(source,'README.md'),'Role fixture\n');await git('add','.');await git('commit','-m','Seed');const main=await git('rev-parse','HEAD');await push(key,'main');
 const saved=await f.json('POST',base+'/rulesets',rule('Admin lifecycle',[role(5)],[{type:'creation'},{type:'deletion'}]),owner);const id=saved.id;
 assert.equal((await f.json('GET',base+'/rulesets',undefined,owner)).roleBypass,true);
 const editor=await f.json('POST',base+'/cli-credentials',{label:'Role JSON CLI fixture',scopes:['read','rulesets:write'],days:1},owner);tokens.push({id:editor.id,cookie:owner,cli:true});
 const cliArgs=['--host',f.origin,'--trunk',trunk,'--json'],cliEnv={...process.env,NANOHUB_API_TOKEN:editor.token};
 const sourceCLI=resolve(import.meta.dirname,'../../cli/bin/nh.mjs'),bundleCLI=join(f.dir,'Role CLI standalone.mjs');
 await exec('bun',['build',sourceCLI,'--target=bun','--outfile',bundleCLI],{env:cliEnv});
 let exported:any;for(const bin of[sourceCLI,bundleCLI]){const r=await exec('bun',[bin,'ruleset','export',String(id),...cliArgs],{cwd:f.dir,env:cliEnv});exported=JSON.parse(r.stdout);assert.deepEqual(exported.configuration.bypass_actors,[role(5)]);}
 const roleFile=join(f.dir,'role ruleset.json');await writeFile(roleFile,JSON.stringify(exported));await exec('bun',[sourceCLI,'ruleset','update',String(id),'--file',roleFile,...cliArgs],{cwd:f.dir,env:cliEnv});

 const branch=(name:string,cookie:any)=>f.request('POST',base+'/branches',{name:'guarded/'+name,from:'main'},cookie);
 for(const[name,cookie]of[['owner',owner],['admin',admin]]as const)assert.equal((await branch(name,cookie)).status,200);
 assert.equal((await branch('writer-denied',writer)).status,400);assert.equal((await branch('reader-denied',reader)).status,403);
 await assert.rejects(push(key,'guarded/git-denied'),/creation is restricted/);
 await f.json('POST',base+'/agents',{handle:'role-owner',type:'external'},owner);const agent=await f.json('POST',base+'/agents/role-owner/token',{},owner);tokens.push({id:agent.id,cookie:owner});await assert.rejects(push({...agent,handle:'role-owner'},'guarded/agent-denied'),/creation is restricted/);
 await f.json('PATCH',base+'/collaborators',{userId:'codegraff:admin',role:'writer'},owner);assert.equal((await branch('demoted-denied',admin)).status,400);assert.equal((await f.request('DELETE',base+'/branches',{name:'guarded/admin',commit:main},admin)).status,400);
 await f.json('PUT',base+'/rulesets/'+id,rule('Writer lifecycle',[role(4)],[{type:'creation'},{type:'deletion'}]),owner);assert.equal((await branch('writer-allowed',writer)).status,200);assert.equal((await branch('owner-not-writer',owner)).status,400);
 await f.json('PUT',base+'/rulesets/'+id,rule('Admin lifecycle',[role(5)],[{type:'creation'},{type:'deletion'}]),owner);
 await f.json('PUT',base+'/protection',{branch:'guarded/locked',pullRequest:false,approvals:0,checks:[],beforeOpen:[],preventForce:true,preventDelete:true,locked:true},owner);assert.equal((await branch('locked',owner)).status,400);
 const overlap=await f.json('POST',base+'/rulesets',rule('Independent block',[]),owner);assert.equal((await branch('overlap-denied',owner)).status,400);await f.json('DELETE',base+'/rulesets/'+overlap.id,undefined,owner);
 const full=(await f.json('GET',base+'/rulesets/'+id,undefined,owner));assert.deepEqual(full.bypass_actors,[role(5)]);assert.equal((await f.json('GET',base+'/rulesets/'+id,undefined,writer)).bypass_actors,undefined);
 // PR-only role bypass includes that ruleset's signature/deployment checks;
 // classic rules and other rulesets retain their separate authority.
 await f.json('POST',base+'/environments',{name:'staging'},owner);
 const mergeRule=await f.json('POST',base+'/rulesets',rule('Admin PR merge',[role(5,'pull_request')],[{type:'update'},{type:'required_signatures'},{type:'required_deployments',parameters:{required_deployment_environments:['staging']}}],['refs/heads/main']),owner);
 await git('checkout','-b','topic');await writeFile(join(source,'README.md'),'Reviewed role candidate\n');await git('commit','-am','Candidate');let head=await git('rev-parse','HEAD');await push(key,'topic');await f.json('POST',base+'/pulls',{title:'Role-bound PR bypass',head:'topic'},writer);
 let view=await f.json('GET',base+'/pulls/1',undefined,owner);assert.equal(view.signatures.required,false);assert.equal(view.deployments.ready,true);
 await f.json('POST',base+'/rulesets',rule('Suggestion writer',[role(4)],[{type:'update'}],['refs/heads/topic']),owner);
 const comment={id:'role-suggestion-comment',commit:head,anchor:view.pull.anchor,path:'README.md',side:'RIGHT',startLine:1,line:1,body:'```suggestion\nRole-authorized suggestion\n```'};
 await f.json('POST',base+'/pulls/1/comments',comment,writer);
 const application=await f.json('POST',base+'/pulls/1/suggestions/apply',{id:'role-suggestion-apply',commit:head,anchor:view.pull.anchor,commentIds:[comment.id],message:'Apply role-authorized suggestion'},writer);head=application.application.commit;
 view=await f.json('GET',base+'/pulls/1',undefined,owner);

 const input={commit:head,anchor:view.pull.anchor};
 const cli=await f.json('POST',base+'/cli-credentials',{label:'CLI cannot inherit browser bypass',scopes:['read','pulls:merge'],days:1},owner);tokens.push({id:cli.id,cookie:owner,cli:true});assert.equal((await f.request('POST','/api/cli/trunks/'+trunk+'/pulls/1/merge',input,{authorization:'Bearer '+cli.token})).status,400);
 const policy={branch:'main',pullRequest:true,approvals:0,checks:[],beforeOpen:[],preventForce:true,preventDelete:true,locked:true};await f.json('PUT',base+'/protection',policy,owner);assert.equal((await f.request('POST',base+'/pulls/1/merge',input,owner)).status,400);
 await f.json('PUT',base+'/protection',{...policy,locked:false,environments:['staging']},owner);view=await f.json('GET',base+'/pulls/1',undefined,owner);assert.equal(view.deployments.ready,false);assert.equal((await f.request('POST',base+'/pulls/1/merge',input,owner)).status,400);
 await f.json('PUT',base+'/protection',{...policy,locked:false},owner);await f.json('PATCH',base+'/collaborators',{userId:'codegraff:admin',role:'admin'},owner);
 view=await f.json('GET',base+'/pulls/1',undefined,admin);assert.equal(view.signatures.required,false);assert.equal(view.deployments.ready,true);
 await f.json('POST',base+'/pulls/1/merge',input,admin);assert.equal((await f.json('GET',base+'/pulls/1',undefined,owner)).pull.state,'merged');
 const events=(await f.json('GET',base+'/repository/audit?kind=bypasses',undefined,owner)).events;assert.ok(events.some((e:any)=>e.actor==='codegraff:writer'&&e.bypassRole.role==='writer'));assert.ok(events.some((e:any)=>e.actor==='codegraff:admin'&&e.merge&&e.bypassedRulesets.includes(mergeRule.id)&&e.bypassRole.role==='admin'));
 const suites=(await f.json('GET',base+'/rulesets/rule-suites?result=bypass',undefined,owner)).suites;assert.ok(suites.some((suite:any)=>suite.evaluations.some((e:any)=>e.bypass?.actor_type==='RepositoryRole'&&e.bypass.role==='admin')));
 await f.restart();owner=await f.login('owner','101');assert.deepEqual((await f.json('GET',base+'/rulesets/'+id,undefined,owner)).bypass_actors,[role(5)]);const clone=join(f.dir,'clone');await exec('git',['-c','http.extraHeader=Authorization: Basic '+btoa('git:'+key.token),'clone',remote,clone]);await exec('git',['-C',clone,'fsck','--strict']);assert.equal((await exec('git',['-C',clone,'rev-parse','HEAD'])).stdout.trim(),head);
 // External memberships use fresh provider evidence, with no display-name or
 // cached-owner fallback after a role change or provider outage.
 const team='ruleset-role-team',path='/api/trunks/'+team;await f.json('POST',path,{mode:'git'},owner);await f.json('POST',path+'/team',{roomId:ROOM},owner);
 const externalKey=await f.json('POST',path+'/git-tokens',{label:'External role fixture'},owner);tokens.push({id:externalKey.id,cookie:owner});await exec('git',['-C',source,'-c','http.extraHeader=Authorization: Basic '+btoa('git:'+externalKey.token),'push',f.origin+'/git/'+team+'.git','HEAD:refs/heads/main']);
 await f.json('POST',path+'/rulesets',rule('Provider writer role',[role(4)]),owner);
 assert.equal((await f.request('POST',path+'/branches',{name:'guarded/member',from:'main'},writer)).status,200);f.members.set('202','owner');assert.equal((await f.request('POST',path+'/branches',{name:'guarded/owner-not-writer',from:'main'},writer)).status,400);f.members.set('202','member');f.provider.down=true;assert.equal((await f.request('POST',path+'/branches',{name:'guarded/offline',from:'main'},writer)).status,503);f.provider.down=false;
 for(const c of tokens){await f.json('DELETE',(c.cli?'/api/cli/credentials/':'/api/tokens/')+c.id,undefined,c.cookie);}assert.equal((await f.request('GET','/api/cli/trunks/'+trunk+'/branches',undefined,{authorization:'Bearer '+cli.token})).status,401);
 console.log('PASS: explicit exact admin/writer role bypass, current native/provider membership and demotion, human-only credentials boundary, lifecycle and PR-only modes, consistent signature/deployment preview, independent locks/environments/overlaps, audit/insights, restart and native clone/fsck');
}finally{f.provider.down=false;if(owner)for(const c of tokens)await f.request('DELETE',(c.cli?'/api/cli/credentials/':'/api/tokens/')+c.id,undefined,c.cookie).catch(()=>{});await f.close();}
