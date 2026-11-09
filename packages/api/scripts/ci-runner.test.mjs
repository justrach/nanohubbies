import test from 'node:test';
import assert from 'node:assert/strict';
import { stagingGate, verifyVersion, runOnce, revalidateEnvironment } from '../../../tools/ci-runner.mjs';
const head='a'.repeat(40),base='b'.repeat(40),context={run:{id:'event',head,base},stagingOrigin:'https://staging.example.invalid'};
const version=sha=>async()=>Response.json({buildId:sha});
test('invalid private toolchain configuration is rejected before claiming a hosted job',async()=>{
 const config={origin:'https://never-contact.invalid',repository:'alice/repo',backend:'docker',image:'registry.cloudflare.com/'+'a'.repeat(32)+'/nanohub-ci@sha256:'+'b'.repeat(64),imageRegistry:{provider:'cloudflare',config:'/etc/nanohub/wrangler.jsonc'},artifacts:'/var/lib/nanohub'};
 await assert.rejects(runOnce(config,'synthetic-unused-token'),/require the Codegraff backend/);
 await assert.rejects(runOnce({...config,backend:'codegraff',imageRegistry:{...config.imageRegistry,config:'relative.json'}},'synthetic-unused-token'),/absolute trusted/);
 await assert.rejects(runOnce({...config,backend:'codegraff',imageSnapshot:'snp_fixture'},'synthetic-unused-token'),/cannot be combined/);
});
test('invalid source limits or upload concurrency fail before provider access or a candidate claim',async()=>{
 const config={origin:'https://never-contact.invalid',repository:'alice/repo',backend:'codegraff',image:'registry.invalid/toolchain@sha256:'+'c'.repeat(64),artifacts:'/var/lib/nanohub'};
 for(const value of [0,-1,1.5,1024*1024*1024+1,'536870912',null])await assert.rejects(runOnce({...config,maxSourceBundleBytes:value},'synthetic-unused-token'),/maxSourceBundleBytes/);
 for(const value of [0,-1,1.5,9,'4',null])await assert.rejects(runOnce({...config,sourceTransferConcurrency:value},'synthetic-unused-token'),/sourceTransferConcurrency/);
 await assert.rejects(runOnce({...config,backend:'docker',sourceTransferConcurrency:4},'synthetic-unused-token'),/require the Codegraff backend/);
});
test('explicit owned-sandbox preflight permits claims only after that authenticated resource read',async()=>{
 const originalFetch=globalThis.fetch,originalKey=process.env.CODEGRAFF_API_KEY,sandboxId='cnd_'+'c'.repeat(40),calls=[];
 const config={origin:'https://never-contact.invalid',repository:'alice/repo',backend:'codegraff',image:'registry.invalid/toolchain@sha256:'+'d'.repeat(64),artifacts:'/var/lib/nanohub',sandboxAccessProbeId:sandboxId};
 try{
  process.env.CODEGRAFF_API_KEY='synthetic-owned-runner-key';
  globalThis.fetch=async(url,options)=>{calls.push([String(url),options.method]);if(String(url)==='https://gateway.codegraff.com/v1/sandboxes/'+sandboxId)return Response.json({id:sandboxId,state:'destroyed'});if(String(url).endsWith('/capacity/status'))return Response.json({sharedReservations:'v1'});assert.ok(String(url).endsWith('/ci/claim'));return Response.json({run:null});};
  assert.deepEqual(await runOnce(config,'unused-repository-token'),{idle:true});assert.deepEqual(calls.map(call=>call[0]),['https://gateway.codegraff.com/v1/sandboxes/'+sandboxId,'https://never-contact.invalid/api/repos/alice/repo/ci/capacity/status','https://never-contact.invalid/api/repos/alice/repo/ci/claim']);
  calls.length=0;process.env.CODEGRAFF_API_KEY='synthetic-owned-missing-scope';globalThis.fetch=async(url)=>{calls.push([String(url)]);return Response.json({error:{type:'insufficient_scope'}},{status:403});};
  await assert.rejects(runOnce(config,'unused-repository-token'),/requires the sandbox scope.*no CI job was claimed/);assert.equal(calls.length,1);
  for(const sandboxAccessProbeId of ['../bad','id?limit=1','',null])await assert.rejects(runOnce({...config,sandboxAccessProbeId},'unused-repository-token'),/trusted sandbox ID/);
 }finally{globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.CODEGRAFF_API_KEY;else process.env.CODEGRAFF_API_KEY=originalKey;}
});
function adapter(){return {dispatch:async c=>{assert.equal(c.idempotencyKey,'event');return {runId:'deploy-1'};},wait:async()=>({state:'success',candidate:head,kind:'deployment'}),accept:async()=>[{url:'https://evidence.invalid/real',realService:true}]};}
test('unverified sandbox credentials stop before claiming a candidate or reporting a failed check',async()=>{
 const originalFetch=globalThis.fetch,originalKey=process.env.CODEGRAFF_API_KEY;
 const config={origin:'https://never-contact.invalid',repository:'alice/repo',backend:'codegraff',image:'registry.invalid/toolchain@sha256:'+'c'.repeat(64),artifacts:'/var/lib/nanohub'};
 try {
  for(const [index,status,body] of [[0,403,{error:{type:'insufficient_scope',message:'private-body'}}],[1,401,{error:'private-body'}],[2,503,{error:'private-body'}],[3,200,'malformed-private-body']]){
   const calls=[];process.env.CODEGRAFF_API_KEY=`preflight-synthetic-key-${index}`;
   globalThis.fetch=async(url,options)=>{
    calls.push(String(url));assert.equal(String(url),'https://gateway.codegraff.com/v1/sandboxes');
    assert.equal(options.method,'GET');assert.equal(options.headers.Authorization,`Bearer preflight-synthetic-key-${index}`);
    return status===200?new Response(body):Response.json(body,{status});
   };
   await assert.rejects(runOnce(config,'unused-repository-token'),error=>{
    assert.match(error.message,/no CI job was claimed/);assert.ok(!error.message.includes('private-body'));
    return true;
   });
   assert.deepEqual(calls,['https://gateway.codegraff.com/v1/sandboxes']);
  }
 } finally {globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.CODEGRAFF_API_KEY;else process.env.CODEGRAFF_API_KEY=originalKey;}
});
test('successful sandbox access permits normal claims, shares verification across repositories and does not allocate a VM',async()=>{
 const originalFetch=globalThis.fetch,originalKey=process.env.CODEGRAFF_API_KEY,calls=[];
 const config={origin:'https://never-contact.invalid',repository:'alice/repo',backend:'codegraff',image:'registry.invalid/toolchain@sha256:'+'c'.repeat(64),artifacts:'/var/lib/nanohub'};
 try {
  process.env.CODEGRAFF_API_KEY='preflight-shared-valid-key';
  globalThis.fetch=async(url,options)=>{
   calls.push([String(url),options.method]);
   if(String(url)==='https://gateway.codegraff.com/v1/sandboxes')return Response.json({sandboxes:[]});
   if(String(url).endsWith('/capacity/status'))return Response.json({sharedReservations:'v1'});
   assert.match(String(url),/\/ci\/claim$/);return Response.json({run:null});
  };
  assert.deepEqual(await runOnce(config,'unused-repository-token'),{idle:true});
  assert.deepEqual(await runOnce({...config,repository:'alice/other'},'unused-other-token'),{idle:true});
  assert.deepEqual(calls,[['https://gateway.codegraff.com/v1/sandboxes','GET'],['https://never-contact.invalid/api/repos/alice/repo/ci/capacity/status','POST'],['https://never-contact.invalid/api/repos/alice/repo/ci/claim','POST'],['https://never-contact.invalid/api/repos/alice/other/ci/capacity/status','POST'],['https://never-contact.invalid/api/repos/alice/other/ci/claim','POST']]);
  assert.ok(!calls.some(([url,method])=>url==='https://gateway.codegraff.com/v1/sandboxes'&&method==='POST'));
 } finally {globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.CODEGRAFF_API_KEY;else process.env.CODEGRAFF_API_KEY=originalKey;}
});
test('explicit Docker and trusted pipeline runners do not require Codegraff account access',async()=>{
 const originalFetch=globalThis.fetch,originalKey=process.env.CODEGRAFF_API_KEY,calls=[];
 const config={origin:'https://never-contact.invalid',repository:'alice/repo',image:'registry.invalid/toolchain@sha256:'+'c'.repeat(64),artifacts:'/var/lib/nanohub'};
 try {
  delete process.env.CODEGRAFF_API_KEY;
  globalThis.fetch=async(url,options)=>{calls.push(String(url));assert.equal(options.method,'POST');assert.equal(String(url),'https://never-contact.invalid/api/repos/alice/repo/ci/claim');return Response.json({run:null});};
  assert.deepEqual(await runOnce({...config,backend:'docker'},'unused-repository-token'),{idle:true});
  assert.deepEqual(await runOnce({...config,pipelineAdapter:'/etc/nanohub/trusted-adapter.mjs'},'unused-repository-token'),{idle:true});
  assert.equal(calls.length,2);
 } finally {globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.CODEGRAFF_API_KEY;else process.env.CODEGRAFF_API_KEY=originalKey;}
});
test('missing or incompatible shared capacity service stops before a CI claim',async()=>{
 const originalFetch=globalThis.fetch,originalKey=process.env.CODEGRAFF_API_KEY,calls=[];
 try {process.env.CODEGRAFF_API_KEY='synthetic-capacity-preflight';globalThis.fetch=async(url)=>{calls.push(String(url));if(String(url).includes('gateway.codegraff.com'))return Response.json({sandboxes:[]});assert.ok(String(url).endsWith('/capacity/status'));return Response.json({sharedReservations:'old'});};
  await assert.rejects(runOnce({origin:'https://never-contact.invalid',repository:'alice/repo',backend:'codegraff',image:'registry.invalid/toolchain@sha256:'+'c'.repeat(64),artifacts:'/var/lib/nanohub'},'unused-token'),/no CI job was claimed/);assert.equal(calls.length,2);
 }finally{globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.CODEGRAFF_API_KEY;else process.env.CODEGRAFF_API_KEY=originalKey;}
});
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

