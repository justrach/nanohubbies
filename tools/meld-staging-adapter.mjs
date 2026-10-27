/** Reuse Meld's existing private GitHub -> Codegraff -> Cloudflare pipeline.
 * GitHub staging is a transport mirror of the exact Nanohub commit, never
 * the authoritative candidate. Credentials stay in the trusted control process.
 * Requires the existing MELD_STAGING_CI_URL / PIPELINE_ADMIN_SECRET and gh auth.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stagingGate } from './ci-runner.mjs';
const exec=promisify(execFile);
const REPOSITORY='https://github.com/yourmeld/meld2.git';
export function createMeldAdapter({env=process.env,fetcher=fetch,git:gitOverride,sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now}={}) {
  const origin=new URL(env.MELD_STAGING_CI_URL||'https://meld-staging-ci.phedayatnia.workers.dev');
  if(origin.protocol!=='https:'||origin.hostname!=='meld-staging-ci.phedayatnia.workers.dev'||!env.PIPELINE_ADMIN_SECRET)throw Error('Existing Meld staging controller configuration is required');
  const api=async(path,method='GET',body)=>{
    const r=await fetcher(new URL(path,origin),{method,headers:{authorization:`Bearer ${env.PIPELINE_ADMIN_SECRET}`,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30_000)});
    if(!r.ok)throw Error(`Meld staging controller returned ${r.status}`);
    return r.json();
  };
  const git=gitOverride??(async(source,...args)=>{
    const result=await exec('git',['-C',source,'-c','credential.helper=!gh auth git-credential',...args],{
      env:{PATH:env.PATH,HOME:env.HOME,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',...(env.GH_TOKEN?{GH_TOKEN:env.GH_TOKEN}:{})},timeout:60_000,maxBuffer:2<<20,
    });return result.stdout.trim();
  });
  return {
    async dispatch(context) {
      const sha=context.run.head;
      if(!/^[a-f0-9]{40}$/.test(sha))throw Error('Invalid Nanohub candidate');
      if(await git(context.source,'rev-parse','HEAD')!==sha)throw Error('Nanohub checkout changed before staging');
      const deploy=!!context.run.deploymentApprovedBy;
      const ref=deploy?'staging':`nanohub-ci/${context.run.id}`;
      if(deploy) {
        await git(context.source,'fetch','--no-tags',REPOSITORY,'refs/heads/staging');
        try { await git(context.source,'merge-base','--is-ancestor','FETCH_HEAD',sha); }
        catch { throw Error('Shared staging diverged. Integrate its history into a reviewed Nanohub candidate and rerun checks'); }
      }
      // A branch run cannot gain staging authority by choosing a branch name.
      await git(context.source,'push',REPOSITORY,`${sha}:refs/heads/${ref}`);
      const snapshot=await api('/runs');
      const previous=[snapshot.active,...(snapshot.queued??[]),...(snapshot.runs??[])].filter(Boolean);
      const existing=context.deploymentAuthorization?undefined:previous.find(r=>r&&r.sha===sha&&r.deploy===deploy&&!['failed','superseded'].includes(r.phase));
      const job=existing??await api(deploy?'/run':'/check','POST',deploy?undefined:{ref});
      if(context.deploymentAuthorization&&previous.some(prior=>prior.id===job.id))throw Error('Protected deployment requires a new job dispatched after environment authorization');
      if(!job.id||job.sha!==sha||job.deploy!==deploy)throw Error('Staging or check branch moved before the controller pinned the job');
      return {runId:job.id};
    },
    async wait(runId,sha,deploy=true) {
      const deadline=now()+Math.min(55*60_000,Number(env.MELD_CI_WAIT_MS)||55*60_000);
      while(now()<deadline) {
        const snapshot=await api('/runs');
        const active=snapshot.active?.id===runId?snapshot.active:null;
        const job=active??snapshot.runs?.find(r=>r.id===runId)??snapshot.queued?.find(r=>r.id===runId);
        if(job) {
          if(job.sha!==sha||job.deploy!==deploy)throw Error('Unrelated or checks-only deployment result');
          if(['failed','superseded'].includes(job.phase))throw Error(`Meld staging job ${job.phase}`);
          // Cleanup/reporting are still controller-owned pending work.
          if(job.phase==='passed'&&!active)return {state:'success',kind:deploy?'deployment':'checks',candidate:sha,steps:job.steps??[]};
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
  let staged=null,jobId;
  if(context.run.deploymentApprovedBy) {
    staged=await stagingGate(adapter,{...context,stagingOrigin:'https://staging.meld.space',versionPrefixLength:7});
    jobId=staged.runId;
  } else {
    const dispatched=await adapter.dispatch(context);jobId=dispatched.runId;
    const check=await adapter.wait(jobId,context.run.head,false);
    if(check.state!=='success'||check.kind!=='checks'||check.candidate!==context.run.head)throw Error('Exact candidate checks did not succeed');
  }
  const receipt={candidate:context.run.head,base:context.run.base,source:'Nanohub authenticated private clone',transportMirror:'yourmeld/meld2',runId:jobId,staging:staged,limits:['GitHub remains the current CI transport mirror','Staging requires explicit owner approval of this head and base','Real-service acceptance is supplied by the trusted acceptance module']};
  await writeFile(join(context.artifacts,'meld-pipeline.json'),JSON.stringify(receipt,null,2));
  const results=[{name:'codegraff-ci',state:'success',command:'Meld Codegraff pipeline: frozen Bun 1.4.2 install; pipeline regression tests; bun run check (tsrs); bun run test; apps/web e2e; OpenNext production bundle',log:new URL('meld-pipeline.json',context.artifactOrigin).href,artifacts:[new URL('meld-pipeline.json',context.artifactOrigin).href]}];
  if(staged)results.push({name:'staging',state:'success',command:'owner-approved candidate; normal fast-forward staging mirror push; exact Codegraff deployment job; seven-character /api/version verification; real-service acceptance; version recheck',log:`https://meld-staging-ci.phedayatnia.workers.dev/runs/${staged.runId}/logs/deploy`,artifacts:staged.acceptance.map(e=>e.url)});
  return {staging:staged,results};
}
