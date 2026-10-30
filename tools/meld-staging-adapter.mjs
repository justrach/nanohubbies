/** Reuse Meld's existing private GitHub -> Codegraff -> Cloudflare pipeline.
 * GitHub staging is a transport mirror of the exact Nanohub commit, never
 * the authoritative candidate. Credentials stay in the trusted control process.
 * Requires the existing MELD_STAGING_CI_URL / PIPELINE_ADMIN_SECRET and gh auth.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, readFile, open, rename, realpath } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import {randomUUID} from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { stagingGate } from './ci-runner.mjs';
import {meldJobId,meldRuns,currentMeldJob,verifiedMeldSteps} from './meld-pipeline-state.mjs';
const exec=promisify(execFile);
const REPOSITORY='https://github.com/yourmeld/meld2.git';
export function createMeldAdapter({env=process.env,fetcher=fetch,git:gitOverride,sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now}={}) {
  const origin=new URL(env.MELD_STAGING_CI_URL||'https://meld-staging-ci.phedayatnia.workers.dev');
  if(origin.href!=='https://meld-staging-ci.phedayatnia.workers.dev/'||!env.PIPELINE_ADMIN_SECRET)throw Error('Existing Meld staging controller configuration is required');
  const dispatched=new Map();
  const api=async(path,method='GET',body)=>{
    const r=await fetcher(new URL(path,origin),{method,redirect:'error',headers:{authorization:`Bearer ${env.PIPELINE_ADMIN_SECRET}`,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30_000)});
    if(!r.ok)throw Error(`Meld staging controller returned ${r.status}`);
    const reader=r.body?.getReader();if(!reader)throw Error('Empty Meld controller response');
    let size=0;const chunks=[];try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>524288)throw Error('Meld controller response exceeded its bound');chunks.push(value);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('Invalid Meld controller JSON');}}finally{await reader.cancel().catch(()=>{});}
  };
  const git=gitOverride??(async(source,...args)=>{
    const result=await exec('git',['-C',source,'-c','credential.helper=!gh auth git-credential',...args],{
      env:{PATH:env.PATH,HOME:env.HOME,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',...(env.GH_TOKEN?{GH_TOKEN:env.GH_TOKEN}:{})},timeout:60_000,maxBuffer:2<<20,
    });return result.stdout.trim();
  });
  return {
    async dispatch(context) {
      const sha=context.run.head;
      if(!/^[a-f0-9]{40}$/.test(sha)||!/^[a-f0-9]{40}$/.test(context.run.base??'')||!/^[a-z0-9][a-z0-9-]{0,79}$/.test(context.run.id??'')||!Number.isSafeInteger(context.run.attempt)||context.run.attempt<1||!isAbsolute(context.source??'')||!isAbsolute(context.artifacts??''))throw Error('Invalid Nanohub attempt or private dispatch artifacts');
      if(await git(context.source,'rev-parse','HEAD')!==sha)throw Error('Nanohub checkout changed before staging');
      const deploy=!!context.run.deploymentApprovedBy;
      const ref=deploy?'staging':`nanohub-ci/${context.run.id}/${context.run.attempt}`;
      const source=await realpath(context.source),artifacts=await realpath(context.artifacts);
      if(artifacts===source||artifacts.startsWith(source+'/'))throw Error('Keep dispatch receipts outside candidate execution');
      const authorizationId=context.deploymentAuthorization?.id??null;
      if(authorizationId!==null&&(typeof authorizationId!=='string'||!/^[a-zA-Z0-9-]{1,100}$/.test(authorizationId)))throw Error('Invalid deployment authorization identity');
      const binding={runId:context.run.id,attempt:context.run.attempt,sha,base:context.run.base,deploy,ref,authorizationId};
      const path=join(artifacts,'meld-dispatch.json');
      const save=async value=>{const temporary=path+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(temporary,path);};
      let existing;
      try{existing=JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code!=='ENOENT')throw Error('Dispatch receipt cannot be verified');}
      if(existing){
        if(existing.format!==1||JSON.stringify(existing.binding)!==JSON.stringify(binding)||existing.state!=='acknowledged'||!meldJobId(existing.jobId))throw Error('Dispatch is unconfirmed or belongs to another attempt; inspect the private receipt without replaying it');
        dispatched.set(existing.jobId,{...binding,id:existing.jobId});return {runId:existing.jobId};
      }
      const previous=meldRuns(await api('/runs'));
      const receipt={format:1,binding,state:'pending',startedAt:now(),previousJobIds:previous.map(row=>row.id)};
      let handle;try{handle=await open(path,'wx',0o600);await handle.writeFile(JSON.stringify(receipt,null,2)+'\n');await handle.sync();}catch{throw Error('Dispatch already started or its intent cannot be retained; no operation replay');}finally{await handle?.close();}
      if(deploy) {
        await git(context.source,'fetch','--no-tags',REPOSITORY,'refs/heads/staging');
        try { await git(context.source,'merge-base','--is-ancestor','FETCH_HEAD',sha); }
        catch { throw Error('Shared staging diverged. Integrate its history into a reviewed Nanohub candidate and rerun checks'); }
      }
      // A branch run cannot gain staging authority by choosing a branch name.
      await git(context.source,'push',REPOSITORY,`${sha}:refs/heads/${ref}`);
      const job=await api(deploy?'/run':'/check','POST',deploy?undefined:{ref});
      if(!meldJobId(job.id)||job.sha!==sha||job.deploy!==deploy)throw Error('Staging or check branch moved before the controller pinned the job');
      if(previous.some(prior=>prior.id===job.id))throw Error('A new job dispatched after this Nanohub attempt and authorization is required');
      receipt.state='acknowledged';receipt.jobId=job.id;receipt.acknowledgedAt=now();await save(receipt);
      dispatched.set(job.id,{...binding,id:job.id});
      return {runId:job.id};
    },
    async wait(runId,sha,deploy=true) {
      const binding=dispatched.get(runId);
      if(!binding||binding.sha!==sha||binding.deploy!==deploy)throw Error('Wait requires this attempt\'s acknowledged dispatch receipt');
      const deadline=now()+Math.min(55*60_000,Number(env.MELD_CI_WAIT_MS)||55*60_000);
      while(now()<deadline) {
        const job=currentMeldJob(meldRuns(await api('/runs')),binding);
        if(job) {
          if(['failed','superseded'].includes(job.phase))throw Error(`Meld staging job ${job.phase}`);
          // Cleanup/reporting are still controller-owned pending work.
          if(job.phase==='passed'&&!job.pending){
            const final=currentMeldJob(meldRuns(await api('/runs')),binding);
            if(final?.phase==='passed'&&!final.pending)return {state:'success',kind:deploy?'deployment':'checks',candidate:sha,runId,steps:verifiedMeldSteps(final),verifiedAt:now()};
          }
        }
        await sleep(15_000);
      }
      throw Error('Timed out waiting for the exact Codegraff deployment job');
    },
    async accept(context) {
      if(!env.MELD_ACCEPTANCE_MODULE||!isAbsolute(env.MELD_ACCEPTANCE_MODULE))throw Error('A trusted real-service acceptance module is required; deployment success alone is insufficient');
      const module=await import(pathToFileURL(env.MELD_ACCEPTANCE_MODULE).href);
      return module.accept(context);
    },
  };
}

export async function execute(context) {
  const adapter=createMeldAdapter();
  let staged=null,jobId,pipelineEvidence;
  if(context.run.deploymentApprovedBy) {
    staged=await stagingGate(adapter,{...context,stagingOrigin:'https://staging.meld.space',versionPrefixLength:7});
    jobId=staged.runId;
    pipelineEvidence=await adapter.wait(jobId,context.run.head,true);
  } else {
    const dispatched=await adapter.dispatch(context);jobId=dispatched.runId;
    const check=await adapter.wait(jobId,context.run.head,false);
    if(check.state!=='success'||check.kind!=='checks'||check.candidate!==context.run.head)throw Error('Exact candidate checks did not succeed');
    pipelineEvidence=check;
  }
  const receipt={candidate:context.run.head,base:context.run.base,nanohubRun:context.run.id,nanohubAttempt:context.run.attempt,source:'Nanohub authenticated private clone',transportMirror:'yourmeld/meld2',runId:jobId,pipelineEvidence,staging:staged,limits:['GitHub remains the current CI transport mirror','Staging requires explicit owner approval of this head and base','Real-service acceptance is supplied by the trusted acceptance module','Independent external reruns after the final observation require callback integration; this adapter is not an unattended controller']};
  await writeFile(join(context.artifacts,'meld-pipeline.json'),JSON.stringify(receipt,null,2));
  const results=[{name:'codegraff-ci',state:'success',command:'Meld Codegraff pipeline: '+pipelineEvidence.steps.map(step=>step.name).join('; '),log:new URL('meld-pipeline.json',context.artifactOrigin).href,artifacts:[new URL('meld-pipeline.json',context.artifactOrigin).href]}];
  if(staged)results.push({name:'staging',state:'success',command:'owner-approved candidate; normal fast-forward staging mirror push; exact Codegraff deployment job; seven-character /api/version verification; real-service acceptance; version recheck',log:`https://meld-staging-ci.phedayatnia.workers.dev/runs/${staged.runId}/logs/deploy`,artifacts:staged.acceptance.map(e=>e.url)});
  return {staging:staged,results};
}
