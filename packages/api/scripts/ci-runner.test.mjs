import test from 'node:test';
import assert from 'node:assert/strict';
import { stagingGate, verifyVersion } from '../../../tools/ci-runner.mjs';
const head='a'.repeat(40),base='b'.repeat(40),context={run:{id:'event',head,base},stagingOrigin:'https://staging.example.invalid'};
const version=sha=>async()=>Response.json({buildId:sha});
function adapter(){return {dispatch:async c=>{assert.equal(c.idempotencyKey,'event');return {runId:'deploy-1'};},wait:async()=>({state:'success',candidate:head,kind:'deployment'}),accept:async()=>[{url:'https://evidence.invalid/real',realService:true}]};}
test('a deployment must succeed before version and real acceptance count',async()=>{
  for(const patch of [{state:'failure',candidate:head,kind:'deployment'},{state:'success',candidate:base,kind:'deployment'},{state:'success',candidate:head,kind:'checks'}]){
    await assert.rejects(stagingGate({...adapter(),wait:async()=>patch},context,version(head)),/deployment job/);
  }
  await assert.rejects(stagingGate(adapter(),context,version(base)),/version mismatch/);
  await assert.rejects(stagingGate({...adapter(),accept:async()=>[{url:'https://fixture.invalid',realService:false}]},context,version(head)),/Real-service/);
});
test('shared staging movement during acceptance invalidates evidence',async()=>{
  let count=0;
  await assert.rejects(stagingGate(adapter(),context,async()=>Response.json({buildId:count++===0?head:base})),/version mismatch/);
  const success=await stagingGate(adapter(),context,version(head));
  assert.equal(success.candidate,head);assert.equal(success.base,base);assert.equal(success.runId,'deploy-1');
  await assert.rejects(verifyVersion(context.stagingOrigin,head,async()=>new Response('',{status:503})),/endpoint failed/);
});

const {authorizeEnvironment}=await import('../../../tools/ci-runner.mjs');
test('waiting environment defers before adapter dispatch and uses durable exact request; optional missing environment preserves legacy staging',async()=>{
 const calls=[];const api=async(path,body)=>{calls.push([path,body]);if(path.endsWith('/request'))return {id:'request-1',state:'waiting'};if(path.endsWith('/defer'))return {state:'waiting'};throw Error('Authorization must not happen before approval');};
 const result=await authorizeEnvironment(api,{id:'event-1',attempt:3},'production',[],{beforeDefer:async()=>calls.push(['logs'])});assert.equal(result.waiting,true);assert.deepEqual(calls.map(c=>c[0]),['/deployments/request','logs','/deployments/defer']);assert.deepEqual(calls[2][1],{requestId:'request-1',attempt:3,results:[]});
 assert.deepEqual(await authorizeEnvironment(async()=>({configured:false}),{id:'event',attempt:1},'staging',[],{optional:true}),{authorization:null,waiting:false});
});
test('approval racing deferral immediately rechecks authorization; rejected and stale environments never dispatch',async()=>{
 const calls=[],receipt={id:'receipt-1',issuedAt:Date.now()};const api=async path=>{calls.push(path);return path.endsWith('/request')?{id:'request-1',state:'waiting'}:path.endsWith('/defer')?{ready:true}:receipt;};
 const result=await authorizeEnvironment(api,{id:'event',attempt:2},'staging',[]);assert.deepEqual(result.authorization,receipt);assert.deepEqual(calls,['/deployments/request','/deployments/defer','/deployments/authorize']);
 for(const state of ['rejected','stale'])await assert.rejects(authorizeEnvironment(async path=>{assert.ok(path.endsWith('/request'));return{state,reason:'Changed candidate'};},{id:'event',attempt:1},'staging',[]),/Changed candidate/);
});
