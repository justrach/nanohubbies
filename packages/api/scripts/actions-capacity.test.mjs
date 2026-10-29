import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {sandboxCapacity} from '../../../tools/sandbox-capacity.mjs';
import {reconcileCapacity} from '../../../tools/reconcile-sandbox-capacity.mjs';
const compiled=await build({entryPoints:[new URL('../src/ci/capacity.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',write:false});
const {ActionsCapacity,actionsLimits}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
function fixture(){const db=new DatabaseSync(':memory:'),sql={exec(query,...args){const rows=db.prepare(query).all(...args).map(row=>({...row}));return{toArray:()=>rows};}};return {db,sql,store:new ActionsCapacity(sql)};}
const input=(job='checks/test',runId=randomUUID())=>({id:randomUUID(),runId,attempt:1,job});
test('shared durable capacity bounds accounts and total across independent store instances, and survives reconstruction',()=>{
 const f=fixture();try {
  const limits={total:3,perAccount:2},requests=Array.from({length:20},()=>input());
  const outcomes=requests.map((body,i)=>new ActionsCapacity(f.sql).reserve('repo-'+i,'owner-one',body,limits));
  assert.equal(outcomes.filter(r=>r.admitted).length,2);
  assert.equal(f.store.reserve('other','owner-two',input(),limits).admitted,true);
  assert.equal(f.store.reserve('third','owner-three',input(),limits).admitted,false);
  assert.deepEqual(new ActionsCapacity(f.sql).usage('owner-one'),{total:3,account:2});
  assert.equal(f.store.reserve('repo-0','owner-one',requests[0],limits).reservation.id,requests[0].id);
  assert.deepEqual(f.store.usage('owner-one'),{total:3,account:2});
 }finally{f.db.close();}
});
test('cleanup failure, expired jobs and unknown allocations retain slots; exact release is idempotent and prevents resurrection',()=>{
 const f=fixture();try {
  const body=input(),limits={total:1,perAccount:1};f.store.reserve('repo','owner',body,limits,1);
  assert.equal(f.store.reserve('repo','owner',input(),limits,Date.now()+1e10).admitted,false);
  assert.throws(()=>f.store.inspect('other',body.id),/not found/);
  assert.throws(()=>f.store.reserve('repo','owner',{...body,id:randomUUID()},limits),/already has/);
  f.store.attach('repo',body.id,'box-one');f.store.attach('repo',body.id,'box-one');
  assert.throws(()=>f.store.attach('repo',body.id,'box-two'),/Conflicting/);
  assert.throws(()=>f.store.release('repo',body.id,{reason:'not-created'}),/evidence/);
  assert.throws(()=>f.store.release('repo',body.id,{reason:'destroyed',sandboxId:'box-two'}),/evidence/);
  const released=f.store.release('repo',body.id,{reason:'destroyed',sandboxId:'box-one'},10);
  assert.deepEqual(f.store.release('repo',body.id,{reason:'destroyed',sandboxId:'box-one'},20),released);
  assert.throws(()=>f.store.attach('repo',body.id,'box-one'),/released/);
  assert.equal(f.store.reserve('repo','owner',body,limits).reservation.state,'released');
  assert.deepEqual(f.store.usage('owner'),{total:0,account:0});
  assert.equal(f.store.reserve('repo','owner',input(),limits).admitted,true);
 }finally{f.db.close();}
});
test('lost attach acknowledgement can be reconciled after confirmed destruction, and malformed policy fails closed',()=>{
 const f=fixture();try {const body=input();f.store.reserve('repo','owner',body,{total:1,perAccount:1});assert.equal(f.store.release('repo',body.id,{reason:'destroyed',sandboxId:'box-lost'}).sandboxId,'box-lost');
  assert.deepEqual(actionsLimits({}),{total:64,perAccount:16});assert.deepEqual(actionsLimits({ACTIONS_MAX_SANDBOXES:'8',ACTIONS_MAX_SANDBOXES_PER_ACCOUNT:'2'}),{total:8,perAccount:2});
  for(const value of ['0','-1','1.5','infinite','10001',''])assert.throws(()=>actionsLimits({ACTIONS_MAX_SANDBOXES:value}),/Invalid/);
  for(const patch of [{attempt:0},{job:'bad/../escape'},{id:'bad'},{runId:'bad'}])assert.throws(()=>f.store.reserve('repo','owner',{...input(),...patch},{total:1,perAccount:1}),/Invalid/);
 }finally{f.db.close();}
});
test('controller polls only explicit denials, saves receipt before writes, and retains uncertain allocation or release',async()=>{
 const run={id:randomUUID(),attempt:1,leaseUntil:Date.now()+600000},calls=[],saved=[];let denies=1;
 const api=async(path,body)=>{calls.push([path,body]);assert.equal(saved.at(-1).state,path.endsWith('reserve')?'reserve-pending':path.endsWith('attach')?'allocated':'release-pending');if(path.endsWith('reserve'))return denies-->0?{admitted:false,retryAfter:1}:{admitted:true,reservation:{...body,state:'reserved',sandboxId:null}};return {id:body.id,sandboxId:body.sandboxId,state:path.endsWith('attach')?'allocated':'released'};};
 const capacity=sandboxCapacity(api,run,'/unused',{receipt:async(_,r)=>saved.push({...r}),sleep:async()=>{}}),slot=await capacity.acquire({name:'check/test'});
 await slot.allocating();assert.equal(saved.at(-1).state,'allocation-pending');await slot.attached('box-one');await slot.released('box-one');assert.equal(saved.at(-1).state,'released');assert.equal(calls.filter(([p])=>p.endsWith('reserve')).length,2);
 const unknown=[];await assert.rejects(sandboxCapacity(async()=>{throw Error('lost reply');},run,'/unused',{receipt:async(_,r)=>unknown.push(r)}).acquire({name:'check/test'}),/lost reply/);assert.equal(unknown.length,1);assert.equal(unknown[0].state,'reserve-pending');
});
test('reconciler never releases a live or unknown VM, requires exact repository receipt, and can finish after lost release acknowledgement',async()=>{
 const record={...input(),sandboxId:'box-one'},writes=[],current={...record,state:'allocated'},api=async(path,body)=>{if(path.endsWith('inspect'))return current;writes.push(body);return {...current,state:'released'};};
 const live={api:async()=>({status:'running'}),destroy:async()=>{throw Error('not authorized in this test');}};
 await assert.rejects(reconcileCapacity(record,{api,client:live,release:true}),/still exists/);assert.deepEqual(writes,[]);
 await assert.rejects(reconcileCapacity({...record,job:'other/job'},{api,client:live,release:true}),/does not match/);
 await assert.rejects(reconcileCapacity({...record,sandboxId:null},{api:async()=>({...current,sandboxId:null}),client:live,release:true}),/unknown/);
 let destroyed=0;const done=await reconcileCapacity(record,{api,client:{destroy:async()=>{destroyed++;}},destroy:true});assert.equal(destroyed,1);assert.equal(done.state,'released');assert.equal(writes.length,1);
 writes.length=0;await assert.rejects(reconcileCapacity(record,{api,client:{api:async()=>{throw Object.assign(Error('provider unavailable'),{status:503});}},release:true}),/provider unavailable/);assert.equal(writes.length,0);
 const absent={api:async()=>{throw Object.assign(Error('absent'),{status:404});}};assert.equal((await reconcileCapacity(record,{api,client:absent,release:true})).state,'released');
});
