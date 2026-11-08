/** Opt-in, real Meld suite through native isolated Codegraff execution. Uses a
 * local Nanohub copy and synthetic workflow/probe commits, never live Meld refs. */
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify,parseEnv} from 'node:util';
import {readFile,writeFile,mkdir,realpath,rename,statfs} from 'node:fs/promises';
import {join,isAbsolute,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {teamFixture} from './team/fixture.ts';
import {runOnce} from '../../../tools/ci-runner.mjs';
import {Codegraff} from '../../../tools/codegraff-actions.mjs';
import {createSandboxAccessPreflight} from '../../../tools/sandbox-access.mjs';
import {meldNativeWorkflow,prepareMeldNativePlan} from '../../../tools/meld-native-plan.mjs';
import {toolchain} from '../../../tools/toolchain.mjs';
import {loadMeldStagePackage} from '../../../tools/meld-stage-artifact.mjs';

if(process.env.NANOHUB_LIVE_MELD_NATIVE!=='1')throw Error('Explicit NANOHUB_LIVE_MELD_NATIVE=1 is required; no live job was dispatched');
const [source,imageFile,providerFile,dir]=process.argv.slice(2);
if(![source,imageFile,providerFile,dir].every(value=>value&&isAbsolute(value)))throw Error('Provide absolute bare-source, trusted image config, provider-env and new private artifact paths');
const root=resolve(import.meta.dirname,'../../..'),exec=promisify(execFile),hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const canonicalSource=await realpath(source),canonicalRoot=await realpath(root),parent=await realpath(join(dir,'..')),destination=join(parent,dir.split('/').at(-1)!);
for(const repository of [canonicalSource,canonicalRoot])if(destination===repository||destination.startsWith(repository+'/'))throw Error('Keep private artifacts outside source and trusted tools');
await mkdir(destination,{mode:0o700});
const clean={PATH:process.env.PATH,HOME:destination,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'};
const git=async(cwd:string,...args:string[])=>(await exec('git',['-C',cwd,'-c','user.name=Native CI fixture','-c','user.email=fixture@example.invalid',...args],{env:clean,timeout:120000,maxBuffer:16<<20})).stdout.trim();
const secrets:string[]=[],safe=(error:unknown)=>{let value=error instanceof Error?error.message:String(error);for(const secret of secrets)value=value.replaceAll(secret,'[redacted]');return value.slice(0,1500);};
const save=async(name:string,value:unknown)=>{const path=join(destination,name),temporary=path+'.'+randomUUID();await writeFile(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(temporary,path);};
const operation:any={format:1,phase:'preflight',pid:process.pid,startedAt:new Date().toISOString(),hostedNanohub:false,originalMeldRefsWritten:false,stagingDeployed:false,productionDeployed:false,cleanupErrors:[]};
await writeFile(join(destination,'launch-intent.json'),JSON.stringify(operation)+'\n',{mode:0o600,flag:'wx'});
const stage=async(phase:string)=>{operation.phase=phase;await save('operation.json',operation);console.log(JSON.stringify({phase,nativeRunId:operation.nativeRunId??null}));};
let f:Awaited<ReturnType<typeof teamFixture>>|undefined,owner:any,grant:any,gitKey:any,runner:any,client:Codegraff|undefined,beforeRefs='';
const trunk='meld-native-live',base='/api/trunks/'+trunk,oldKey=process.env.CODEGRAFF_API_KEY;
const cleanup=async(step:string,work:()=>Promise<void>)=>{try{await work();}catch(error){operation.cleanupErrors.push({step,error:safe(error)});}await save('operation.json',operation);};
try{
 assert.equal(await git(root,'status','--porcelain','--untracked-files=all'),'','Commit trusted tools before live acceptance');operation.nanohubSource=await git(root,'rev-parse','HEAD');
 const disk=await statfs(destination),minimumFreeBytes=3*1024**3;operation.hostPreflight={freeBytes:disk.bavail*disk.bsize,minimumFreeBytes};assert.ok(operation.hostPreflight.freeBytes>=minimumFreeBytes,'The complete import fixture needs at least 3 GiB free before launch');
 assert.equal(await git(source,'rev-parse','--is-bare-repository'),'true');const original=await git(source,'rev-parse','HEAD');assert.match(original,/^[a-f0-9]{40}$/);operation.originalApplicationCommit=original;
 beforeRefs=await git(source,'for-each-ref','--format=%(refname) %(objectname)');await git(source,'fsck','--strict');
 const plan=await prepareMeldNativePlan({source,base:original,output:join(destination,'plan')});operation.plan={source:plan.sourceCommit,pipelineBlob:plan.pipelineBlob,workflowSha256:plan.workflowSha256,inputs:plan.inputs.length};
 const config=JSON.parse(await readFile(imageFile,'utf8'));const selected=toolchain(config.image,config.imageSnapshot,config.imageArchive,config.imageDownload,config.imageRegistry);assert.ok(selected.registry,'Use the verified private Meld toolchain registry image');
 const sourcePolicy={maxSourceBundleBytes:512*1024*1024,sourceTransferConcurrency:4};operation.toolchain={image:config.image,registryProvider:'cloudflare',network:'none',...sourcePolicy,...(config.sandboxAccessProbeId?{sandboxAccessProbeId:config.sandboxAccessProbeId}:{})};
 const key=parseEnv(await readFile(providerFile,'utf8')).CODEGRAFF_API_KEY;assert.ok(key);secrets.push(key);await createSandboxAccessPreflight()(key,{sandboxId:config.sandboxAccessProbeId});client=new Codegraff(key);process.env.CODEGRAFF_API_KEY=key;
 const checkout=join(destination,'copy');await exec('git',['clone','--no-hardlinks',source,checkout],{env:clean,timeout:120000});await git(checkout,'checkout','--detach',original);await git(checkout,'checkout','-B','main');await mkdir(join(checkout,'.github/workflows'),{recursive:true});
 const workflow=meldNativeWorkflow();await writeFile(join(checkout,'.github/workflows/meld.yml'),workflow);await git(checkout,'add','.github/workflows/meld.yml');await git(checkout,'commit','-m','Isolated fixture: bootstrap native Meld workflow');const anchor=await git(checkout,'rev-parse','HEAD');operation.acceptedWorkflowCommit=anchor;assert.equal(await git(checkout,'diff','--name-only',original,anchor),'.github/workflows/meld.yml');
 const initial=join(destination,'initial.git');await exec('git',['clone','--bare','--no-hardlinks','--single-branch','--branch','main',checkout,initial],{env:clean,timeout:120000});await git(initial,'fsck','--strict');
 const cli=JSON.parse((await exec('bun',[root+'/packages/cli/scripts/build.mjs',join(destination,'cli')],{env:clean,timeout:60000})).stdout);operation.cli=cli;
 f=await teamFixture();owner=await f.login('owner','101');await f.json('POST',base,{mode:'git'},owner);runner=await f.json('POST',base+'/ci/runners',{name:'meld-native-isolation'},owner);secrets.push(runner.token);
 grant=await f.json('POST',base+'/cli-credentials',{label:'Isolated native Meld import',days:1,scopes:['read','contents:read','contents:write']},owner);secrets.push(grant.token);
 await stage('import-actual-meld-with-bootstrap');
 const importStartedAt=Date.now(),importTimeoutMs=45*60000;let imported;
 try{imported=await exec('bun',[join(destination,'cli',cli.path.slice('/nh/'.length)),'repo','import',initial,'--host',f.origin,'--trunk',trunk,'--json'],{cwd:destination,env:{...clean,NANOHUB_API_TOKEN:grant.token},timeout:importTimeoutMs,maxBuffer:8<<20});}
 catch(error:any){operation.importFailure={elapsedMs:Date.now()-importStartedAt,timeoutMs:importTimeoutMs,killed:error.killed===true,signal:typeof error.signal==='string'&&/^SIG[A-Z]+$/.test(error.signal)?error.signal:null,code:typeof error.code==='number'?error.code:typeof error.code==='string'&&/^[A-Z_0-9]+$/.test(error.code)?error.code:null,lastProgress:[...String(error.stderr??'').matchAll(/Imported (\d+)\/(\d+) objects/g)].slice(-5).map(match=>({imported:Number(match[1]),total:Number(match[2])}))};await save('operation.json',operation);throw error;}
 operation.import=JSON.parse(imported.stdout);operation.importTiming={elapsedMs:Date.now()-importStartedAt,timeoutMs:importTimeoutMs};assert.equal(operation.import.verified,true);
 await f.json('DELETE','/api/cli/credentials/'+grant.id,undefined,owner);assert.equal((await f.request('GET','/api/cli/trunks/'+trunk+'/branches',undefined,{authorization:'Bearer '+grant.token})).status,401);operation.importCredentialRevoked=true;operation.revokedImportRejected=true;
 const auth={authorization:'Bearer '+runner.token},seed=await f.json('POST',base+'/ci/claim',{},auth);assert.equal(seed.run.head,anchor);
 await f.json('POST',base+'/ci/runs/'+seed.run.id,{attempt:seed.run.attempt,results:[],staging:null},auth);operation.fixtureBootstrapRunHasNoSuccess=true;
 await f.json('PUT',base+'/protection',{branch:'main',pullRequest:true,approvals:1,checks:['meld/check'],beforeOpen:['meld/check','staging'],successOnlyChecks:true,checkSources:[{name:'meld/check',runner:runner.id}],preventForce:true,preventDelete:true},owner);
 gitKey=await f.json('POST',base+'/git-tokens',{label:'Isolated native candidate push'},owner);secrets.push(gitKey.token);
 const remote=f.origin+'/git/'+trunk+'.git',transport=(...args:string[])=>exec('git',['-C',checkout,...args],{env:{...clean,GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'http.extraHeader',GIT_CONFIG_VALUE_0:'Authorization: Basic '+btoa('git:'+gitKey.token)},timeout:120000,maxBuffer:2<<20});
 await git(checkout,'checkout','-b','native-candidate');await writeFile(join(checkout,'nanohub-native-probe.txt'),'Synthetic isolation probe; application source is unchanged.\n');
 await writeFile(join(checkout,'.github/workflows/meld.yml'),'name: Untrusted replacement\non: push\njobs:\n  check:\n    runs-on: codegraff\n    steps:\n      - run: echo UNTRUSTED_MELD_WORKFLOW_MUST_NOT_RUN\n');
 await git(checkout,'add','nanohub-native-probe.txt','.github/workflows/meld.yml');await git(checkout,'commit','-m','Isolated fixture: candidate with untrusted workflow replacement');const head=await git(checkout,'rev-parse','HEAD');operation.candidate=head;
 assert.deepEqual((await git(checkout,'diff','--name-only',anchor,head)).split('\n'),['.github/workflows/meld.yml','nanohub-native-probe.txt']);await transport('push',remote,'native-candidate');
 for(const refspec of ['native-candidate:refs/heads/main','+native-candidate:refs/heads/main',':refs/heads/main'])await assert.rejects(transport('push',remote,refspec),/reviewed pull request|force|delet|default branch/i);operation.protectedMainWritesRejected=true;
 await f.json('DELETE','/api/tokens/'+gitKey.id,undefined,owner);await assert.rejects(transport('ls-remote',remote),/Authentication|401|403|denied|credential|access|terminal prompts disabled/i);operation.gitCredentialRevokedBeforeCi=true;operation.revokedGitRejected=true;
 const queued=(await f.json('GET',base+'/branches',undefined,owner)).runs.find((run:any)=>run.head===head&&run.state==='queued');assert.ok(queued);assert.equal(queued.base,anchor);operation.nativeRunId=queued.id;
 const deniedBefore=await f.request('POST',base+'/pulls',{title:'Isolated native pre-PR gate probe',head:'native-candidate'},owner);assert.equal(deniedBefore.status,400);operation.prBlockedBeforeCi=true;
 await stage('run-native-isolated-meld-suite');
 const buildArtifacts=[{job:'meld/check',directory:'/tmp/work/.nanohub-staging',maxBytes:128*1024*1024,maxFiles:10000}];
 const completed=await runOnce({origin:f.origin,trunk,backend:'codegraff',image:config.image,imageRegistry:config.imageRegistry,sandboxAccessProbeId:config.sandboxAccessProbeId,network:'none',prepare:'',artifacts:join(destination,'artifacts'),buildArtifacts,...sourcePolicy},runner.token);await save('native-callback.json',completed);assert.equal(completed.head,head);assert.equal(completed.base,anchor);assert.equal(completed.results.length,1);
 const result=completed.results[0];assert.equal(result.name,'meld/check');assert.equal(result.state,'success');assert.equal(result.execution.workflow,'.github/workflows/meld.yml');operation.nativeCompletion={id:completed.id,head,base:anchor,attempt:completed.attempt,results:completed.results};
 const logResponse=await f.request('GET',new URL(result.log).pathname,undefined,owner);assert.equal(logResponse.status,200);const log=await logResponse.text();assert.ok(!log.includes('UNTRUSTED_MELD_WORKFLOW_MUST_NOT_RUN'));for(const secret of secrets)assert.ok(!log.includes(secret));assert.equal((await f.request('GET',new URL(result.log).pathname)).status,404);operation.privateLogDelivered=true;operation.anonymousLogDenied=true;operation.logTail={bytes:Buffer.byteLength(log),sha256:hash(Buffer.from(log))};
 const receipt=JSON.parse(await readFile(join(destination,'artifacts',completed.id,String(completed.attempt),'meld-check.sandbox.json'),'utf8'));assert.equal(receipt.cleanupNeeded,false);operation.sandboxId=receipt.sandboxId;
 const staged=await loadMeldStagePackage({run:completed,results:completed.results,source:checkout,artifacts:join(destination,'artifacts',completed.id,String(completed.attempt)),buildArtifacts,toolchainImage:config.image});
 operation.stagingPackage={manifestSha256:staged.manifestSha256,profile:staged.descriptor.profile,head:staged.descriptor.head,mainModule:staged.descriptor.mainModule,moduleCount:staged.modules.length,assetFiles:staged.assets.length,bytes:[...staged.modules,...staged.assets].reduce((n,file)=>n+file.bytes,0),wrapperVerifiedAgainstCommit:true};await save('staging-package.json',operation.stagingPackage);
 const deniedAfter=await f.request('POST',base+'/pulls',{title:'Isolated native pre-PR staging gate probe',head:'native-candidate'},owner);assert.equal(deniedAfter.status,400);assert.match((await deniedAfter.json() as any).error,/staging/i);operation.prStillRequiresStaging=true;
 const view=await f.json('GET',base+'/branches',undefined,owner);assert.equal(view.branches.find((branch:any)=>branch.name==='main').commit,anchor);assert.equal(view.runs.find((run:any)=>run.id===completed.id).results[0].state,'success');
 await f.json('POST',base+'/ci/retry',{runId:completed.id},owner);const retried=(await f.json('GET',base+'/branches',undefined,owner)).runs.find((run:any)=>run.id===completed.id);assert.equal(retried.state,'queued');assert.equal(retried.results.length,0);assert.equal((await f.request('POST',base+'/ci/runs/'+completed.id,{attempt:completed.attempt,results:completed.results,staging:null},auth)).status,403);operation.retryInvalidatesOlderPass=true;operation.corePassed=true;
}catch(error){operation.failure=safe(error);operation.corePassed=false;}
finally{
 if(oldKey===undefined)delete process.env.CODEGRAFF_API_KEY;else process.env.CODEGRAFF_API_KEY=oldKey;
 if(client)await cleanup('verify allocated VM cleanup',async()=>{
  const path=join(destination,'artifacts',operation.nativeRunId??'', '1','meld-check.sandbox.json');let receipt:any;try{receipt=JSON.parse(await readFile(path,'utf8'));}catch(error:any){if(error.code==='ENOENT'&&!operation.nativeCompletion)return;throw error;}
  operation.sandboxId=receipt.sandboxId;assert.equal(receipt.cleanupNeeded,false);let state='unknown';try{state=(await client!.api('/sandboxes/'+receipt.sandboxId,undefined,'GET',20000)).state;}catch(error:any){if(error.status!==404)throw error;state='absent';}assert.ok(['destroyed','deleted','expired','absent'].includes(state));operation.providerCleanup={state,independentRead:true};
 });
 if(f&&owner&&runner)await cleanup('revoke runner',async()=>{await f!.json('DELETE',base+'/ci/'+runner.id,undefined,owner);operation.runnerRevoked=true;assert.equal((await f!.request('POST',base+'/ci/claim',{}, {authorization:'Bearer '+runner.token})).status,403);operation.revokedRunnerRejected=true;});
 if(f&&owner&&grant&&!operation.importCredentialRevoked)await cleanup('revoke import',async()=>{await f!.json('DELETE','/api/cli/credentials/'+grant.id,undefined,owner);operation.importCredentialRevoked=true;});
 if(f&&owner&&gitKey&&!operation.gitCredentialRevokedBeforeCi)await cleanup('revoke Git credential',async()=>{await f!.json('DELETE','/api/tokens/'+gitKey.id,undefined,owner);operation.gitCredentialRevoked=true;});
 if(f)await cleanup('close fixture',async()=>{await f!.close();operation.fixtureClosed=true;});
 if(beforeRefs)await cleanup('verify original source unchanged',async()=>{assert.equal(await git(source,'for-each-ref','--format=%(refname) %(objectname)'),beforeRefs);operation.originalSourceRefsUnchanged=true;});
 operation.acceptancePassed=operation.corePassed===true&&operation.cleanupErrors.length===0&&operation.runnerRevoked===true&&operation.revokedRunnerRejected===true&&operation.fixtureClosed===true&&operation.providerCleanup?.independentRead===true&&operation.originalSourceRefsUnchanged===true;
 operation.phase=operation.acceptancePassed?'finished':'failed';operation.finishedAt=new Date().toISOString();await save('operation.json',operation);
}
if(!operation.acceptancePassed)throw Error('Native Meld acceptance failed; inspect the private operation and existing VM receipts without replaying the launch');
console.log(JSON.stringify({acceptancePassed:true,candidate:operation.candidate,base:operation.acceptedWorkflowCommit,nativeRun:operation.nativeRunId,sandboxId:operation.sandboxId,cleanup:operation.providerCleanup}));
