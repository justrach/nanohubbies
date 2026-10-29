/** Trusted control process. Candidate code runs only in a disposable container.
 * Configuration and adapter live OUTSIDE the candidate checkout. CI/deploy
 * secrets stay in this process or the external staging pipeline's secret store.
 * NANOHUB_CI_TOKEN=... node tools/ci-runner.mjs /etc/nanohub/meld.json
 */
import { spawn } from 'node:child_process';
import {sourceRef} from './ci-ref.mjs';
import {passingCheck} from '../packages/api/src/ci/conclusions.ts';
import { mkdtemp, readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import {toolchain} from './toolchain.mjs';
import { runFleet } from './runner-pool.mjs';
import { verifySandboxAccess } from './sandbox-access.mjs';
import {sandboxCapacity} from './sandbox-capacity.mjs';

export function runProcess(command, args, options={}) {
  return new Promise((resolve,reject)=>{
    const { timeoutMs=20*60_000, ...spawnOptions } = options;
    const child=spawn(command,args,{...spawnOptions,stdio:['ignore','pipe','pipe']});
    const timer=setTimeout(()=>child.kill('SIGTERM'),timeoutMs);
    let output=''; const collect=bytes=>{output+=bytes.toString();if(output.length>2<<20)output=output.slice(-(2<<20));};
    child.stdout.on('data',collect);child.stderr.on('data',collect);
    child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('close',code=>{clearTimeout(timer);resolve({code,output});});
  });
}
export async function verifyVersion(origin, candidate, fetcher=fetch, prefixLength=40) {
  const response=await fetcher(new URL('/api/version',origin),{headers:{'Cache-Control':'no-cache'},cache:'no-store',signal:AbortSignal.timeout(20_000)});
  if(!response.ok)throw Error(`Staging version endpoint failed: ${response.status}`);
  const body=await response.json();
  const version=body.buildId ?? body.build_id ?? body.sha;
  if(!Number.isInteger(prefixLength)||prefixLength<7||prefixLength>40)throw Error('Invalid version ID prefix length');
  if(version!==candidate.slice(0,prefixLength))throw Error(`Staging moved or version mismatch: expected ${candidate}, got ${version}`);
  return candidate;
}
export async function stagingGate(adapter, context, fetcher=fetch) {
  // dispatch/wait/accept are trusted fleet adapters, not candidate code.
  const dispatch=await adapter.dispatch({...context,idempotencyKey:context.deploymentAuthorization?.id??context.run.id});
  if(!dispatch?.runId)throw Error('Staging adapter did not return a deployment run ID');
  const deployed=await adapter.wait(dispatch.runId,context.run.head);
  if(deployed?.state!=='success'||deployed?.candidate!==context.run.head||deployed?.kind!=='deployment')throw Error('Exact candidate deployment job did not succeed');
  await verifyVersion(context.stagingOrigin,context.run.head,fetcher,context.versionPrefixLength??40);
  const acceptance=await adapter.accept({...context,deployRunId:dispatch.runId});
  if(!Array.isArray(acceptance)||!acceptance.length||acceptance.some(e=>e.realService!==true||!e.url))throw Error('Real-service acceptance evidence is required');
  // Shared staging can move during acceptance. Check again when collecting it.
  const version=await verifyVersion(context.stagingOrigin,context.run.head,fetcher,context.versionPrefixLength??40);
  return {runId:dispatch.runId,head:context.run.head,candidate:context.run.head,base:context.run.base,version,observedBuildId:context.run.head.slice(0,context.versionPrefixLength??40),verifiedAt:Date.now(),acceptance};
}
/** Ask the server before invoking any trusted deployment adapter. Waiting
 * persists successful checks and relinquishes both the CI and Git read lease. */
export async function authorizeEnvironment(api, run, environment, results, {optional=false, beforeDefer=async()=>{}}={}) {
  const request=await api('/deployments/request',{runId:run.id,attempt:run.attempt,environment,optional});
  if(request.configured===false)return {authorization:null,waiting:false};
  if(request.state==='waiting') {
    await beforeDefer();
    const deferred=await api('/deployments/defer',{requestId:request.id,attempt:run.attempt,results});
    if(!deferred.ready)return {waiting:true,request:request.id};
  } else if(!['ready','running'].includes(request.state))throw Error(request.reason||'Deployment request is unavailable');
  return {waiting:false,authorization:await api('/deployments/authorize',{requestId:request.id,attempt:run.attempt})};
}
export async function runOnce(config, token, {sandboxLimit}={}) {
  if(!config.backend && !config.pipelineAdapter)config={...config,backend:'codegraff'};
  const origin=new URL(config.origin);
  if(origin.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(origin.hostname))throw Error('HTTPS required');
  if((config.repository ? !/^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9][a-z0-9._-]{0,99}$/.test(config.repository) : !/^[a-z0-9][a-z0-9-]{0,62}$/.test(config.trunk)))throw Error('Use a valid workspace and a trusted toolchain image pinned by SHA-256 digest');
  if(config.backend && !['codegraff','docker'].includes(config.backend))throw Error('Unknown CI backend');
  if(config.imageSnapshot!==undefined&&config.backend!=='codegraff')throw Error('Toolchain snapshots require the Codegraff backend');
  if(config.imageArchive!==undefined&&config.backend!=='codegraff')throw Error('Toolchain image archives require the Codegraff backend');
  if(config.imageDownload!==undefined&&config.backend!=='codegraff')throw Error('Toolchain archive downloads require the Codegraff backend');
  if(config.imageRegistry!==undefined&&config.backend!=='codegraff')throw Error('Private registry toolchains require the Codegraff backend');
  if(!config.pipelineAdapter||config.backend==='codegraff')toolchain(config.image,config.imageSnapshot,config.imageArchive,config.imageDownload,config.imageRegistry);
  if(typeof config.artifacts!=='string'||!isAbsolute(config.artifacts))throw Error('Use an absolute private artifacts directory');
  if(config.backend==='codegraff'&&!process.env.CODEGRAFF_API_KEY)throw Error('Configure the Nanohub account CODEGRAFF_API_KEY before claiming cloud jobs');
  const base=config.repository ? `${origin.origin}/api/repos/${config.repository}/ci` : `${origin.origin}/api/trunks/${config.trunk}/ci`;
  async function api(path,body) {
    const response=await fetch(base+path,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error(`CI request failed (${response.status}): ${await response.text()}`);
    return response.json();
  }
  if(config.stagingEnvironment!==undefined&&(typeof config.stagingEnvironment!=="string"||!config.stagingEnvironment||config.stagingEnvironment.length>255||config.stagingEnvironment!==config.stagingEnvironment.trim()||/[\x00-\x1f\x7f]/.test(config.stagingEnvironment)))throw Error("Use a configured staging environment name");
  if(config.backend==='codegraff') {
    await verifySandboxAccess(process.env.CODEGRAFF_API_KEY);
    const capacity=await api('/capacity/status',{});
    if(capacity.sharedReservations!=='v1')throw Error('Shared sandbox capacity is unavailable; no CI job was claimed');
  }
  const claimed=await api('/claim',{});if(!claimed.run)return {idle:true};
  const run=claimed.run,dir=await mkdtemp(join(tmpdir(),'nanohub-ci-')),source=join(dir,'source');
  const artifacts=join(config.artifacts,run.id,`${run.attempt}`);await mkdir(artifacts,{recursive:true});
  const publicUrl=config.backend==='codegraff' ? `${base.slice(0,-3)}/action-logs/${run.id}/${run.attempt}/` : new URL(`${run.id}/${run.attempt}/`,config.artifactOrigin.endsWith('/')?config.artifactOrigin:config.artifactOrigin+'/').href;
  const resumedChecks=!!run.environmentWait&&run.results.length>0;
  const results=resumedChecks?[...run.results]:[];let staging=null,deployments=[],authorization=null;
  async function uploadLogs() {
    if(config.backend!=='codegraff')return;
    for(const file of (await readdir(artifacts)).filter(f=>/^[a-zA-Z0-9_.-]{1,220}\.log$/.test(f))) {
      const content=Buffer.from(await readFile(join(artifacts,file))).subarray(-(1024*1024-4)).toString('utf8');
      await api(`/logs/${run.id}`,{attempt:run.attempt,name:file,content});
    }
  }
  const authorize=()=>authorizeEnvironment(api,run,config.stagingEnvironment??'staging',results,{optional:!config.stagingEnvironment,beforeDefer:uploadLogs});
  try {
    // Combined adapters may deploy during execute(), so authorize before they
    // run. A deferred combined pipeline has no checks to reuse on resumption.
    if(config.pipelineAdapter&&config.backend!=='codegraff'&&run.deploymentApprovedBy) {
      const gate=await authorize();if(gate.waiting)return gate;authorization=gate.authorization;
    }
    const cleanEnv={PATH:process.env.PATH,HOME:dir,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'};
    const clone=await runProcess('git',['clone','--no-checkout',claimed.cloneUrl,source],{env:{...cleanEnv,GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'http.extraHeader',GIT_CONFIG_VALUE_0:`Authorization: Bearer ${run.readToken}`}});
    if(clone.code)throw Error('Private candidate clone failed');
    const git=async(...args)=>{const result=await runProcess('git',['-C',source,...args],{env:cleanEnv});if(result.code)throw Error(`Candidate verification failed: git ${args[0]}`);return result.output.trim();};
    // The accepted default supplies workflow definitions. The candidate may
    // target another branch; final merge independently checks target ancestry.
    await git('checkout','--detach',run.head);
    if(await git('rev-parse','HEAD')!==run.head)throw Error('Wrong checkout SHA');
    if(config.backend==='codegraff'&&!resumedChecks) {
      const {executeActions}=await import('./codegraff-actions.mjs');
      const active=async()=>{
        const response=await fetch(claimed.cloneUrl+'/HEAD',{headers:{Authorization:`Bearer ${run.readToken}`},signal:AbortSignal.timeout(20000),redirect:'error'});
        return response.ok;
      };
      const capacity=sandboxCapacity(api,run,artifacts,{active});
      const result=await executeActions({run,source,artifacts,artifactOrigin:publicUrl,active},config,{sandboxLimit,capacity});
      results.push(...result.results);
    }
    if(config.pipelineAdapter && config.backend!=='codegraff') {
      if(!isAbsolute(config.pipelineAdapter))throw Error('Pipeline adapter must be a trusted absolute path');
      const adapter=await import(pathToFileURL(config.pipelineAdapter).href);
      const result=await adapter.execute({run,source,stagingOrigin:config.stagingOrigin,artifacts,artifactOrigin:publicUrl,deploymentAuthorization:authorization});
      results.push(...result.results);staging=result.staging;deployments=result.deployments??[];if(!Array.isArray(deployments)||deployments.length>30)throw Error("Trusted adapter returned invalid deployment reports");
    }
    for(const check of resumedChecks||config.pipelineAdapter||config.backend==='codegraff'?[]:config.checks) {
      if(!/^[\w.-]{1,100}$/.test(check.name)||typeof check.command!=='string')throw Error('Invalid trusted check configuration');
      const container=`nanohub-${run.id}-${run.attempt}-${check.name}`;
      const remaining=run.leaseUntil-Date.now()-30_000;
      if(remaining<=0)throw Error('CI lease exhausted before check execution');
      const result=await runProcess('docker',['run','--rm','--name',container,'--cap-drop=ALL','--security-opt=no-new-privileges','--network=none','--memory=4g','--cpus=2','--pids-limit=256','--user=1000:1000','--tmpfs','/tmp:rw,exec,size=2g','-v',`${source}:/source:ro`,config.image,'sh','-lc',`cp -R /source /tmp/work && rm -rf /tmp/work/.git && cd /tmp/work && ${config.prepare ? config.prepare + ' && ' : ''}${check.command}`],{env:{PATH:process.env.PATH,HOME:process.env.HOME},timeoutMs:Math.min(10*60_000,remaining)});
      await runProcess('docker',['rm','--force',container],{env:{PATH:process.env.PATH,HOME:process.env.HOME},timeoutMs:30_000});
      await writeFile(join(artifacts,`${check.name}.log`),result.output);
      results.push({name:check.name,state:result.code===0?'success':'failure',command:[config.prepare,check.command].filter(Boolean).join(' && '),log:new URL(`${check.name}.log`,publicUrl).href,artifacts:[]});
      if(result.code!==0)break;
    }
    if(run.deploymentApprovedBy&&!config.pipelineAdapter&&(config.backend==='codegraff'||results.length===config.checks.length)&&results.length>0&&results.every(passingCheck)&&config.stagingAdapter) {
      if(!isAbsolute(config.stagingAdapter))throw Error('Staging adapter must be an absolute trusted file outside the candidate');
      const adapter=await import(pathToFileURL(config.stagingAdapter).href);
      const gate=await authorize();if(gate.waiting)return gate;authorization=gate.authorization;
      try {
        staging=await stagingGate(adapter,{run,source,deploymentAuthorization:authorization,stagingOrigin:config.stagingOrigin,artifacts,artifactOrigin:publicUrl});
        await writeFile(join(artifacts,'staging.log'),JSON.stringify(staging,null,2));
        results.push({name:'staging',state:'success',command:'approved staging pipeline; exact deployment job, version, real-service acceptance, version recheck',log:new URL('staging.log',publicUrl).href,artifacts:staging.acceptance.map(e=>e.url)});
      } catch(error) {
        await writeFile(join(artifacts,'staging.log'),String(error));
        results.push({name:'staging',state:'failure',command:'approved staging pipeline and real-service acceptance',log:new URL('staging.log',publicUrl).href,artifacts:[]});
      }
    }
    if(authorization)deployments=deployments.map(report=>report.environment.toLowerCase()===(config.stagingEnvironment??'staging').toLowerCase()?{...report,authorizationId:authorization.id,verifiedAt:Math.max(report.verifiedAt,authorization.issuedAt)}:report);
    if(staging&&authorization&&!deployments.some(report=>report.environment.toLowerCase()===(config.stagingEnvironment??'staging').toLowerCase()))deployments.push({environment:config.stagingEnvironment??'staging',head:run.head,base:run.base,state:'success',deploymentId:staging.runId,url:staging.acceptance[0].url,verifiedAt:Math.max(staging.verifiedAt,authorization.issuedAt),authorizationId:authorization.id});
    else if(staging&&config.stagingEnvironment&&!authorization&&!deployments.length)throw Error('Configured deployment environment did not issue authorization');
  } catch(error) {
    await writeFile(join(artifacts,'runner.log'),String(error));
    results.push({name:'runner',state:'failure',command:'clone, checkout and verify candidate ancestry',log:new URL('runner.log',publicUrl).href,artifacts:[]});
  } finally { await rm(dir,{recursive:true,force:true}); }
  const completion={attempt:run.attempt,results,staging,...(deployments.length?{deployments}:{})};
  await writeFile(join(artifacts,'completion.json'),JSON.stringify(completion,null,2));
  await uploadLogs();
  // Completion is already persisted for exact idempotent callback retries.
  let last;
  for(let n=0;n<3;n++){try{return await api(`/runs/${run.id}`,completion);}catch(error){last=error;}}
  throw last;
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href) {
  if(!process.argv[2])throw Error('Provide the trusted runner config path and repository credential environment variables');
  const config=JSON.parse(await readFile(process.argv[2],'utf8'));
  const stopping=new AbortController();
  const stop=()=>stopping.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try {
    await runFleet(config,{run:runOnce,watch:process.argv.includes('--watch'),signal:stopping.signal,
      onResult:result=>console.log(JSON.stringify(result,null,2)),onError:error=>console.error(String(error))});
  }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
