import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createMeldNativeStagingAdapter} from '../../../tools/meld-native-staging-adapter.mjs';
import {stagingGate} from '../../../tools/ci-runner.mjs';
import {meldUploadTarget} from '../../../tools/meld-worker-upload.mjs';

async function fixture(work) {
 const directory=await realpath(await mkdtemp(join(tmpdir(),'nh-native-adapter-'))),source=join(directory,'candidate'),module=join(directory,'acceptance.mjs');await mkdir(source);await writeFile(module,'export async function accept(){throw Error("DI fixture must not run this module")}');
 const run={id:'run-1',attempt:1,head:'a'.repeat(40),base:'b'.repeat(40),deploymentApprovedBy:'owner'},context={run,source,artifacts:join(directory,'private'),stagingOrigin:meldUploadTarget.origin,deploymentAuthorization:{id:'authorization-1'},authorizeDeployment:async()=>({id:'fresh-authority'})};
 const calls=[],plan={},uploaded={},deployment={runId:'deployment-1',versionId:'version-1',candidate:run.head,state:'success',kind:'deployment',deployed:true},profile={...meldUploadTarget};let acceptance=[{url:meldUploadTarget.origin+'/real-service-evidence',realService:true}],observed=deployment;
 const options={profile,credential:async()=>'private-fixture-token',acceptanceModule:module};
 const dependencies={prepare:async(c,p)=>{calls.push('prepare');assert.equal(c,context);assert.equal(p,profile);return plan;},upload:async(c,p,pr,d)=>{calls.push('upload');assert.equal(c,context);assert.equal(p,plan);assert.equal(pr,profile);assert.equal(d.authorize,context.authorizeDeployment);return uploaded;},promote:async u=>{calls.push('promote');assert.equal(u,uploaded);return deployment;},observe:async u=>{calls.push('observe');assert.equal(u,uploaded);return observed;},loadAcceptance:async path=>{calls.push('load-acceptance');assert.equal(path,module);return {accept:async c=>{calls.push('accept');assert.equal(c.run,run);return acceptance;}};}};
 // stagingGate passes a context copy into dispatch, so check its contents there.
 dependencies.prepare=async(c,p)=>{calls.push('prepare');assert.equal(c.run,run);assert.equal(c.authorizeDeployment,context.authorizeDeployment);assert.equal(p,profile);return plan;};
 dependencies.upload=async(c,p,pr,d)=>{calls.push('upload');assert.equal(c.run,run);assert.equal(p,plan);assert.equal(pr,profile);assert.equal(d.authorize,context.authorizeDeployment);return uploaded;};
 try{await work({directory,context,module,options,dependencies,calls,profile,deployment,setAcceptance:value=>{acceptance=value;},setObserved:value=>{observed=value;},make:()=>createMeldNativeStagingAdapter(options,dependencies)});}
 finally{await rm(directory,{recursive:true,force:true});}
}

test('native staging adapter requires real acceptance configuration before uploading or promoting, and verifies exact provider identity',async()=>fixture(async f=>{
 const adapter=f.make(),versions=[];
 const result=await stagingGate(adapter,f.context,async url=>{versions.push(String(url));return Response.json({buildId:f.context.run.head.slice(0,7)});});
 assert.equal(result.head,f.context.run.head);assert.equal(result.observedBuildId,f.context.run.head.slice(0,7));assert.equal(result.acceptance[0].realService,true);assert.equal(versions.length,2);
 assert.deepEqual(f.calls,['load-acceptance','prepare','upload','promote','observe','accept','observe']);
 await assert.rejects(adapter.dispatch(f.context),/already dispatched/);await assert.rejects(adapter.wait('foreign-deployment',f.context.run.head),/exact acknowledged/);await assert.rejects(adapter.wait('deployment-1','c'.repeat(40)),/exact acknowledged/);
 await assert.rejects(adapter.accept({...f.context,run:{...f.context.run,attempt:2},deployRunId:'deployment-1'}),/same run/);
}));