test('version reads use the fixed endpoint without redirects or cache and accept only the exact configured SHA prefix',async()=>{
 for(const field of ['buildId','build_id','sha'])for(const prefix of [7,40])assert.equal(await verifyVersion('https://staging.invalid',head,async(url,options)=>{
  assert.equal(String(url),'https://staging.invalid/api/version');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.equal(options.headers['Cache-Control'],'no-cache');assert.ok(options.signal instanceof AbortSignal);return Response.json({[field]:head.slice(0,prefix)});
 },prefix),head);
 for(const [candidate,prefix,origin] of [[head,6,context.stagingOrigin],[head,41,context.stagingOrigin],[head,'7',context.stagingOrigin],['not-a-commit',40,context.stagingOrigin],[head,40,'https://user:password@staging.invalid'],[head,40,'http://remote.invalid']])await assert.rejects(verifyVersion(origin,candidate,async()=>{assert.fail('Invalid version configuration must fail before network access');},prefix));
 assert.equal(await verifyVersion('http://127.0.0.1:3000',head,version(head)),head);
});

test('version checks never echo candidate endpoint values or transport/JSON/stream exceptions into controller errors',async()=>{
 const privateText='testtesttesttest';
 const cases=[()=>Response.json({buildId:privateText}),()=>new Response(privateText),()=>Response.json(null),()=>Response.json([]),()=>Response.json({buildId:{privateText}}),()=>{throw Error(privateText);},()=>new Response(new ReadableStream({start(controller){controller.error(Error(privateText));}}))];
 for(const response of cases)await assert.rejects(verifyVersion(context.stagingOrigin,head,async()=>response()),error=>!error.message.includes(privateText)&&/version mismatch|version response|endpoint is unavailable/.test(error.message));
 await assert.rejects(verifyVersion(context.stagingOrigin,head,async()=>new Response(null,{status:302,headers:{location:'https://elsewhere.invalid'}})),/endpoint failed/);
 const redirected=Response.json({buildId:head});Object.defineProperty(redirected,'redirected',{value:true});await assert.rejects(verifyVersion(context.stagingOrigin,head,async()=>redirected),/endpoint failed/);
});

