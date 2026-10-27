/** Trusted host scheduling only. One pool may service several repositories
 * using the same Codegraff account, with separate Nanohub repo credentials. */
import {isAbsolute} from 'node:path';
import {readRunnerCredentialFile} from '../packages/cli/src/runners.mjs';
export function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw Error(`${name} must be a positive safe integer`);
  return value;
}
export function semaphore(capacity) {
  positiveInteger(capacity,'Sandbox concurrency');
  let active=0;const waiting=[];
  return async function limited(work) {
    await new Promise(resolve=>{if(active<capacity){active++;resolve();}else waiting.push(resolve);});
    try{return await work();}finally{const next=waiting.shift();if(next)next();else active--;}
  };
}
export function fleetTargets(config, env) {
  const {repositories,...common}=config;
  const entries=repositories??[{}];
  if(!Array.isArray(entries)||!entries.length)throw Error('Configure at least one repository');
  if(repositories && (common.repository||common.trunk))throw Error('Choose repositories or a single repository');
  const seen=new Set();
  return entries.map(entry=>{
    if(!entry||typeof entry!=='object'||Array.isArray(entry))throw Error('Invalid repository configuration');
    const target={...common,...entry};
    if(!target.repository&&!target.trunk)throw Error('Each pool target needs a repository or trunk');
    const key=new URL(target.origin).origin+'/'+(target.repository??target.trunk);
    if(seen.has(key))throw Error('Duplicate repository in runner pool');seen.add(key);
    if(target.runnerCredentialFile!==undefined){
      if(typeof target.runnerCredentialFile!=='string'||!isAbsolute(target.runnerCredentialFile)||target.tokenEnv!==undefined)throw Error('Use one absolute private runnerCredentialFile or tokenEnv per repository');
      return {config:target,tokenFile:target.runnerCredentialFile};
    }
    const tokenEnv=target.tokenEnv??'NANOHUB_CI_TOKEN';
    if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tokenEnv)||!env[tokenEnv])throw Error(`Configure the repository runner credential in ${tokenEnv}`);
    return {config:target,token:env[tokenEnv]};
  });
}
export async function resolveFleetTargets(config,env,{readCredentialFile=readRunnerCredentialFile}={}){
  const targets=fleetTargets(config,env);
  return Promise.all(targets.map(async target=>{
    if(!target.tokenFile)return target;
    const {config,tokenFile}=target;
    const credential=await readCredentialFile(tokenFile,{origin:new URL(config.origin).origin,repository:config.repository??null,trunk:config.trunk??null});
    return {config,token:credential.token};
  }));
}
const pause=(ms,signal)=>new Promise(resolve=>{
  if(signal?.aborted)return resolve();
  const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',done);resolve();};
  const timer=setTimeout(done,ms);signal?.addEventListener('abort',done,{once:true});
});
/** Each worker drains queues round-robin. Independent processes may share
 * registrations: the server's atomic lease is the authority, never this loop. */
export async function runFleet(config,{run,env=process.env,watch=false,signal,onResult=()=>{},onError=()=>{},sleep=pause}={}) {
  if(typeof run!=='function')throw Error('A runner implementation is required');
  const targets=await resolveFleetTargets(config,env),concurrency=positiveInteger(config.concurrency??(config.pipelineAdapter?1:4),'Run concurrency');
  const sandboxLimit=semaphore(positiveInteger(config.maxSandboxes??concurrency,'Maximum sandboxes'));
  positiveInteger(config.jobConcurrency??4,'Job concurrency');
  const interval=positiveInteger(config.pollIntervalMs??5000,'Poll interval');
  let cursor=0,completed=0;
  async function worker(){
    let idle=0;
    while(!signal?.aborted){
      const target=targets[cursor++%targets.length];
      try {
        const result=await run(target.config,target.token,{sandboxLimit});
        if(result.idle)idle++;else{idle=0;completed++;await onResult(result,target.config);}
      } catch(error){
        await onError(error,target.config);
        if(!watch)throw error;
        idle++;
      }
      if(idle>=targets.length){if(!watch)return;await sleep(interval,signal);idle=0;}
    }
  }
  // Drain in-flight work on shutdown/error so disposable VMs reach cleanup.
  const workers=Array.from({length:concurrency},()=>worker());
  const settled=await Promise.allSettled(workers);
  const failed=settled.find(r=>r.status==='rejected');
  if(failed)throw failed.reason;
  return {completed};
}
