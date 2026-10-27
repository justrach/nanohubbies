import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {teamFixture} from './team/fixture.ts';
const f=await teamFixture(),exec=promisify(execFile),trunk='success-only-git',base='/api/trunks/'+trunk,gateway='/api/cli/trunks/'+trunk,runners:any[]=[],credentials:any[]=[],keys:any[]=[];
let owner:any;
try{
 const gate=join(f.dir,'check-gate.mjs');await build({entryPoints:[new URL('../src/ci/check-gate.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',outfile:gate});const {checkFailure}=await import(pathToFileURL(gate).href);
 owner=await f.login('owner','101');const writer=await f.login('writer','202');await f.json('POST',base,{mode:'git'},owner);const invitation=await f.json('POST',base+'/collaborators',{userId:'codegraff:writer',role:'writer'},owner);await f.json('POST','/api/invitations/accept',{trunk,token:invitation.token},writer);
 const source=join(f.dir,'source');await mkdir(source);const environment={...process.env,NANOHUB_API_TOKEN:'',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'};
 const key=await f.json('POST',base+'/git-tokens',{label:'Strict conclusions Git fixture'},owner);keys.push(key);const remote=f.origin+'/git/'+trunk+'.git',git=async(...args:string[])=>(await exec('git',['-C',source,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args],{env:environment})).stdout.trim(),transport=async(...args:string[])=>exec('git',['-C',source,...args],{env:{...environment,GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'http.extraHeader',GIT_CONFIG_VALUE_0:'Authorization: Basic '+btoa('git:'+key.token)}});
 await git('init','-b','main');await writeFile(join(source,'README.md'),'Base\n');await git('add','.');await git('commit','-m','Base');const anchor=await git('rev-parse','HEAD');await transport('push',remote,'main');await git('checkout','-b','feature');await writeFile(join(source,'README.md'),'Strict check candidate\n');await git('commit','-am','Candidate');const head=await git('rev-parse','HEAD');await transport('push',remote,'feature');
 const trusted=await f.json('POST',base+'/ci/runners',{name:'trusted'},owner),other=await f.json('POST',base+'/ci/runners',{name:'other'},owner);runners.push(trusted,other);const auth=(value:any)=>({authorization:'Bearer '+value.token});
 const policy={branch:'main',pullRequest:true,approvals:0,checks:['test'],beforeOpen:['test'],checkSources:[{name:'test',runner:trusted.id}],preventForce:true,preventDelete:true,successOnlyChecks:true};
 assert.equal((await f.json('GET',base+'/protection',undefined,owner)).successOnlyCheckConclusions,true);await f.json('PUT',base+'/protection',policy,owner);
 assert.equal((await f.request('PUT',base+'/protection',{...policy,successOnlyChecks:false},writer)).status,403);
 const result=(state:string)=>({name:'test',state,command:'Trusted synthetic exact-candidate check',log:'',artifacts:[]});let id='',previous:any;
 const begin=async(runner=trusted)=>{
  if(id)await f.json('POST',base+'/ci/retry',{runId:id},owner);
  let run=(await f.json('POST',base+'/ci/claim',{},auth(runner))).run;
  while(run&&run.head!==head){await f.json('POST',base+'/ci/runs/'+run.id,{attempt:run.attempt,results:[],staging:null},auth(runner));run=(await f.json('POST',base+'/ci/claim',{},auth(runner))).run;}
  assert.ok(run);id=run.id;return run;
 };
 const complete=async(run:any,state:string,runner=trusted)=>{const body={attempt:run.attempt,results:[result(state)],staging:null};assert.equal((await f.request('POST',base+'/ci/runs/'+id,body,auth(key))).status,401);const completed=await f.json('POST',base+'/ci/runs/'+id,body,auth(runner));assert.deepEqual(await f.json('POST',base+'/ci/runs/'+id,body,auth(runner)),completed);previous=body;return completed;};
 const deliver=async(state:string,runner=trusted)=>complete(await begin(runner),state,runner),open={title:'Success-only merge',head:'feature'},merge={commit:head,anchor};
 for(const state of ['neutral','skipped']){await deliver(state);const denied=await f.request('POST',base+'/pulls',open,owner);assert.equal(denied.status,400);assert.match((await denied.json()).error,/requires Success/);}
 await deliver('success');await f.json('POST',base+'/pulls',open,owner);await assert.rejects(transport('push',remote,'feature:refs/heads/main'),/reviewed pull request/);await assert.rejects(transport('push',remote,'feature:refs/for/main'),/Only branch and tag refs are supported/);
 const unchanged=async()=>{const view=await f.json('GET',base+'/pulls/1',undefined,owner);assert.equal(view.pull.state,'open');assert.equal(view.branches.find((b:any)=>b.name==='main').commit,anchor);assert.equal(view.head.commit,head);return view;},blocked=async(pattern:RegExp)=>{const denied=await f.request('POST',base+'/pulls/1/merge',merge,owner);assert.equal(denied.status,400);assert.match((await denied.json()).error,pattern);await unchanged();};
 const oldSuccess=previous;await f.json('POST',base+'/ci/retry',{runId:id},owner);await blocked(/Required check/);let run=(await f.json('POST',base+'/ci/claim',{},auth(trusted))).run;assert.equal(run.id,id);await blocked(/Required check/);for(const state of ['error','unknown'])assert.equal((await f.request('POST',base+'/ci/runs/'+id,{attempt:run.attempt,results:[result(state)],staging:null},auth(trusted))).status,403);await blocked(/Required check/);await complete(run,'skipped');await blocked(/requires Success/);assert.equal((await f.request('POST',base+'/ci/runs/'+id,oldSuccess,auth(trusted))).status,403);
 await deliver('success',other);await blocked(/must be reported by trusted/);await deliver('neutral');await blocked(/requires Success/);
 const grant=await f.json('POST',base+'/cli-credentials',{label:'Strict policy CLI fixture',scopes:['read','protections:write'],days:1},owner);credentials.push(grant);const bin=join(f.dir,"Strict CLI's standalone.mjs");await exec('bun',['build',resolve(import.meta.dirname,'../../cli/bin/nh.mjs'),'--target=bun','--outfile',bin],{env:environment});
 const cli=async(...args:string[])=>exec('bun',[bin,'rules',...args,'--host',f.origin,'--trunk',trunk,'--json'],{cwd:f.dir,env:{...environment,NANOHUB_API_TOKEN:grant.token}});
 const exported=JSON.parse((await cli('get','main')).stdout);assert.equal(exported.policy.successOnlyChecks,true);const file=join(f.dir,'strict policy.json');await writeFile(file,JSON.stringify({...exported,policy:{...exported.policy,successOnlyChecks:false}}));await cli('set','--file',file);
 let view=await unchanged(),effective=view.effectivePolicies.main,current=view.runs.find((r:any)=>r.id===id);assert.equal(effective.successOnlyChecks,false);assert.equal(checkFailure(current,'test',effective.checkSources,view.ciSources,effective.successOnlyChecks),null);
 // An old permissive preview cannot weaken another matching requirement.
 await f.json('PUT',base+'/protection',{...policy,branch:'ma*'},owner);view=await unchanged();assert.equal(view.effectivePolicies.main.successOnlyChecks,true);assert.match(checkFailure(view.runs.find((r:any)=>r.id===id),'test',view.effectivePolicies.main.checkSources,view.ciSources,true)!,/requires Success/);await blocked(/requires Success/);
 const stale=await f.request('PUT',gateway+'/protection',{...policy,successOnlyChecks:false},{...auth(grant),'If-Match':`"protection-${exported.revision}"`});assert.equal(stale.status,412);
 for(const state of ['failure','cancelled','timed_out','action_required','stale','skipped']){await deliver(state);await blocked(/Required check/);}
 await f.restart();owner=await f.login('owner','101');await blocked(/requires Success/);assert.equal((await f.json('GET',base+'/pulls/1',undefined,owner)).effectivePolicies.main.successOnlyChecks,true);
 await deliver('success');view=await unchanged();assert.equal(checkFailure(view.runs.find((r:any)=>r.id===id),'test',view.effectivePolicies.main.checkSources,view.ciSources,true),null);
 const merged=await f.json('POST',base+'/pulls/1/merge',merge,owner);assert.equal(merged.pulls[0].mergedCommit,head);assert.equal(merged.pulls[0].mergedCIBase,anchor);
 const clone=join(f.dir,'clone');await transport('clone',remote,clone);assert.equal((await exec('git',['-C',clone,'rev-parse','HEAD'],{env:environment})).stdout.trim(),head);await exec('git',['-C',clone,'fsck','--strict'],{env:environment});
 const activity=await f.json('GET',base+'/repository/audit?kind=protections',undefined,owner);assert.ok(activity.events.some((e:any)=>e.via?.credentialId===grant.id&&e.policy.successOnlyChecks===false));
 await f.json('DELETE','/api/cli/credentials/'+grant.id,undefined,owner);assert.equal((await f.request('GET',gateway+'/protection',undefined,auth(grant))).status,401);
 console.log('PASS: real Git/Worker success-only pre-PR and merge gates, default-compatible explicit opt-out, overlapping strict policy, current-policy preview/final parity, newest same-SHA attempt, trusted sources and stale callback denial, direct/alternate landing refusal, standalone CLI export/CAS, audit/restart/revocation and exact clone/fsck');
}finally{if(owner){for(const runner of runners)await f.request('DELETE',base+'/ci/'+runner.id,undefined,owner).catch(()=>{});for(const key of keys)await f.request('DELETE','/api/tokens/'+key.id,undefined,owner).catch(()=>{});for(const credential of credentials)await f.request('DELETE','/api/cli/credentials/'+credential.id,undefined,owner).catch(()=>{});}await f.close();}
