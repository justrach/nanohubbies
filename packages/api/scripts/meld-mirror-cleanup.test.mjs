import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {retireMeldMirror} from '../../../tools/meld-mirror-cleanup.mjs';
import {meldRepository} from '../../../tools/meld-pipeline-state.mjs';
const exec=promisify(execFile),jobId='1700000000000-11111111-1111-4111-8111-111111111111';

async function fixture(work){
 const dir=await mkdtemp(join(tmpdir(),'nh-meld-cleanup-')),source=join(dir,'source'),remote=join(dir,'remote.git'),artifacts=join(dir,'artifacts');await mkdir(source);await mkdir(artifacts);
 const env={PATH:process.env.PATH,HOME:dir,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'};
 const run=async(cwd,...args)=>(await exec('git',['-C',cwd,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args],{env,timeout:10000})).stdout.trim();
 try{
  await run(source,'init','--initial-branch=main');await run(source,'commit','--allow-empty','-m','first');await run(dir,'init','--bare',remote);
  const sha=await run(source,'rev-parse','HEAD'),binding={runId:'cleanup-event',attempt:1,sha,base:sha,deploy:false,ref:'nanohub-ci/cleanup-event/1',authorizationId:null},ref='refs/heads/'+binding.ref;
  await run(source,'push',remote,sha+':'+ref);
  await writeFile(join(artifacts,'meld-dispatch.json'),JSON.stringify({format:1,binding,state:'acknowledged',jobId}));
  const state={pushes:0,reads:0,observations:0,beforePush:null,afterPush:null,beforeRead:null,rows:[{id:jobId,sha,deploy:false,ref:binding.ref,phase:'passed',pending:false}]};
  const git=async(cwd,command,...args)=>{
   if(command==='push'){state.pushes++;await state.beforePush?.();}
   if(command==='ls-remote'){state.reads++;await state.beforeRead?.();}
   const result=await run(cwd,command,...args.map(value=>value===meldRepository?remote:value));
   if(command==='push')await state.afterPush?.();
   return result;
  };
  const options={binding,jobId,source,artifacts,git,observe:async()=>{state.observations++;return state.rows;}};
  const retire=(updates={})=>retireMeldMirror({...options,...updates});
  const current=()=>run(source,'ls-remote','--refs',remote,ref);
  const move=async()=>{await run(source,'commit','--allow-empty','-m','next');const next=await run(source,'rev-parse','HEAD');await run(source,'push',remote,next+':'+ref);return next;};
  await work({dir,source,remote,artifacts,sha,binding,ref,state,run,git,retire,current,move,options});
 }finally{await rm(dir,{recursive:true,force:true});}
}

test('real Git cleanup uses its retained checkout and an exact lease, with a private durable receipt',async()=>fixture(async f=>{
 const result=await f.retire();assert.equal(result.removed,true);assert.equal(await f.current(),'');assert.equal(f.state.pushes,1);
 const path=join(f.artifacts,'meld-mirror-cleanup.json'),receipt=JSON.parse(await readFile(path,'utf8'));assert.equal(receipt.state,'removed');assert.equal(receipt.identity.jobId,jobId);assert.equal((await stat(path)).mode&0o777,0o600);
 assert.equal((await f.retire()).removed,true);assert.equal(f.state.pushes,1);
}));
test('a changed ref is preserved, including a race after the initial ls-remote',async()=>{
 await fixture(async f=>{const next=await f.move();await f.run(f.source,'checkout','--detach',f.sha);await assert.rejects(f.retire(),/mirror changed/);assert.ok((await f.current()).startsWith(next));assert.equal(f.state.pushes,0);});
 await fixture(async f=>{let next;f.state.beforePush=async()=>{next=await f.move();};await assert.rejects(f.retire(),/unconfirmed/);assert.ok((await f.current()).startsWith(next));assert.equal(f.state.pushes,1);});
});
test('a lost successful deletion acknowledgement reconciles absence without another push',async()=>fixture(async f=>{
 f.state.afterPush=async()=>{throw Error('private lost reply');};const result=await f.retire();assert.equal(result.reconciled,true);assert.equal(await f.current(),'');await f.retire();assert.equal(f.state.pushes,1);
 assert.equal((await readFile(join(f.artifacts,'meld-mirror-cleanup.json'),'utf8')).includes('private lost reply'),false);
}));
test('an unknown deletion outcome with the ref still present is never automatically replayed',async()=>fixture(async f=>{
 f.state.beforePush=async()=>{throw Error('unknown transport outcome');};await assert.rejects(f.retire(),/unconfirmed/);f.state.beforePush=null;await assert.rejects(f.retire(),/unconfirmed/);assert.equal(f.state.pushes,1);assert.ok((await f.current()).startsWith(f.sha));
}));
test('a failed final read can recover through a new absence observation, without a second mutation',async()=>fixture(async f=>{
 f.state.beforeRead=async()=>{if(f.state.pushes)throw Error('read unavailable');};await assert.rejects(f.retire(),/unconfirmed/);assert.equal(await f.current(),'');f.state.beforeRead=null;assert.equal((await f.retire()).reconciled,true);assert.equal(f.state.pushes,1);
}));
test('active, queued, reporting and unverified jobs cannot release a mirror still in use',async()=>{
 for(const update of [{pending:true},{phase:'queued'},{phase:'reporting'},{sha:'a'.repeat(40)},{ref:'foreign'}])await fixture(async f=>{Object.assign(f.state.rows[0],update);await assert.rejects(f.retire(),/still in use/);assert.equal(f.state.pushes,0);});
 await fixture(async f=>{f.state.rows.push({...f.state.rows[0],id:'other',pending:true});await assert.rejects(f.retire(),/still in use/);assert.equal(f.state.pushes,0);});
});
test('terminal failed and superseded jobs can retire only their own inactive ref',async()=>{
 for(const phase of ['failed','superseded'])await fixture(async f=>{f.state.rows[0].phase=phase;await f.retire();assert.equal(await f.current(),'');});
});
test('a job becoming active during cleanup is caught before Git deletion',async()=>fixture(async f=>{
 f.options.observe=async()=>{if(++f.state.observations===2)f.state.rows[0].pending=true;return f.state.rows;};await assert.rejects(f.retire(),/still in use/);assert.equal(f.state.pushes,0);assert.ok((await f.current()).startsWith(f.sha));
}));
test('concurrent cleanup calls have at most one mutation owner',async()=>fixture(async f=>{
 const results=await Promise.allSettled([f.retire(),f.retire()]);assert.ok(results.some(x=>x.status==='fulfilled'));assert.equal(f.state.pushes,1);assert.equal(await f.current(),'');
}));
test('a completed receipt never authorizes deleting a recreated ref',async()=>fixture(async f=>{
 await f.retire();await f.run(f.source,'push',f.remote,f.sha+':'+f.ref);await assert.rejects(f.retire(),/unconfirmed/);assert.equal(f.state.pushes,1);assert.ok((await f.current()).startsWith(f.sha));
}));
test('shared staging, foreign bindings, missing acknowledgements and candidate-local receipts fail closed',async()=>fixture(async f=>{
 for(const binding of [{...f.binding,deploy:true,ref:'staging'},{...f.binding,ref:'main'},{...f.binding,attempt:2,ref:'nanohub-ci/cleanup-event/2'}])await assert.rejects(f.retire({binding}));
 const local=join(f.source,'artifacts');await mkdir(local);await assert.rejects(f.retire({artifacts:local}),/outside candidate/);
 await writeFile(join(f.artifacts,'meld-dispatch.json'),JSON.stringify({format:1,binding:f.binding,state:'pending',jobId}));await assert.rejects(f.retire(),/acknowledged dispatch/);assert.equal(f.state.pushes,0);
}));
test('malformed cleanup receipts and changed source cannot trigger deletion',async()=>fixture(async f=>{
 await writeFile(join(f.artifacts,'meld-mirror-cleanup.json'),'not JSON');await assert.rejects(f.retire(),/cannot be verified/);await rm(join(f.artifacts,'meld-mirror-cleanup.json'));await f.run(f.source,'commit','--allow-empty','-m','changed checkout');await assert.rejects(f.retire(),/checkout changed/);assert.equal(f.state.pushes,0);
}));