test('version bodies are bounded while streaming, including correctly hashed-looking responses with oversized trailing content',async()=>{
 const minimal=JSON.stringify({buildId:head,extra:''}),exact=JSON.stringify({buildId:head,extra:'x'.repeat(8192-Buffer.byteLength(minimal))});assert.equal(Buffer.byteLength(exact),8192);
 assert.equal(await verifyVersion(context.stagingOrigin,head,async()=>new Response(exact)),head);
 let cancelled=false;const oversized=new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(exact+' '));},cancel(){cancelled=true;}}));
 await assert.rejects(verifyVersion(context.stagingOrigin,head,async()=>oversized),/oversized staging version response/);assert.equal(cancelled,true);
 const chunks=[exact.slice(0,20),exact.slice(20)];assert.equal(await verifyVersion(context.stagingOrigin,head,async()=>new Response(new ReadableStream({pull(controller){if(chunks.length)controller.enqueue(new TextEncoder().encode(chunks.shift()));else controller.close();}}))),head);
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

test('deployment revalidation requires a fresh server observation of the original exact authorization',async()=>{
 const now=1900000000000,run={id:'run-1',attempt:2,generation:3},authorization={id:'authorization-1',request:'request-1',run:run.id,attempt:run.attempt,generation:run.generation,environmentId:'staging',issuedAt:now-60000,expiresAt:now+60000};
 const api=async(path,body)=>{assert.equal(path,'/deployments/revalidate');assert.deepEqual(body,{requestId:authorization.request,authorizationId:authorization.id,attempt:run.attempt});return {authorization,checkedAt:now};};
 assert.deepEqual(await revalidateEnvironment(api,run,authorization,{now:()=>now}),{...authorization,checkedAt:now});
 for(const result of [{authorization},{authorization,checkedAt:now-30001},{authorization,checkedAt:now+1001},{authorization:{...authorization,attempt:3},checkedAt:now}])await assert.rejects(revalidateEnvironment(async()=>result,run,authorization,{now:()=>now}),/stale or changed/);
 await assert.rejects(revalidateEnvironment(async()=>{throw Error('revoked');},run,authorization,{now:()=>now}),/revoked/);
 await assert.rejects(revalidateEnvironment(api,{...run,attempt:3},authorization,{now:()=>now}),/exact deployment authorization/);
});