test('missing or candidate-controlled acceptance modules and unapproved targets stop before provider work',async()=>{
 await fixture(async f=>{f.options.acceptanceModule=join(f.context.source,'acceptance.mjs');await writeFile(f.options.acceptanceModule,'candidate-controlled');await assert.rejects(f.make().dispatch(f.context),/outside candidate/);assert.deepEqual(f.calls,[]);});
 await fixture(async f=>{f.options.acceptanceModule=join(f.directory,'absent.mjs');await assert.rejects(f.make().dispatch(f.context),{code:'ENOENT'});assert.deepEqual(f.calls,[]);});
 await fixture(async f=>{const adapter=createMeldNativeStagingAdapter(f.options,{...f.dependencies,loadAcceptance:async()=>({})});await assert.rejects(adapter.dispatch(f.context),/must export accept/);assert.deepEqual(f.calls,[]);});
 for(const patch of [{stagingOrigin:'https://meld.space'},{run:null},{authorizeDeployment:undefined}])await fixture(async f=>{await assert.rejects(f.make().dispatch({...f.context,...patch}),/exact staging target/);assert.deepEqual(f.calls,[]);});
 await fixture(async f=>{f.profile.script='meld-api';assert.throws(f.make,/fixed staging target/);});
});

test('failed promotion, stale provider observations, mocked acceptance and a moved build never count as staging success',async()=>{
 await fixture(async f=>{const adapter=createMeldNativeStagingAdapter(f.options,{...f.dependencies,promote:async()=>({...f.deployment,candidate:'c'.repeat(40)})});await assert.rejects(adapter.dispatch(f.context),/exact staging deployment/);assert.ok(!f.calls.includes('accept'));await assert.rejects(adapter.dispatch(f.context),/already dispatched/);});
 await fixture(async f=>{f.setObserved({...f.deployment,runId:'different'});await assert.rejects(stagingGate(f.make(),f.context,async()=>Response.json({buildId:f.context.run.head.slice(0,7)})),/changed before acceptance/);assert.ok(!f.calls.includes('accept'));});
 await fixture(async f=>{f.setAcceptance([{url:meldUploadTarget.origin,realService:false}]);await assert.rejects(stagingGate(f.make(),f.context,async()=>Response.json({buildId:f.context.run.head.slice(0,7)})),/Real-service/);});
 await fixture(async f=>{let reads=0;await assert.rejects(stagingGate(f.make(),f.context,async()=>Response.json({buildId:++reads===1?f.context.run.head.slice(0,7):'ccccccc'})),/version mismatch/);assert.equal(reads,2);});
});


test('acceptance preflight refuses unavailable configuration before any upload and scrubs resolver errors',async()=>{
 for(const mode of ['success','failed','malformed'])await fixture(async f=>{
  const dependencies={...f.dependencies,loadAcceptance:async()=>({accept:async()=>[],preflight:mode==='malformed'?true:async c=>{f.calls.push('preflight');assert.equal(c.run,f.context.run);if(mode==='failed')throw Error('testtesttesttest');}})};
  const adapter=createMeldNativeStagingAdapter(f.options,dependencies);
  if(mode==='success'){await adapter.dispatch(f.context);assert.deepEqual(f.calls,['preflight','prepare','upload','promote']);}
  else{await assert.rejects(adapter.dispatch(f.context),error=>/preflight/.test(error.message)&&!error.message.includes('testtesttesttest'));assert.ok(!f.calls.includes('prepare'));assert.ok(!f.calls.includes('upload'));}
 });
});

test('a deployment changed during acceptance cannot pass even with an unchanged candidate build ID',async()=>{
 for(const patch of [{runId:'new-deployment'},{versionId:'new-version'},{candidate:'c'.repeat(40)},{kind:'checks'},{state:'failed'}])await fixture(async f=>{
  const dependencies={...f.dependencies,loadAcceptance:async()=>({accept:async()=>{f.setObserved({...f.deployment,...patch});return [{url:meldUploadTarget.origin+'/real-service-evidence',realService:true}];}})};
  await assert.rejects(stagingGate(createMeldNativeStagingAdapter(f.options,dependencies),f.context,async()=>Response.json({buildId:f.context.run.head.slice(0,7)})),/changed during acceptance/);
  assert.equal(f.calls.filter(call=>call==='observe').length,2);
 });
});

test('revoked authority during acceptance and missing version acknowledgements cannot pass',async()=>{
 await fixture(async f=>{
  f.context.authorizeDeployment=async()=>{throw Error('Authorization revoked');};
  await assert.rejects(stagingGate(f.make(),f.context,async()=>Response.json({buildId:f.context.run.head.slice(0,7)})),/Authorization revoked/);
  assert.equal(f.calls.filter(call=>call==='observe').length,1);
 });
 await fixture(async f=>{
  const adapter=createMeldNativeStagingAdapter(f.options,{...f.dependencies,promote:async()=>({...f.deployment,versionId:undefined})});
  await assert.rejects(adapter.dispatch(f.context),/exact staging deployment/);assert.ok(!f.calls.includes('accept'));
 });
});
