import test from 'node:test';
import assert from 'node:assert/strict';
import {observeSandbox, readCiLease} from '../../../tools/sandbox-observation.mjs';

test('read recovery is bounded and retains the original job deadline', async()=>{
  let time=0, calls=0;
  const options={deadline:10000,label:'job status',now:()=>time,sleep:async ms=>{time+=ms;}};
  assert.equal(await observeSandbox(async({timeoutMs})=>{
    calls++; assert.ok(timeoutMs>0 && timeoutMs<=10000-time);
    if(calls<3)throw Object.assign(Error('private diagnostic'),{code:'ECONNRESET'});
    return 'same-job';
  },options),'same-job');
  assert.equal(calls,3);
  calls=0;time=0;
  await assert.rejects(observeSandbox(async()=>{calls++;throw Object.assign(Error('private diagnostic'),{status:503});},options),e=>e.code==='job_deadline'&&!e.message.includes('private diagnostic'));
  assert.ok(calls<=8);assert.equal(time,10000);
  calls=0;
  await assert.rejects(observeSandbox(async()=>{calls++;throw Object.assign(Error('private diagnostic'),{code:'ECONNRESET'});},{deadline:1e6,label:'job logs',now:()=>0,sleep:async()=>{}}),/bounded recovery window/);
  assert.equal(calls,8);
});

test('authorization, malformed responses and control command failures are never retried',async()=>{
  for(const error of [Object.assign(Error('denied'),{status:403}),Object.assign(Error('absent'),{status:404}),new SyntaxError('bad JSON'),Object.assign(Error('socket from command'),{code:'sandbox_command_failed'}),new TypeError('bad argument')]) {
    let calls=0;
    await assert.rejects(observeSandbox(async()=>{calls++;throw error;},{deadline:Date.now()+60000,label:'job status',sleep:async()=>{}}),e=>e===error);
    assert.equal(calls,1);
  }
});

test('authorization recovery shares the enclosing observation budget',async()=>{
  let time=0;
  const clock={deadline:120000,now:()=>time,sleep:async ms=>{time+=ms;}};
  await assert.rejects(observeSandbox(async()=>{throw Object.assign(Error('reset'),{code:'ECONNRESET'});}, {
    ...clock,label:'job status',beforeRetry:options=>observeSandbox(async({timeoutMs})=>{
      assert.ok(timeoutMs<=60000-time);
      throw Object.assign(Error('lease outage'),{status:503});
    },{...clock,...options,label:'candidate lease'}),
  }),/bounded recovery window/);
  assert.ok(time<=60000);
});

test('recovery rechecks authorization and cannot accept a late successful read',async()=>{
  let calls=0;
  await assert.rejects(observeSandbox(async()=>{calls++;throw Object.assign(Error('reset'),{code:'ECONNRESET'});},{deadline:Date.now()+60000,label:'job status',sleep:async()=>{},beforeRetry:async()=>{throw Object.assign(Error('revoked'),{code:'ci_cancelled'});}}),e=>e.code==='ci_cancelled');
  assert.equal(calls,1);
  let time=0;
  await assert.rejects(observeSandbox(async()=>{time=101;return 'success';},{deadline:100,label:'job status',now:()=>time}),e=>e.code==='job_deadline');
});

test('lease reads discard every response body and distinguish outages from revocation',async()=>{
  for(const status of [200,204,401,403,404,408,429,500,502,503,504]) {
    let discarded=0;
    const read=()=>readCiLease('https://git.invalid/repo','synthetic-token',{timeoutMs:50,fetcher:async(url,options)=>{
      assert.equal(url,'https://git.invalid/repo/HEAD');assert.equal(options.redirect,'error');
      return {status,body:{cancel:async()=>{discarded++;}}};
    }});
    if([408,429,500,502,503,504].includes(status))await assert.rejects(read,e=>e.status===status);
    else assert.equal(await read(),status===200);
    assert.equal(discarded,1);
  }
});
