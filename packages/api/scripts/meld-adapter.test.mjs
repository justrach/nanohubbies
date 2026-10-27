import test from 'node:test';
import assert from 'node:assert/strict';
import { createMeldAdapter } from '../../../tools/meld-staging-adapter.mjs';
import { stagingGate } from '../../../tools/ci-runner.mjs';
const head='a'.repeat(40),base='b'.repeat(40);
const env={PIPELINE_ADMIN_SECRET:'fixture',MELD_CI_WAIT_MS:'100'};
const context={source:'/fixture',run:{id:'event-1',head,base,deploymentApprovedBy:'owner'},stagingOrigin:'https://staging.meld.space',versionPrefixLength:7};
function fixture({diverge=false,wrong=false}={}) {
  const calls=[];
  const git=async(source,...args)=>{calls.push(args);if(args[0]==='rev-parse')return head;if(diverge&&args[0]==='merge-base')throw Error('diverged');return '';};
  const fetcher=async(url,options)=>{
    const path=new URL(url).pathname;calls.push([path,options.method]);
    if(path==='/runs')return Response.json({runs:[]});
    return Response.json({id:'1000-run',sha:wrong?base:head,deploy:path==='/run'});
  };
  return {calls,adapter:createMeldAdapter({env,git,fetcher})};
}
test('Meld bridge preserves shared staging and pins the controller deployment SHA',async()=>{
  const f=fixture();assert.deepEqual(await f.adapter.dispatch(context),{runId:'1000-run'});
  assert.ok(f.calls.some(c=>c[0]==='merge-base'));assert.ok(f.calls.some(c=>c[0]==='push'&&c[2]===`${head}:refs/heads/staging`));
  assert.equal(f.calls.flat().some(s=>String(s).includes('--force')),false);
  await assert.rejects(fixture({diverge:true}).adapter.dispatch(context),/Shared staging diverged/);
  await assert.rejects(fixture({wrong:true}).adapter.dispatch(context),/moved before/);
});
test('unapproved branch work can only request checks, never staging',async()=>{
  const f=fixture();await f.adapter.dispatch({...context,run:{...context.run,deploymentApprovedBy:null}});
  assert.ok(f.calls.some(c=>c[0]==='push'&&c[2]===`${head}:refs/heads/nanohub-ci/event-1`));
  assert.ok(f.calls.some(c=>c[0]==='/check'));assert.equal(f.calls.some(c=>c[0]==='/run'),false);
});
test('existing Codegraff job reuse makes dispatch retries idempotent',async()=>{
  let posts=0;
  const f=createMeldAdapter({env,git:async(_,command)=>command==='rev-parse'?head:'',fetcher:async(_,o)=>{if(o.method==='POST')posts++;return Response.json({runs:[{id:'existing',sha:head,deploy:true,phase:'passed'}]});}});
  assert.equal((await f.dispatch(context)).runId,'existing');assert.equal(posts,0);
});
test('Meld short build IDs are compared to the exact configured prefix',async()=>{
  const adapter={dispatch:async()=>({runId:'run'}),wait:async()=>({state:'success',kind:'deployment',candidate:head}),accept:async()=>[{url:'https://evidence.invalid/real',realService:true}]};
  const result=await stagingGate(adapter,context,async()=>Response.json({buildId:head.slice(0,7)}));
  assert.equal(result.version,head);assert.equal(result.observedBuildId,head.slice(0,7));
  await assert.rejects(stagingGate(adapter,context,async()=>Response.json({buildId:base.slice(0,7)})),/version mismatch/);
});

test('a protected environment cannot reuse a deployment job that preceded authorization',async()=>{
 const prior={id:'before-approval',sha:head,deploy:true,phase:'passed'};
 const adapter=createMeldAdapter({env,git:async(_,command)=>command==='rev-parse'?head:'',fetcher:async(_,options)=>Response.json(options.method==='POST'?prior:{runs:[prior]})});
 await assert.rejects(adapter.dispatch({...context,deploymentAuthorization:{id:'receipt',issuedAt:Date.now()}}),/new job dispatched after/);
});
