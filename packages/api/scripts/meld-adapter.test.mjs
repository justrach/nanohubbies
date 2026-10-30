import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,stat,rename} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {createServer} from 'node:http';
import {createMeldAdapter} from '../../../tools/meld-staging-adapter.mjs';
import {meldRuns,currentMeldJob,meldRequiredSteps} from '../../../tools/meld-pipeline-state.mjs';
import {stagingGate} from '../../../tools/ci-runner.mjs';
const head='a'.repeat(40),base='b'.repeat(40),timestamp=1700000000000;
const env={PIPELINE_ADMIN_SECRET:'MELD-ADMIN-TEST-PRIVATE-123',MELD_CI_WAIT_MS:'100'};
const steps=()=>meldRequiredSteps.map(name=>({name,exitCode:0,milliseconds:1}));
function job({at=timestamp,deploy=false,ref=deploy?'staging':'nanohub-ci/event-1/1',phase='passed',...rest}={}){
 return {id:at+'-11111111-1111-4111-8111-111111111111',sha:head,deploy,ref,phase,queuedAt:at,statusContext:deploy?'Codegraff / staging':'Codegraff / CI',steps:steps(),...rest};
}
async function fixture(work){
 const dir=await mkdtemp(join(tmpdir(),'nh-meld-attempt-'));await mkdir(join(dir,'source'));await mkdir(join(dir,'artifacts'));
 const context={source:join(dir,'source'),artifacts:join(dir,'artifacts'),run:{id:'event-1',attempt:1,head,base,deploymentApprovedBy:null},stagingOrigin:'https://staging.meld.space',versionPrefixLength:7};
 const state={calls:[],posts:0,pushes:0,jobs:[],active:null,queued:[],tick:timestamp,clock:0};
 const git=async(_,command,...args)=>{state.calls.push([command,...args]);if(command==='rev-parse')return head;if(command==='push')state.pushes++;return '';};
 const view=()=>({active:state.active,queued:state.queued,runs:state.jobs});
 const fetcher=async(url,options)=>{
  assert.equal(new URL(url).origin,'https://meld-staging-ci.phedayatnia.workers.dev');assert.equal(options.redirect,'error');
  if(options.method==='GET')return Response.json(view());
  state.posts++;state.tick+=1000;const deploy=new URL(url).pathname==='/run',ref=deploy?'staging':JSON.parse(options.body).ref;
  const created=job({at:state.tick,deploy,ref});state.jobs.unshift(created);return Response.json({id:created.id,sha:created.sha,deploy});
 };
 const make=(overrides={})=>createMeldAdapter({env,git,fetcher,now:()=>state.clock,sleep:async()=>{state.clock+=101;},...overrides});
 try{await work({dir,context,state,git,fetcher,view,make});}finally{await rm(dir,{recursive:true,force:true});}
}
test('fresh attempt dispatch preserves staging history, pins the SHA and records an explicit new job',async()=>fixture(async f=>{
 f.context.run.deploymentApprovedBy='owner';const adapter=f.make(),result=await adapter.dispatch(f.context);
 assert.equal(result.runId,f.state.jobs[0].id);assert.equal(f.state.posts,1);
 assert.ok(f.state.calls.some(c=>c[0]==='merge-base'));assert.ok(f.state.calls.some(c=>c[0]==='push'&&c[2]===`${head}:refs/heads/staging`));assert.equal(f.state.calls.flat().some(x=>String(x).includes('--force')),false);
 const path=join(f.context.artifacts,'meld-dispatch.json'),receipt=JSON.parse(await readFile(path,'utf8'));assert.equal(receipt.state,'acknowledged');assert.equal(receipt.binding.attempt,1);assert.equal((await stat(path)).mode&0o777,0o600);assert.ok(!(await readFile(path,'utf8')).includes(env.PIPELINE_ADMIN_SECRET));
 assert.equal((await adapter.wait(result.runId,head,true)).steps.length,7);
}));
test('unapproved branch work is checks-only and uses a ref unique to the Nanohub attempt',async()=>fixture(async f=>{
 const result=await f.make().dispatch(f.context);assert.ok(f.state.calls.some(c=>c[0]==='push'&&c[2]===`${head}:refs/heads/nanohub-ci/event-1/1`));assert.equal(f.state.jobs[0].deploy,false);assert.equal(result.runId,f.state.jobs[0].id);
}));
test('an older pass is never reused for a new attempt; acknowledged same-attempt restart is idempotent',async()=>fixture(async f=>{
 const old=job();f.state.jobs=[old];const adapter=f.make(),first=await adapter.dispatch(f.context);assert.notEqual(first.runId,old.id);assert.equal(f.state.posts,1);
 assert.deepEqual(await f.make().dispatch(f.context),first);assert.equal(f.state.posts,1);assert.equal(f.state.pushes,1);
 const artifacts=join(f.dir,'attempt-2');await mkdir(artifacts);const second=await adapter.dispatch({...f.context,artifacts,run:{...f.context.run,attempt:2}});assert.notEqual(second.runId,first.runId);assert.equal(f.state.posts,2);assert.equal(f.state.jobs[0].ref,'nanohub-ci/event-1/2');
 await assert.rejects(adapter.wait(first.runId,head,false),/newer or ambiguously ordered/);
}));
test('a provider job preceding dispatch or environment authorization cannot satisfy a fresh attempt',async()=>fixture(async f=>{
 f.context.run.deploymentApprovedBy='owner';f.context.deploymentAuthorization={id:'authorization-1'};const prior=job({deploy:true});f.state.jobs=[prior];
 const adapter=f.make({fetcher:async(_,o)=>Response.json(o.method==='POST'?{id:prior.id,sha:head,deploy:true}:f.view())});
 await assert.rejects(adapter.dispatch(f.context),/new job dispatched after/);await assert.rejects(f.make().dispatch(f.context),/unconfirmed/);assert.equal(f.state.pushes,1);
}));
test('parallel duplicate dispatch has one mutation owner and cannot push or enqueue twice',async()=>fixture(async f=>{
 const results=await Promise.allSettled([f.make().dispatch(f.context),f.make().dispatch(f.context)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.state.posts,1);assert.equal(f.state.pushes,1);
}));
test('lost push or POST acknowledgement leaves intent closed, without automatic replay',async()=>{
 for(const failure of ['push','post'])await fixture(async f=>{
  const adapter=f.make({git:async(...args)=>{const result=await f.git(...args);if(failure==='push'&&args[1]==='push')throw Error('Lost push acknowledgement');return result;},fetcher:async(...args)=>{const result=await f.fetcher(...args);if(failure==='post'&&args[1].method==='POST')throw Error('Lost job acknowledgement');return result;}});
  await assert.rejects(adapter.dispatch(f.context),/Lost/);const pushes=f.state.pushes,posts=f.state.posts;await assert.rejects(f.make().dispatch(f.context),/unconfirmed/);assert.equal(f.state.pushes,pushes);assert.equal(f.state.posts,posts);
 });
});
test('receipt binding rejects changed base, attempt or authorization without another write',async()=>fixture(async f=>{
 await f.make().dispatch(f.context);
 for(const update of [{base:'c'.repeat(40)},{attempt:2},{id:'other-event'}])await assert.rejects(f.make().dispatch({...f.context,run:{...f.context.run,...update}}),/another attempt/);
 await assert.rejects(f.make().dispatch({...f.context,deploymentAuthorization:{id:'new-approval'}}),/another attempt/);assert.equal(f.state.posts,1);assert.equal(f.state.pushes,1);
}));
test('malformed receipts and candidate-local artifact paths fail before provider dispatch',async()=>fixture(async f=>{
 const local=join(f.context.source,'artifacts');await mkdir(local);await assert.rejects(f.make().dispatch({...f.context,artifacts:local}),/outside candidate/);assert.equal(f.state.posts,0);
 await writeFile(join(f.context.artifacts,'meld-dispatch.json'),'not JSON');await assert.rejects(f.make().dispatch(f.context),/cannot be verified/);assert.equal(f.state.pushes,0);
}));
test('diverged staging and moved controller heads stop without accepting another job',async()=>{
 await fixture(async f=>{f.context.run.deploymentApprovedBy='owner';const adapter=f.make({git:async(...args)=>{if(args[1]==='merge-base')throw Error('diverged');return f.git(...args);}});await assert.rejects(adapter.dispatch(f.context),/Shared staging diverged/);assert.equal(f.state.pushes,0);assert.equal(f.state.posts,0);});
 await fixture(async f=>{await assert.rejects(f.make({fetcher:async(u,o)=>o.method==='POST'?Response.json({id:job().id,sha:base,deploy:false}):f.fetcher(u,o)}).dispatch(f.context),/moved before/);});
});
test('every newer same-SHA state invalidates an older pass; checks and deployment contexts stay separate',async()=>{
 for(const phase of ['queued','building','failed','superseded','cleanup','reporting','passed'])await fixture(async f=>{
  const adapter=f.make(),{runId}=await adapter.dispatch(f.context);f.state.jobs.unshift(job({at:f.state.tick+1000,phase,ref:'another-branch'}));await assert.rejects(adapter.wait(runId,head,false),/newer or ambiguously ordered/);
 });
 await fixture(async f=>{const adapter=f.make(),{runId}=await adapter.dispatch(f.context);f.state.jobs.unshift(job({at:f.state.tick+1000,deploy:true}));assert.equal((await adapter.wait(runId,head,false)).kind,'checks');});
});
test('active cleanup/reporting overrides passed history; final observation catches a new rerun',async()=>{
 for(const phase of ['cleanup','reporting'])await fixture(async f=>{const adapter=f.make(),{runId}=await adapter.dispatch(f.context);f.state.active={...f.state.jobs[0],phase};await assert.rejects(adapter.wait(runId,head,false),/Timed out/);});
 await fixture(async f=>{let reads=0;const adapter=f.make({fetcher:async(u,o)=>{if(o.method==='GET'&&f.state.posts){reads++;if(reads===2)f.state.queued=[job({at:f.state.tick+1000,phase:'queued'})];}return f.fetcher(u,o);}}),{runId}=await adapter.dispatch(f.context);await assert.rejects(adapter.wait(runId,head,false),/newer or ambiguously ordered/);});
});
test('unacknowledged dispatch, wrong refs, failed jobs and incomplete CI suites cannot pass',async()=>{
 await fixture(async f=>{await assert.rejects(f.make().wait(job().id,head,false),/acknowledged dispatch/);});
 for(const change of [j=>{j.ref='foreign';},j=>{j.phase='failed';},j=>{j.steps=[];},j=>{j.steps.pop();},j=>{j.steps[0].exitCode=1;}])await fixture(async f=>{const adapter=f.make(),{runId}=await adapter.dispatch(f.context);change(f.state.jobs[0]);await assert.rejects(adapter.wait(runId,head,false));});
});
test('snapshots exclude source capabilities and reject conflicting identity, ambiguous ordering or malformed jobs',()=>{
 const raw=job({sourceUrl:'https://private.invalid/source?secret=must-not-retain',message:'must-not-retain'}),snapshot={active:null,queued:[],runs:[raw]};assert.equal(JSON.stringify(meldRuns(snapshot)).includes('must-not-retain'),false);
 const binding={id:raw.id,sha:head,deploy:false,ref:raw.ref};assert.equal(currentMeldJob(meldRuns(snapshot),binding).phase,'passed');
 const sameTime=job({id:timestamp+'-22222222-2222-4222-8222-222222222222'});assert.throws(()=>currentMeldJob(meldRuns({...snapshot,queued:[sameTime]}),binding),/ambiguously ordered/);
 for(const invalid of [{...snapshot,queued:undefined},{...snapshot,runs:[{...raw,queuedAt:null}]},{...snapshot,runs:[{...raw,statusContext:'untrusted'}]},{...snapshot,active:{...raw,sha:base}}])assert.throws(()=>meldRuns(invalid));
});
test('the controller URL is exact and oversized authenticated replies stay bounded',async()=>{
 for(const url of ['https://meld-staging-ci.phedayatnia.workers.dev:444/','https://user@meld-staging-ci.phedayatnia.workers.dev/','https://meld-staging-ci.phedayatnia.workers.dev/path'])assert.throws(()=>createMeldAdapter({env:{...env,MELD_STAGING_CI_URL:url}}));
 await fixture(async f=>{await assert.rejects(f.make({fetcher:async()=>new Response('x'.repeat(524289))}).dispatch(f.context),/exceeded its bound/);assert.equal(f.state.posts,0);});
});
test('malformed controller JSON cannot expose response content and failed acknowledgement persistence cannot pass',async()=>{
 await fixture(async f=>{await assert.rejects(f.make({fetcher:async()=>new Response('private-controller-capability-is-not-JSON')}).dispatch(f.context),error=>{assert.equal(error.message,'Invalid Meld controller JSON');return true;});assert.equal(f.state.posts,0);});
 await fixture(async f=>{const adapter=f.make({fetcher:async(...args)=>{const response=await f.fetcher(...args);if(args[1].method==='POST'){await rename(f.context.artifacts,join(f.dir,'retained-intent'));await writeFile(f.context.artifacts,'not a directory');}return response;}});await assert.rejects(adapter.dispatch(f.context));assert.equal(f.state.posts,1);await assert.rejects(f.make().dispatch(f.context));assert.equal(f.state.posts,1);assert.equal(JSON.parse(await readFile(join(f.dir,'retained-intent/meld-dispatch.json'),'utf8')).state,'pending');});
});
test('real HTTP lost acknowledgement dispatches once and retains no controller key',async()=>fixture(async f=>{
 let posts=0;const server=createServer(async(req,res)=>{assert.equal(req.headers.authorization,'Bearer '+env.PIPELINE_ADMIN_SECRET);if(req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(f.view()));return;}posts++;for await(const chunk of req){}req.socket.destroy();});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const fetcher=(url,options)=>fetch('http://127.0.0.1:'+server.address().port+new URL(url).pathname,options);
 try{await assert.rejects(f.make({fetcher}).dispatch(f.context));await assert.rejects(f.make({fetcher}).dispatch(f.context),/unconfirmed/);assert.equal(posts,1);assert.equal((await readFile(join(f.context.artifacts,'meld-dispatch.json'),'utf8')).includes(env.PIPELINE_ADMIN_SECRET),false);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}));
test('Meld build IDs match the exact prefix and are rechecked after acceptance',async()=>{
 const context={run:{head,base},stagingOrigin:'https://staging.meld.space',versionPrefixLength:7};const adapter={dispatch:async()=>({runId:'run'}),wait:async()=>({state:'success',kind:'deployment',candidate:head}),accept:async()=>[{url:'https://evidence.invalid/real',realService:true}]};
 assert.equal((await stagingGate(adapter,context,async()=>Response.json({buildId:head.slice(0,7)}))).version,head);let reads=0;await assert.rejects(stagingGate(adapter,context,async()=>Response.json({buildId:++reads===1?head.slice(0,7):base.slice(0,7)})),/version mismatch/);
});
