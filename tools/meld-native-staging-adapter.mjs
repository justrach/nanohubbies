/** Trusted adapter configuration lives outside the candidate checkout. */
import {realpath} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {prepareMeldWorkerUpload,uploadMeldStageVersion,promoteMeldStageVersion,observeMeldStageDeployment,meldUploadTarget} from './meld-worker-upload.mjs';

export function createMeldNativeStagingAdapter({profile,credential,acceptanceModule,fetcher=fetch,now=Date.now},{prepare=prepareMeldWorkerUpload,upload=uploadMeldStageVersion,promote=promoteMeldStageVersion,observe=observeMeldStageDeployment,loadAcceptance=path=>import(pathToFileURL(path).href)}={}) {
 if(profile?.account!==meldUploadTarget.account||profile?.script!==meldUploadTarget.script||typeof credential!=='function'||!isAbsolute(acceptanceModule??''))throw Error('Configure the fixed staging target and a trusted real-service acceptance module');
 const dispatched=new Map(),started=new Set();let acceptance;
 const ready=async context=>{
  if(context.stagingOrigin!==meldUploadTarget.origin||!context.run?.deploymentApprovedBy||typeof context.authorizeDeployment!=='function')throw Error('The exact staging target and live server authorization are required');
  const source=await realpath(context.source),path=await realpath(acceptanceModule);
  if(path===source||path.startsWith(source+'/'))throw Error('Keep the acceptance module outside candidate execution');
  if(acceptance&&acceptance.path!==path)throw Error('The trusted acceptance module changed during this attempt');
  if(!acceptance){const module=await loadAcceptance(path);if(typeof module.accept!=='function'||module.preflight!==undefined&&typeof module.preflight!=='function')throw Error('The trusted acceptance module must export accept and an optional preflight function');acceptance={path,accept:module.accept,preflight:module.preflight};}
  return acceptance;
 };
 const binding=context=>JSON.stringify({id:context.run.id,attempt:context.run.attempt,head:context.run.head,base:context.run.base,authorizationId:context.deploymentAuthorization?.id});
 return {
  versionPrefixLength:7,
  async dispatch(context) {
   const module=await ready(context);
   // Missing live-test configuration must fail before any provider write.
   // A resolver may include a credential in its exception; keep that private.
   try{await module.preflight?.(context);}catch{throw Error('Trusted real-service acceptance preflight failed');}
   const identity=binding(context);
   if(started.has(identity))throw Error('This staging attempt has already dispatched; inspect its private receipt');started.add(identity);
   const plan=await prepare(context,profile),uploaded=await upload(context,plan,profile,{credential,authorize:context.authorizeDeployment,fetcher,now}),deployment=await promote(uploaded);
   if(!deployment.deployed||deployment.kind!=='deployment'||deployment.candidate!==context.run.head||typeof deployment.runId!=='string'||!deployment.runId||typeof deployment.versionId!=='string'||!deployment.versionId)throw Error('The exact staging deployment was not acknowledged');
   dispatched.set(deployment.runId,{binding:identity,uploaded,head:context.run.head,versionId:deployment.versionId});return {runId:deployment.runId};
  },
  async wait(runId,head) {
   const attempt=dispatched.get(runId);if(!attempt||attempt.head!==head)throw Error('Observe only this controller\'s exact acknowledged staging deployment');
   const result=await observe(attempt.uploaded);if(result.runId!==runId||result.versionId!==attempt.versionId||result.candidate!==head||result.state!=='success'||result.kind!=='deployment')throw Error('Staging deployment changed before acceptance');return result;
  },
  async accept(context) {
   const attempt=dispatched.get(context.deployRunId);if(!attempt||attempt.binding!==binding(context))throw Error('Acceptance requires the same run, source, attempt and authorization');
   const verifyDeployment=async()=>{
    const current=await observe(attempt.uploaded);
    if(current.runId!==context.deployRunId||current.versionId!==attempt.versionId||current.candidate!==attempt.head||current.state!=='success'||current.kind!=='deployment')throw Error('Staging deployment changed during acceptance');
    return current;
   };
   const result=await (await ready(context)).accept({...context,verifyDeployment});
   await context.authorizeDeployment();
   // A settings-only deployment can retain the same public build prefix.
   // Recheck exact provider deployment/version identity after real services run.
   await verifyDeployment();
   return result;
  },
 };
}
