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
  if(!acceptance){const module=await loadAcceptance(path);if(typeof module.accept!=='function')throw Error('The trusted acceptance module must export accept');acceptance={path,accept:module.accept};}
  return acceptance.accept;
 };
 const binding=context=>JSON.stringify({id:context.run.id,attempt:context.run.attempt,head:context.run.head,base:context.run.base,authorizationId:context.deploymentAuthorization?.id});
 return {
  versionPrefixLength:7,
  async dispatch(context) {
   await ready(context);
   const identity=binding(context);
   if(started.has(identity))throw Error('This staging attempt has already dispatched; inspect its private receipt');started.add(identity);
   const plan=await prepare(context,profile),uploaded=await upload(context,plan,profile,{credential,authorize:context.authorizeDeployment,fetcher,now}),deployment=await promote(uploaded);
   if(!deployment.deployed||deployment.kind!=='deployment'||deployment.candidate!==context.run.head||typeof deployment.runId!=='string'||!deployment.runId)throw Error('The exact staging deployment was not acknowledged');
   dispatched.set(deployment.runId,{binding:identity,uploaded,head:context.run.head});return {runId:deployment.runId};
  },
  async wait(runId,head) {
   const attempt=dispatched.get(runId);if(!attempt||attempt.head!==head)throw Error('Observe only this controller\'s exact acknowledged staging deployment');
   const result=await observe(attempt.uploaded);if(result.runId!==runId||result.candidate!==head||result.state!=='success'||result.kind!=='deployment')throw Error('Staging deployment changed before acceptance');return result;
  },
  async accept(context) {
   const attempt=dispatched.get(context.deployRunId);if(!attempt||attempt.binding!==binding(context))throw Error('Acceptance requires the same run, source, attempt and authorization');
   return (await ready(context))(context);
  },
 };
}
