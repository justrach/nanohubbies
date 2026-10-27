import test from 'node:test';
import assert from 'node:assert/strict';
import {runFleet,semaphore,fleetTargets} from '../../../tools/runner-pool.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const target={origin:'https://nanohub.invalid',repository:'nanohub/app'};
test('one account pool drains multiple repositories concurrently with isolated repo credentials',async()=>{
 const queues=new Map([['nanohub/app',[1,2,3,4]],['nanohub/api',[5,6,7,8]]]),seen=[],tokens=[];
 let active=0,peak=0;
 const result=await runFleet({...target,repository:undefined,concurrency:6,maxSandboxes:3,repositories:[{repository:'nanohub/app',tokenEnv:'APP_TOKEN'},{repository:'nanohub/api',tokenEnv:'API_TOKEN'}]},
 {env:{APP_TOKEN:'app-credential',API_TOKEN:'api-credential'},run:async(config,token)=>{
  tokens.push([config.repository,token]);const id=queues.get(config.repository).shift();if(!id)return{idle:true};
  active++;peak=Math.max(peak,active);await tick();seen.push(id);active--;return{id};
 }});
 assert.equal(result.completed,8);assert.ok(peak>1&&peak<=6);assert.equal(new Set(seen).size,8);
 assert.ok(tokens.every(([repo,token])=>token===(repo==='nanohub/app'?'app-credential':'api-credential')));
});
test('shared sandbox cap applies across concurrent candidate runs, permits recover after failures',async()=>{
 const limit=semaphore(3);let active=0,peak=0;
 const work=Array.from({length:50},(_,i)=>limit(async()=>{active++;peak=Math.max(peak,active);await tick();active--;if(i===5)throw Error('job failed');return i;}));
 const results=await Promise.allSettled(work);assert.equal(peak,3);assert.equal(active,0);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 assert.equal(await limit(async()=>42),42);
});
test('shutdown stops claims and drains running work before returning',async()=>{
 const stop=new AbortController();let claims=0,finished=0;
 const result=await runFleet({...target,concurrency:4},{env:{NANOHUB_CI_TOKEN:'fixture'},signal:stop.signal,watch:true,run:async()=>{claims++;if(claims===4)stop.abort();await tick();finished++;return{id:claims};}});
 assert.equal(claims,4);assert.equal(finished,4);assert.equal(result.completed,4);
});
test('idle watches sleep and resume; missing credentials and invalid pool sizes fail before any claims',async()=>{
 let calls=0,sleeps=0;const stop=new AbortController();
 await runFleet({...target,concurrency:1},{env:{NANOHUB_CI_TOKEN:'fixture'},watch:true,signal:stop.signal,run:async()=>{calls++;return{idle:true};},sleep:async()=>{sleeps++;stop.abort();}});
 assert.equal(calls,1);assert.equal(sleeps,1);
 assert.throws(()=>fleetTargets(target,{}),/credential/);
 await assert.rejects(runFleet({...target,concurrency:0},{env:{NANOHUB_CI_TOKEN:'fixture'},run:async()=>{throw Error('must not claim');}}),/positive/);
 assert.throws(()=>fleetTargets({...target,repository:undefined,repositories:[{repository:'nanohub/app'},{repository:'nanohub/app'}]},{NANOHUB_CI_TOKEN:'fixture'}),/Duplicate/);
});

test('private runner files are resolved before any claim and never fall back to ambient credentials',async()=>{
 const {mkdtemp,writeFile,rm,chmod}=await import('node:fs/promises'),{join}=await import('node:path'),{tmpdir}=await import('node:os'),{randomUUID}=await import('node:crypto'),{resolveFleetTargets}=await import('../../../tools/runner-pool.mjs');
 const dir=await mkdtemp(join(tmpdir(),'nh-pool-credential-'));try{
  const file=join(dir,'runner.json'),credential={format:1,origin:target.origin,repository:target.repository,trunk:null,id:randomUUID(),name:'pool',token:'nhci_'+'e'.repeat(64)};await writeFile(file,JSON.stringify(credential),{mode:0o600});
  let claims=0;const config={...target,runnerCredentialFile:file,concurrency:1};const resolved=await resolveFleetTargets(config,{NANOHUB_CI_TOKEN:'wrong-ambient-credential'});assert.equal(resolved[0].token,credential.token);
  await runFleet(config,{env:{NANOHUB_CI_TOKEN:'wrong-ambient-credential'},run:async(config,token)=>{claims++;assert.equal(token,credential.token);assert.equal(config.runnerCredentialFile,file);return {idle:true};}});assert.equal(claims,1);
  assert.throws(()=>fleetTargets({...config,tokenEnv:'OTHER'},{}),/one absolute/);assert.throws(()=>fleetTargets({...config,runnerCredentialFile:'relative.json'},{}),/absolute/);
  await chmod(file,0o644);await assert.rejects(runFleet(config,{env:{NANOHUB_CI_TOKEN:'wrong-ambient-credential'},run:async()=>{claims++;}}),/private runner/);assert.equal(claims,1);
  await chmod(file,0o600);await writeFile(file,JSON.stringify({...credential,repository:'other/repo'}));await assert.rejects(runFleet(config,{env:{},run:async()=>{claims++;}}),/private runner/);assert.equal(claims,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
