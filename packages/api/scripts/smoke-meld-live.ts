/** Explicit live, checks-only bridge acceptance. Private inputs stay on the
 * trusted host; the source uses an isolated local Nanohub, not production. */
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify,parseEnv} from 'node:util';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,isAbsolute,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {teamFixture} from './team/fixture.ts';
import {runOnce} from '../../../tools/ci-runner.mjs';
import {retireMeldMirror} from '../../../tools/meld-mirror-cleanup.mjs';
import {meldRepository,meldRuns,meldRequiredSteps} from '../../../tools/meld-pipeline-state.mjs';
import {Codegraff} from '../../../tools/codegraff-actions.mjs';
import {createSandboxAccessPreflight} from '../../../tools/sandbox-access.mjs';

if(process.env.NANOHUB_LIVE_MELD!=='1')throw Error('Explicit NANOHUB_LIVE_MELD=1 is required; no live job was dispatched');
const [source,pipelineFile,providerFile,dir]=process.argv.slice(2);
if(![source,pipelineFile,providerFile,dir].every(value=>value&&isAbsolute(value)))throw Error('Provide absolute bare-source, pipeline-env, provider-env and new private artifact paths');
const root=resolve(import.meta.dirname,'../../..'),exec=promisify(execFile),hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
if(dir===source||dir.startsWith(source+'/')||dir===root||dir.startsWith(root+'/'))throw Error('Keep private artifacts outside both the source repository and trusted-tools checkout');
await mkdir(dir,{mode:0o700});
const secrets:string[]=[],safe=(error:unknown)=>{let text=error instanceof Error?error.message:String(error);for(const secret of secrets)text=text.replaceAll(secret,'[redacted]');return text.slice(0,2000);};
const save=(name:string,value:unknown)=>writeFile(join(dir,name),JSON.stringify(value,null,2)+'\n',{mode:0o600});
const clean={PATH:process.env.PATH,HOME:dir,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'};
const localGit=async(cwd:string,...args:string[])=>(await exec('git',['-C',cwd,...args],{env:clean,timeout:120000,maxBuffer:16<<20})).stdout.trim();
const gh=async(cwd:string,...args:string[])=>(await exec('git',['-C',cwd,'-c','credential.helper=!gh auth git-credential',...args],{env:{...clean,HOME:homedir()},timeout:120000,maxBuffer:2<<20})).stdout.trim();
const operation:any={format:1,startedAt:new Date().toISOString(),pid:process.pid,phase:'preflight',checksOnly:true,hostedNanohub:false,productionCredentialsIssued:0,stagingDeployed:false,cleanupErrors:[]};
await writeFile(join(dir,'launch-intent.json'),JSON.stringify(operation)+'\n',{mode:0o600,flag:'wx'});
let f:Awaited<ReturnType<typeof teamFixture>>|undefined,owner:any,grant:any,runner:any,nativeRun:any,externalJob:any,configuration:any,providerKey:string|undefined,beforeRefs='',beforeVersion:any;
const previousAdmin=process.env.PIPELINE_ADMIN_SECRET,previousOrigin=process.env.MELD_STAGING_CI_URL;
const controller=async(path:string,binary=false)=>{
 const response=await fetch('https://meld-staging-ci.phedayatnia.workers.dev'+path,{headers:{authorization:'Bearer '+configuration.PIPELINE_ADMIN_SECRET},redirect:'error',signal:AbortSignal.timeout(30000)});
 assert.equal(response.status,200,'Meld controller observation failed');const bytes=Buffer.from(await response.arrayBuffer());assert.ok(bytes.length<=(binary?32<<20:524288),'Controller response exceeded its bound');return binary?bytes:JSON.parse(bytes.toString('utf8'));
};
const version=async()=>{const r=await fetch('https://staging.meld.space/api/version',{headers:{'Cache-Control':'no-cache'},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});assert.equal(r.status,200);return r.json();};
const cleanup=async(name:string,work:()=>Promise<void>)=>{try{await work();}catch(error){operation.cleanupErrors.push({step:name,error:safe(error)});}await save('operation.json',operation);};
try{
 assert.equal(await localGit(root,'status','--porcelain','--untracked-files=all'),'','Commit the tested trusted tools before live acceptance');
 operation.nanohubSource=await localGit(root,'rev-parse','HEAD');assert.equal(await localGit(source,'rev-parse','--is-bare-repository'),'true','Use a private bare source, preserving original worktrees');
 const head=await localGit(source,'rev-parse','HEAD');assert.match(head,/^[a-f0-9]{40}$/);operation.candidate=head;
 configuration=parseEnv(await readFile(pipelineFile,'utf8'));assert.ok(configuration.PIPELINE_ADMIN_SECRET);secrets.push(configuration.PIPELINE_ADMIN_SECRET);
 if(configuration.MELD_STAGING_CI_URL)assert.equal(new URL(configuration.MELD_STAGING_CI_URL).href,'https://meld-staging-ci.phedayatnia.workers.dev/');
 providerKey=parseEnv(await readFile(providerFile,'utf8')).CODEGRAFF_API_KEY;assert.ok(providerKey);secrets.push(providerKey);await createSandboxAccessPreflight()(providerKey);
 const initial=await controller('/runs');await save('before-controller.json',initial);assert.equal(initial.active,null,'Wait for the existing controller job instead of dispatching another');assert.equal(initial.queued.length,0,'Wait for existing queued work before this explicit live test');
 beforeRefs=await gh(source,'ls-remote',meldRepository,'refs/heads/main','refs/heads/staging');beforeVersion=await version();await save('before-refs.json',{refs:beforeRefs});await save('before-staging.json',beforeVersion);
 await localGit(source,'fsck','--strict');operation.sourceObjects=(await localGit(source,'rev-list','--objects','--all')).split('\n').length;operation.sourceRefs=(await localGit(source,'for-each-ref','--format=%(refname)')).split('\n');
 const cli=JSON.parse((await exec('bun',[root+'/packages/cli/scripts/build.mjs',join(dir,'cli')],{env:clean,timeout:60000})).stdout);operation.cli=cli;
 f=await teamFixture();const trunk='meld-ci-live',base='/api/trunks/'+trunk;
 owner=await f.login('owner','101');await f.json('POST',base,{mode:'git'},owner);runner=await f.json('POST',base+'/ci/runners',{name:'meld-live-bridge'},owner);secrets.push(runner.token);
 grant=await f.json('POST',base+'/cli-credentials',{label:'Local Meld source import',days:1,scopes:['read','contents:read','contents:write']},owner);secrets.push(grant.token);
 operation.phase='import-actual-meld';await save('operation.json',operation);console.log(JSON.stringify({phase:operation.phase,candidate:head,objects:operation.sourceObjects}));
 const imported=await exec('bun',[join(dir,'cli',cli.path.slice('/nh/'.length)),'repo','import',source,'--host',f.origin,'--trunk',trunk,'--json'],{cwd:dir,env:{...clean,NANOHUB_API_TOKEN:grant.token},timeout:15*60000,maxBuffer:8<<20});
 await writeFile(join(dir,'import.log'),imported.stdout+'\n'+imported.stderr,{mode:0o600});operation.import=JSON.parse(imported.stdout);assert.equal(operation.import.objects,operation.sourceObjects);
 await f.json('DELETE','/api/cli/credentials/'+grant.id,undefined,owner);operation.importCredentialRevokedBeforeCi=true;
 await f.json('PUT',base+'/protection',{branch:'main',pullRequest:true,approvals:1,checks:['codegraff-ci'],beforeOpen:['codegraff-ci','staging'],successOnlyChecks:true,checkSources:[{name:'codegraff-ci',runner:runner.id}],preventForce:true,preventDelete:true},owner);
 const branches=await f.json('GET',base+'/branches',undefined,owner);nativeRun=branches.runs.find((run:any)=>run.state==='queued'&&run.head===head);assert.ok(nativeRun);
 operation.nativeRunId=nativeRun.id;operation.nativeOrigin=f.origin;operation.phase='run-real-meld-ci';await save('operation.json',operation);console.log(JSON.stringify({phase:operation.phase,nativeRunId:nativeRun.id}));
 process.env.PIPELINE_ADMIN_SECRET=configuration.PIPELINE_ADMIN_SECRET;process.env.MELD_STAGING_CI_URL='https://meld-staging-ci.phedayatnia.workers.dev';
 const response=await runOnce({origin:f.origin,trunk,artifacts:join(dir,'artifacts'),artifactOrigin:f.origin+'/private-artifacts/',pipelineAdapter:root+'/tools/meld-staging-adapter.mjs',stagingOrigin:'https://staging.meld.space'},runner.token);await save('native-callback.json',response);
 const final=await f.json('GET',base+'/branches',undefined,owner),completed=final.runs.find((run:any)=>run.id===nativeRun.id);assert.equal(completed.state,'complete');assert.equal(completed.head,head);assert.equal(completed.base,head);assert.equal(completed.results.length,1);assert.equal(completed.results[0].state,'success');assert.equal(completed.results[0].name,'codegraff-ci');
 const artifacts=join(dir,'artifacts',nativeRun.id,String(completed.attempt)),evidence=JSON.parse(await readFile(join(artifacts,'meld-pipeline.json'),'utf8'));assert.equal(evidence.candidate,head);assert.equal(evidence.staging,null);assert.equal(evidence.mirrorCleanup.removed,true);assert.ok(meldRequiredSteps.every(name=>evidence.pipelineEvidence.steps.filter((step:any)=>step.name===name&&step.exitCode===0).length===1));assert.ok(evidence.pipelineEvidence.steps.every((step:any)=>step.exitCode===0));
 operation.nativeCompletion={id:completed.id,head:completed.head,base:completed.base,attempt:completed.attempt,state:completed.state,results:completed.results};operation.externalRunId=evidence.runId;operation.suite=evidence.pipelineEvidence.steps;operation.mirrorCleanup=evidence.mirrorCleanup;await save('operation.json',operation);
 const current=await controller('/runs');externalJob=current.runs.find((job:any)=>job.id===evidence.runId);assert.ok(externalJob);assert.equal(externalJob.deploy,false);assert.equal(externalJob.phase,'passed');assert.notEqual(current.active?.id,externalJob.id);
 const build=await controller('/runs/'+externalJob.id+'/logs/build',true) as Buffer;for(const secret of secrets)assert.ok(!build.includes(Buffer.from(secret)),'Configured credential in build log');await writeFile(join(dir,'real-build.log'),build,{mode:0o600});operation.buildLog={bytes:build.length,sha256:hash(build)};
 await f.json('POST',base+'/ci/retry',{runId:nativeRun.id},owner);const retried=(await f.json('GET',base+'/branches',undefined,owner)).runs.find((run:any)=>run.id===nativeRun.id);assert.equal(retried.state,'queued');assert.equal(retried.results.length,0);operation.newerNativeRetryClearsOlderPass=true;operation.corePassed=true;await save('operation.json',operation);
}catch(error){operation.failure=safe(error);operation.corePassed=false;}
finally{
 if(previousAdmin===undefined)delete process.env.PIPELINE_ADMIN_SECRET;else process.env.PIPELINE_ADMIN_SECRET=previousAdmin;
 if(previousOrigin===undefined)delete process.env.MELD_STAGING_CI_URL;else process.env.MELD_STAGING_CI_URL=previousOrigin;
 if(configuration&&nativeRun)await cleanup('external job and mirror',async()=>{
  const artifacts=join(dir,'artifacts',nativeRun.id,'1'),dispatch=JSON.parse(await readFile(join(artifacts,'meld-dispatch.json'),'utf8'));assert.equal(dispatch.state,'acknowledged');const snapshot=await controller('/runs');externalJob=snapshot.runs.find((job:any)=>job.id===dispatch.jobId);assert.ok(externalJob);operation.externalRunId=externalJob.id;
  const retired=await retireMeldMirror({binding:dispatch.binding,jobId:dispatch.jobId,source,artifacts,git:gh,observe:async()=>meldRuns(await controller('/runs'))});assert.equal(retired.removed,true);assert.equal(await gh(source,'ls-remote','--refs',meldRepository,'refs/heads/'+dispatch.binding.ref),'');operation.ownedMirrorRefRemoved=true;
  assert.ok(providerKey);assert.match(externalJob.sandboxId,/^cnd_[a-f0-9]{40}$/);const provider=new Codegraff(providerKey);let state='unknown';try{const vm=await provider.api('/sandboxes/'+externalJob.sandboxId,undefined,'GET',20000);state=vm.state??vm.status;}catch(error:any){if(error.status!==404)throw error;state='absent';}assert.ok(['destroyed','deleted','expired','absent'].includes(state));operation.providerCleanup={sandboxId:externalJob.sandboxId,state,independentRead:true,existingMeldAccount:true};
 });
 if(f&&owner&&runner)await cleanup('revoke local runner',async()=>{const base='/api/trunks/meld-ci-live';await f!.json('DELETE',base+'/ci/'+runner.id,undefined,owner);operation.nativeRunnerRevoked=true;const denied=await f!.request('POST',base+'/ci/claim',{}, {Authorization:'Bearer '+runner.token});operation.revokedRunnerStatus=denied.status;assert.equal(denied.status,403);operation.revokedRunnerRejected=true;});
 if(f&&owner&&grant&&!operation.importCredentialRevokedBeforeCi)await cleanup('revoke local import',async()=>{await f!.json('DELETE','/api/cli/credentials/'+grant.id,undefined,owner);operation.importCredentialRevoked=true;});
 if(f)await cleanup('dispose local fixture',async()=>{await f!.close();operation.localFixtureDestroyed=true;});
 if(beforeRefs&&configuration)await cleanup('shared-state observation',async()=>{operation.afterRefs=await gh(source,'ls-remote',meldRepository,'refs/heads/main','refs/heads/staging');operation.stagingAfter=await version();operation.mainStagingRefsUnchanged=beforeRefs===operation.afterRefs;operation.stagingVersionUnchanged=JSON.stringify(beforeVersion)===JSON.stringify(operation.stagingAfter);assert.equal(operation.mainStagingRefsUnchanged,true);assert.equal(operation.stagingVersionUnchanged,true);});
 operation.acceptancePassed=operation.corePassed===true&&operation.cleanupErrors.length===0&&operation.nativeRunnerRevoked===true&&operation.revokedRunnerRejected===true&&operation.ownedMirrorRefRemoved===true&&operation.localFixtureDestroyed===true&&operation.providerCleanup?.independentRead===true&&operation.newerNativeRetryClearsOlderPass===true;
 operation.finishedAt=new Date().toISOString();operation.phase='finished';await save('operation.json',operation);
}
if(!operation.acceptancePassed)throw Error('Meld live acceptance did not complete; inspect the retained private operation and dispatch receipts without replaying the launch');
console.log(JSON.stringify({acceptancePassed:true,candidate:operation.candidate,nativeRun:operation.nativeRunId,externalRun:operation.externalRunId,suiteSteps:operation.suite.length,mirrorRemoved:true,revokedRunnerRejected:true,providerCleanup:operation.providerCleanup}));
