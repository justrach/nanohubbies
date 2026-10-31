import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile,readFile,chmod,symlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {teamFixture,ROOM} from './team/fixture.ts';
const f=await teamFixture(),exec=promisify(execFile),trunk='branch-rename',base='/api/trunks/'+trunk,gateway='/api/cli/trunks/'+trunk;
const environment={...process.env,NANOHUB_API_TOKEN:'',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'},auth=(c:any)=>({Authorization:'Bearer '+c.token});
const credentials:{id:string;cookie:any}[]=[];
let owner:any,key:any,bin=resolve(import.meta.dirname,'../../cli/bin/nh.mjs');
const cli=async(args:string[],credential:any,repository?:string)=>{try{return {code:0,...await exec('bun',[bin,'branch',...args,'--host',f.origin,...(repository?['-R',repository]:['--trunk',trunk]),'--json'],{cwd:f.dir,env:{...environment,NANOHUB_API_TOKEN:credential.token}})};}catch(error){const e=error as Error&{code:number;stdout:string;stderr:string};return {code:e.code,stdout:e.stdout,stderr:e.stderr};}};
const fault=(body:unknown)=>f.json('POST','/fixture/branch-rename-fault',{trunk,...body as object});
try{
 if(process.argv.includes('--bundle')){
  const distribution=join(f.dir,"Rename CLI's portable distribution"),built=await exec('bun',[resolve(import.meta.dirname,'../../cli/scripts/build.mjs'),distribution],{env:environment});
  bin=join(distribution,JSON.parse(built.stdout).path.replace(/^\/nh\//,''));
 }
 owner=await f.login('owner','101');const admin=await f.login('admin','202'),writer=await f.login('writer','303'),reader=await f.login('reader','404');
 await f.json('POST',base,{mode:'git'},owner);await f.json('POST','/api/trunks/branch-other',{mode:'git'},owner);
 for(const [id,cookie,role]of [['admin',admin,'admin'],['writer',writer,'writer'],['reader',reader,'reader']]as const){const invite=await f.json('POST',base+'/collaborators',{userId:'codegraff:'+id,role},owner);await f.json('POST','/api/invitations/accept',{trunk,token:invite.token},cookie);}
 const make=async(cookie:any,scopes=['read','branches:write'])=>{const value=await f.json('POST',base+'/cli-credentials',{label:'Branch rename fixture',scopes,days:1},cookie);credentials.push({id:value.id,cookie});return value;};
 const grant=await make(admin),write=await make(writer),read=await make(reader,['read']),ordinary=await make(owner,['read','repository:default','rulesets:write']);
 assert.ok(!(await f.json('GET',base+'/cli-credentials',undefined,reader)).allowedScopes.includes('branches:write'));
 assert.equal((await f.request('POST',base+'/cli-credentials',{label:'Denied reader rename',scopes:['read','branches:write'],days:1},reader)).status,403);
 key=await f.json('POST',base+'/git-tokens',{label:'Rename Git transport'},owner);
 const source=join(f.dir,'source');await mkdir(source);
 const remote=f.origin+'/git/'+trunk+'.git',gitEnv={...environment,GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'http.extraHeader',GIT_CONFIG_VALUE_0:'Authorization: Basic '+btoa('git:'+key.token)};
 const git=async(...args:string[])=>(await exec('git',['-C',source,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args],{env:gitEnv})).stdout.trim();
 await git('init','-b','main');await writeFile(join(source,'README.md'),'# Branch rename fixture\n');await writeFile(join(source,'asset.bin'),Buffer.from(Array.from({length:4096},(_,i)=>i%256)));await writeFile(join(source,'tool.sh'),'#!/bin/sh\necho fixture\n');await chmod(join(source,'tool.sh'),0o755);await symlink('README.md',join(source,'readme-link'));await git('add','.');await git('commit','-m','Seed');
 const main=await git('rev-parse','HEAD'),mainTree=await git('rev-parse','HEAD^{tree}');await git('tag','-a','seed','-m','Annotated fixture');
 await git('switch','-c','feature');await writeFile(join(source,'README.md'),'# Renamable change\n');await git('commit','-am','Feature');const head=await git('rev-parse','HEAD'),headTree=await git('rev-parse','HEAD^{tree}');
 await git('switch','-c','topic');await writeFile(join(source,'topic.txt'),'Child branch\n');await git('add','.');await git('commit','-m','Topic');await git('push',remote,'main','feature','topic','refs/tags/seed');
 const p1=await f.json('POST',base+'/pulls',{head:'feature',base:'main',title:'Rename closes this head',body:''},admin),p2=await f.json('POST',base+'/pulls',{head:'topic',base:'feature',title:'Rename retargets this base',body:''},admin);
 assert.equal(p1.pulls[0].number,1);assert.equal(p2.pulls[0].number,2);
 const renamed="feature/日本語/'-$USER;$(literal)";
 let data=await f.json('GET',gateway+'/branch-rename?'+new URLSearchParams({from:'feature',to:renamed}),undefined,auth(write));
 assert.equal(data.protocol,1);assert.equal(data.revisionTracking,'storage');assert.equal(data.preview.requiresAdmin,false);assert.deepEqual(data.preview.closedPulls,[1]);assert.deepEqual(data.preview.retargetedPulls,[2]);
 const body=(from:string,to:string,status:any)=>({from,to,commit:status.branches.find((b:any)=>b.name===from).commit,revision:status.revision});
 const post=(credential:any,input:any)=>f.request('POST',gateway+'/branch-rename',input,{...auth(credential),'If-Match':`"branch-rename-${input.revision}"`});
 for(const c of [read,ordinary])assert.equal((await post(c,body('feature',renamed,data))).status,403);
 assert.equal((await f.request('POST',gateway+'/branch-rename',body('feature',renamed,data),auth(write))).status,428);
 assert.equal((await f.request('POST',gateway+'/branch-rename',body('feature',renamed,data),{...auth(write),'If-Match':'"branch-rename-'+'f'.repeat(64)+'"'})).status,400);
 assert.equal((await post(write,{...body('feature',renamed,data),proof:{linear:true}})).status,400);
 assert.equal((await post(write,{...body('feature',renamed,data),commit:main})).status,400);
 assert.equal((await f.request('POST',base+'/branch-rename',body('feature',renamed,data),auth(write))).status,401);
 assert.equal((await f.request('GET','/api/cli/trunks/branch-other/branch-rename',undefined,auth(write))).status,404);
 let result=await cli(['list'],read);assert.equal(result.code,0,result.stdout);assert.equal(JSON.parse(result.stdout).canRename,false);
 result=await cli(['rename','feature',renamed,'--revision',data.revision],write);assert.equal(result.code,0,result.stdout);assert.equal(JSON.parse(result.stdout).renamed.commit,head);
 let snapshot=await f.json('GET',base+'/branches',undefined,owner);assert.equal(snapshot.pulls.find((p:any)=>p.number===1).state,'closed');assert.equal(snapshot.pulls.find((p:any)=>p.number===1).headCommit,head);assert.equal(snapshot.pulls.find((p:any)=>p.number===2).base,renamed);
 assert.equal((await f.json('GET',base+'/branches/tree?'+new URLSearchParams({name:'feature'}),undefined,reader)).branch.name,renamed);
 const refs=(await f.json('GET',base+'/repository',undefined,owner)).refs;assert.equal(refs.find((r:any)=>r.name==='refs/heads/'+renamed).tree,headTree);assert.ok(!refs.some((r:any)=>r.name==='refs/heads/feature'));
 const audit=(await f.json('GET',base+'/repository/audit?kind=refs&limit=100',undefined,owner)).events,forwarded=audit.find((event:any)=>event.forwardedPush&&event.ref==='refs/heads/'+renamed);assert.equal(forwarded.actor,'codegraff:owner');assert.equal(forwarded.forwardedPush.renamedBy,'codegraff:writer');
 // The rename administrator must never become the latest code pusher.
 await f.json('PUT',base+'/protection',{branch:'main',pullRequest:true,approvals:1,checks:[],beforeOpen:[],preventForce:true,preventDelete:true,requireLastPushApproval:true},owner);
 await f.json('POST',base+'/pulls',{head:renamed,base:'main',title:'Original pusher stays ineligible',body:''},admin);
 let detail=await f.json('GET',base+'/pulls/3',undefined,owner);
 await f.json('POST',base+'/pulls/3/reviews',{commit:head,anchor:detail.pull.anchor,verdict:'APPROVE',body:'Original pusher cannot satisfy approval'},owner);
 detail=await f.json('GET',base+'/pulls/3',undefined,owner);assert.equal(detail.reviewGate.ready,false);assert.equal(detail.reviewGate.approvals,0);
 await f.json('POST',base+'/pulls/3/reviews',{commit:head,anchor:detail.pull.anchor,verdict:'APPROVE',body:'Independent writer approves'},writer);
 detail=await f.json('GET',base+'/pulls/3',undefined,owner);assert.equal(detail.reviewGate.ready,true);
 // Stale exports remain stale after old SQL performs an ABA ref change.
 data=await f.json('GET',gateway+'/branch-rename',undefined,auth(grant));const prepared=body(renamed,'after-aba',data);
 await fault({legacy:{branch:renamed,commit:main,tree:mainTree}});await fault({legacy:{branch:renamed,commit:head,tree:headTree}});assert.equal((await post(grant,prepared)).status,412);
 // A late failure rolls back the real serialized Worker transaction.
 data=await f.json('GET',gateway+'/branch-rename',undefined,auth(grant));await fault({late:true});const beforeFailure=(await f.json('GET',base+'/repository',undefined,owner)).refs;
 assert.equal((await post(grant,body(renamed,'late-failure',data))).status,400);assert.deepEqual((await f.json('GET',base+'/repository',undefined,owner)).refs,beforeFailure);await fault({});
 // Neither an old receiver nor a lost answer is silently retried.
 await fault({missingRead:true});assert.equal((await f.request('GET',gateway+'/branch-rename',undefined,auth(grant))).status,503);assert.equal((await f.request('GET',base+'/branches/tree?name=feature',undefined,owner)).status,503);await fault({missingWrite:true});data=await f.json('GET',gateway+'/branch-rename',undefined,auth(grant));assert.equal((await post(grant,body(renamed,'old-receiver',data))).status,503);assert.deepEqual((await f.json('GET',base+'/repository',undefined,owner)).refs,beforeFailure);await fault({});
 await f.json('POST',base+'/branches',{name:'lost-rename',from:'main'},owner);await f.json('POST','/fixture/drop-branch-rename-acknowledgement',{});
 result=await cli(['rename','lost-rename','acknowledged-on-inspection'],grant);assert.notEqual(result.code,0);
 snapshot=await f.json('GET',base+'/branches',undefined,owner);assert.ok(snapshot.branches.some((b:any)=>b.name==='acknowledged-on-inspection'));assert.ok(!snapshot.branches.some((b:any)=>b.name==='lost-rename'));
 assert.equal((await f.json('GET',base+'/repository/audit?kind=settings&limit=100',undefined,owner)).events.filter((e:any)=>e.branchRename?.from==='lost-rename').length,1);
 // Locks are stronger than administrative rename permission.
 let protection=(await f.json('GET',base+'/protection',undefined,owner)).policies.find((p:any)=>p.branch==='main');await f.json('PUT',base+'/protection',{...protection,locked:true},owner);
 data=await f.json('GET',gateway+'/branch-rename',undefined,auth(grant));assert.equal((await post(grant,body('main','trunk',data))).status,400);
 await f.json('PUT',base+'/protection',{...protection,locked:false},owner);
 const rule=await f.json('POST',base+'/rulesets',{name:'Retain renamed main',target:'branch',enforcement:'active',conditions:{ref_name:{include:['refs/heads/main','~DEFAULT_BRANCH'],exclude:[]}},rules:[{type:'non_fast_forward'}]},owner);
 data=await f.json('GET',gateway+'/branch-rename',undefined,auth(grant));assert.equal((await post(write,body('main','trunk',data))).status,403);
 result=await cli(['rename','main','trunk','--revision',data.revision],grant);assert.equal(result.code,0,result.stdout);
 assert.equal(await(await fetch(remote+'/HEAD',{headers:{Authorization:'Basic '+btoa('git:'+key.token)}})).text(),'ref: refs/heads/trunk\n');
 const renamedPolicy=(await f.json('GET',base+'/protection',undefined,owner)).policies.find((p:any)=>p.branch==='trunk');assert.equal(renamedPolicy.approvals,1);assert.equal(renamedPolicy.requireLastPushApproval,true);assert.equal(renamedPolicy.preventDelete,true);
 assert.deepEqual((await f.json('GET',base+'/rulesets/'+rule.id,undefined,owner)).conditions.ref_name.include,['refs/heads/trunk','~DEFAULT_BRANCH']);
 detail=await f.json('GET',base+'/pulls/3',undefined,owner);assert.equal(detail.pull.base,'trunk');assert.equal(detail.reviewGate.ready,true);
 // Current membership and grant checks also run when the HTTP precheck is bypassed.
 await f.json('POST',base+'/branches',{name:'final-check',from:'trunk'},owner);data=await f.json('GET',gateway+'/branch-rename',undefined,auth(grant));const finalInput=body('final-check','final-checked',data);
 await f.json('PATCH',base+'/collaborators',{userId:'codegraff:admin',role:'reader'},owner);
 let direct=await f.request('POST','/fixture/conditional-branch-rename',{trunk,...finalInput,actor:'codegraff:admin',credentialId:grant.id});assert.equal(direct.status,400);assert.match(await direct.text(),/write membership/);
 await f.json('PATCH',base+'/collaborators',{userId:'codegraff:admin',role:'admin'},owner);
 const revocable=await make(admin);await f.json('DELETE','/api/cli/credentials/'+revocable.id,undefined,admin);
 direct=await f.request('POST','/fixture/conditional-branch-rename',{trunk,...finalInput,actor:'codegraff:admin',credentialId:revocable.id});assert.equal(direct.status,400);assert.match(await direct.text(),/Current branches:write/);
 // One global export cannot authorize two different concurrent renames.
 await f.json('POST',base+'/branches',{name:'race-two',from:'trunk'},owner);data=await f.json('GET',gateway+'/branch-rename',undefined,auth(grant));
 const raced=await Promise.all([post(grant,body('final-check','race-one-done',data)),post(grant,body('race-two','race-two-done',data))]);assert.deepEqual(raced.map(r=>r.status).sort(),[200,412]);
 await f.json('POST',base+'/archive',{archived:true,revision:0,confirmation:trunk},owner);data=await f.json('GET',gateway+'/branch-rename',undefined,auth(grant));assert.equal(data.canRename,false);assert.ok(!(await f.json('GET',base+'/cli-credentials',undefined,admin)).allowedScopes.includes('branches:write'));await f.json('POST',base+'/archive',{archived:false,revision:1,confirmation:trunk},owner);
 // Namespace aliases retain the same credential and revision boundary.
 await f.json('POST','/api/namespaces',{name:'rename-owner'},owner);await f.json('POST','/api/repository-addresses/'+trunk,{namespace:'rename-owner',name:'before'},owner);await f.json('POST','/api/repos/rename-owner/before/address',{name:'after'},owner);
 result=await cli(['list'],read,'rename-owner/before');assert.equal(result.code,0,result.stdout);assert.equal(JSON.parse(result.stdout).defaultBranch,'trunk');
 await f.restart();owner=await f.login('owner','101');snapshot=await f.json('GET',base+'/branches',undefined,owner);assert.equal(snapshot.defaultBranch,'trunk');assert.equal((await f.json('GET',base+'/branches/tree?name=main',undefined,owner)).branch.name,'trunk');
 const clone=join(f.dir,'clone');await git('clone',remote,clone);assert.equal((await exec('git',['-C',clone,'symbolic-ref','HEAD'])).stdout.trim(),'refs/heads/trunk');await exec('git',['-C',clone,'fsck','--strict']);assert.equal((await exec('git',['-C',clone,'rev-parse','HEAD'])).stdout.trim(),main);assert.deepEqual(await readFile(join(clone,'asset.bin')),await readFile(join(source,'asset.bin')));assert.equal((await exec('git',['-C',clone,'rev-parse','refs/tags/seed'])).stdout.trim(),await git('rev-parse','refs/tags/seed'));
 // No provider metadata outage can become authority at the final writer.
 const team='rename-team';await f.json('POST','/api/trunks/'+team,{mode:'git'},owner);await f.json('POST','/api/trunks/'+team+'/team',{roomId:ROOM},owner);f.provider.down=true;const calls=f.provider.calls;
 direct=await f.request('POST','/fixture/conditional-branch-rename',{trunk:team,from:'main',to:'trunk',commit:main,revision:'a'.repeat(64),actor:'codegraff:owner'});assert.equal(direct.status,400);assert.ok(f.provider.calls>calls);f.provider.down=false;
 console.log('PASS: '+(process.argv.includes('--bundle')?'portable bundled':'source')+' native branch CLI and real Worker/Git rename, exact binary/mode/symlink/tag identity and clone/fsck; default/protection/ruleset continuity, preserved pusher independence, closed head PRs and retargeted bases, current roles/scopes/revocation, SQL ABA/rollback and revision races, old receivers/lost answers, aliases, archive and restart');
}finally{f.provider.down=false;if(owner){if(key)await f.request('DELETE','/api/tokens/'+key.id,undefined,owner).catch(()=>{});for(const c of credentials)await f.request('DELETE','/api/cli/credentials/'+c.id,undefined,c.cookie).catch(()=>{});}await f.close();}
