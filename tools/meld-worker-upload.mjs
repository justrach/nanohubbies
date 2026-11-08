/** Trusted Cloudflare transport. Artifact bytes are never imported, evaluated or
 * passed to Wrangler on the credentialed controller. Upload and staging traffic
 * promotion are separate operations. Neither edits routes, cron or schemas. */
import {createHash,randomUUID} from 'node:crypto';
import {open,readFile,rename,realpath} from 'node:fs/promises';
import {isAbsolute,join,posix} from 'node:path';
import blake3 from 'blake3-wasm';
import ignore from 'ignore';
import mime from 'mime-types';
import {loadMeldStagePackage} from './meld-stage-artifact.mjs';
import {meldPackageProfile} from './meld-stage-package.mjs';

export const meldUploadTarget=Object.freeze({account:'f2f0af76a1c41021ea3c7f4cc9a78a4b',script:'meld-api-staging',origin:'https://staging.meld.space'});
const apiOrigin='https://api.cloudflare.com/client/v4';
const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const uuid=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);
const pathOK=value=>typeof value==='string'&&value.length>0&&Buffer.byteLength(value)<=1024&&!/[\\\x00-\x1f\x7f]/.test(value)&&value.split('/').length<=32&&value.split('/').every(p=>p&&p!=='.'&&p!=='..');
const controls=new Set(['_headers','_redirects','.assetsignore','_worker.js','_routes.json']);
const moduleTypes=new Set(['application/javascript+module','application/wasm','text/plain','application/octet-stream']);
const plans=new WeakMap();
const uploads=new WeakMap();
const text=(bytes,max)=>{if(bytes.length>max||Buffer.from(bytes.toString('utf8')).compare(bytes)!==0||bytes.includes(0))throw Error('Invalid asset control file');return bytes.toString('utf8');};

/** /settings follows the latest upload. Our new version changes its annotations,
 * but must preserve the actual resource configuration. Uploaded/deployed version
 * IDs are fenced separately, so excluding annotations cannot admit another head. */
export function meldSettingsFingerprint(settings) {
 if(!settings||typeof settings!=='object'||Array.isArray(settings)||!Array.isArray(settings.bindings))throw Error('Invalid Cloudflare Worker settings');
 const {annotations,...resources}=settings;return sha(canonical(resources));
}

/** The metadata is an operator-reviewed deployment profile, never a candidate
 * config. The baseline digest must come from a separately inspected live target. */
function metadataProfile(metadata) {
 const allowed=new Set(['bindings','compatibility_date','compatibility_flags','limits','cache_options','keep_bindings']);
 if(!metadata||Array.isArray(metadata)||Object.keys(metadata).some(k=>!allowed.has(k))||metadata.compatibility_date!==meldPackageProfile.compatibilityDate||JSON.stringify(metadata.compatibility_flags)!==JSON.stringify(meldPackageProfile.compatibilityFlags)||JSON.stringify(metadata.keep_bindings)!=='["secret_text","secret_key"]'||!Array.isArray(metadata.bindings)||metadata.bindings.length>200)throw Error('Unapproved Meld upload metadata');
 const bindings=new Map();
 for(const binding of metadata.bindings) {
  if(!binding||typeof binding.name!=='string'||!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(binding.name)||bindings.has(binding.name)||typeof binding.type!=='string'||['inherit','secret_text','secret_key'].includes(binding.type))throw Error('Meld upload refuses inherited or plaintext secret bindings');
  bindings.set(binding.name,binding);
 }
 if(bindings.get('ASSETS')?.type!=='assets'||bindings.get('WORKER_SELF_REFERENCE')?.type!=='service'||bindings.get('WORKER_SELF_REFERENCE')?.service!==meldUploadTarget.script||bindings.get('HYPERDRIVE')?.type!=='hyperdrive'||bindings.get('HYPERDRIVE')?.id!=='98c214c675a34f49a2f31975b182a544'||bindings.get('MELD_ENV')?.type!=='plain_text'||bindings.get('MELD_ENV')?.text!=='staging')throw Error('Meld upload requires the isolated staging bindings');
 if(canonical(metadata).includes('25063547c66d4a679041a08bd1f1fc2c'))throw Error('Production Hyperdrive is forbidden');
 for(const name of ['BETTER_AUTH_URL','NEXT_PUBLIC_APP_URL'])if(bindings.get(name)?.type!=='plain_text'||bindings.get(name)?.text!==meldUploadTarget.origin)throw Error('Meld upload requires staging application origins');
 return JSON.parse(JSON.stringify(metadata));
}

export async function prepareMeldWorkerUpload(context,profile,{load=loadMeldStagePackage}={}) {
 if(profile?.account!==meldUploadTarget.account||profile?.script!==meldUploadTarget.script)throw Error('Only the fixed Meld staging target is supported');
 const metadata=metadataProfile(profile.metadata),artifact=await load(context),modules=[];
 if(artifact.descriptor?.profile!==meldPackageProfile.id||artifact.descriptor.head!==context.run.head||!/^[a-f0-9]{64}$/.test(artifact.manifestSha256??''))throw Error('Unverified Meld staging artifact');
 let total=0;const names=new Set();
 for(const item of artifact.modules) {
  const name=item.path?.slice('modules/'.length);
  if(!item.path?.startsWith('modules/')||!pathOK(name)||controls.has(name)||name==='metadata'||names.has(name)||!moduleTypes.has(item.contentType))throw Error('Invalid Worker multipart module');
  const bytes=await artifact.read(item.path);if(bytes.length!==item.bytes||sha(bytes)!==item.sha256||(total+=bytes.length)>64*1024*1024)throw Error('Worker module bytes changed or exceed the upload bound');
  modules.push({name,contentType:item.contentType,bytes});names.add(name);
 }
 const main=artifact.descriptor.mainModule?.slice('modules/'.length);
 if(!names.has(main))throw Error('The Worker entrypoint is absent');
 const assets=new Map();
 for(const item of artifact.assets) {
  const name=item.path?.slice('assets/'.length);
  if(!item.path?.startsWith('assets/')||!pathOK(name)||assets.has(name)||!Number.isSafeInteger(item.bytes)||item.bytes<0||item.bytes>25*1024*1024)throw Error('Invalid Worker asset');
  const bytes=await artifact.read(item.path);if(bytes.length!==item.bytes||sha(bytes)!==item.sha256||(total+=bytes.length)>128*1024*1024)throw Error('Worker asset bytes changed or exceed the upload bound');
  assets.set(name,bytes);
 }
 if(assets.size>10000)throw Error('Too many Worker assets');
 const patterns=['/.assetsignore','/_headers','/_redirects'];
 if(assets.has('.assetsignore'))patterns.push(...text(assets.get('.assetsignore'),65536).split('\n'));
 const excluded=ignore().add(patterns),manifest=Object.create(null),byHash=new Map();
 for(const [name,bytes] of assets) {
  if(excluded.ignores(name))continue;
  if(name==='_worker.js'||name==='_routes.json')throw Error('Pages-specific asset controls require explicit migration');
  if(controls.has(name))continue;
  // Match Wrangler's content+extension hash. MIME comes from pinned mime-types;
  // bytes stay opaque and are base64 encoded only for the upload protocol.
  const hash=blake3.hash(bytes.toString('base64')+posix.extname(name).slice(1)).toString('hex').slice(0,32);
  const type=mime.contentType(mime.lookup(name)||'application/null')||'application/null';
  const previous=byHash.get(hash);if(previous&&(previous.bytes.compare(bytes)!==0||previous.contentType!==type))throw Error('Ambiguous asset content hash');
  manifest['/'+name]={hash,size:bytes.length};byHash.set(hash,{bytes,contentType:type});
 }
 if(!Object.keys(manifest).length)throw Error('The deployable asset manifest is empty');
 const assetConfig={run_worker_first:true};
 for(const name of ['_headers','_redirects'])if(assets.has(name))assetConfig[name]=text(assets.get(name),2*1024*1024);
 const summary=Object.freeze({binding:Object.freeze({...artifact.binding}),manifestSha256:artifact.manifestSha256,metadataSha256:sha(canonical(metadata)),assetManifestSha256:sha(canonical(manifest)),assetCount:Object.keys(manifest).length,moduleCount:modules.length,bytes:total});
 plans.set(summary,{...summary,metadata,main,modules,assetConfig,byHash,assetManifest:manifest});return summary;
}

async function responseJSON(response) {
 const reader=response.body?.getReader();if(!reader)throw Error('Empty Cloudflare upload response');
 let size=0;const chunks=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;if((size+=value.length)>2*1024*1024)throw Error('Cloudflare response exceeded its bound');chunks.push(value);}}
 finally{await reader.cancel().catch(()=>{});}
 let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('Invalid Cloudflare upload response');}
 if(!response.ok||data.success!==true||!data.result)throw Error(`Cloudflare upload request failed (${response.status})`);
 return data.result;
}

/** No automatic mutation retry, including asset requests. An uncertain result
 * remains in the private receipt for inspection; it never creates a new attempt.
 * The returned version is NOT deployed. Traffic promotion is a separate gate. */
export async function uploadMeldStageVersion(context,plan,profile,{credential,authorize,fetcher=fetch,now=Date.now}={}) {
 if(!plans.has(plan)||profile?.account!==meldUploadTarget.account||profile?.script!==meldUploadTarget.script||sha(canonical(metadataProfile(profile.metadata)))!==plan.metadataSha256||typeof credential!=='function'||typeof authorize!=='function'||!context.run?.deploymentApprovedBy||!isAbsolute(context.artifacts??'')||typeof profile.environmentId!=='string'||!profile.environmentId)throw Error('Trusted upload context and staging authorization are required');
 plan=plans.get(plan);
 const base=JSON.parse(JSON.stringify(profile.baseline??{}));
 if(!uuid(base?.deploymentId)||!uuid(base?.versionId)||!/^[a-f0-9]{64}$/.test(base?.settingsSha256??''))throw Error('An inspected staging deployment baseline is required');
 const binding={runId:context.run.id,attempt:context.run.attempt,head:context.run.head,base:context.run.base,artifactSha256:plan.manifestSha256,metadataSha256:plan.metadataSha256,target:meldUploadTarget,baseline:base};
 if(!uuid(binding.runId)||!Number.isSafeInteger(binding.attempt)||binding.attempt<1||!/^[a-f0-9]{40}$/.test(binding.head??'')||!/^[a-f0-9]{40}$/.test(binding.base??''))throw Error('Invalid upload attempt identity');
 if(plan.binding.runId!==binding.runId||plan.binding.attempt!==binding.attempt||plan.binding.head!==binding.head||plan.binding.base!==binding.base)throw Error('Upload artifact belongs to another attempt');
 const artifacts=await realpath(context.artifacts),source=await realpath(context.source);
 if(artifacts===source||artifacts.startsWith(source+'/'))throw Error('Keep upload receipts outside candidate execution');
 const receiptPath=join(artifacts,'meld-worker-upload.json');
 let prior;try{prior=await readFile(receiptPath,'utf8');}catch(error){if(error.code!=='ENOENT')throw Error('Upload receipt cannot be inspected');}
 if(prior!==undefined)throw Error('This upload already has an intent; inspect it without replaying provider writes');
 const receipt={format:1,binding,state:'prepared',startedAt:now(),phase:'preflight',requests:[]};
 const syncDirectory=async()=>{const directory=await open(artifacts,'r');try{await directory.sync();}finally{await directory.close();}};
 const save=async()=>{
  const temporary=receiptPath+'.'+randomUUID()+'.tmp',file=await open(temporary,'wx',0o600);
  try{await file.writeFile(JSON.stringify(receipt,null,2)+'\n');await file.sync();}finally{await file.close();}
  await rename(temporary,receiptPath);await syncDirectory();
 };
 let handle;try{handle=await open(receiptPath,'wx',0o600);await handle.writeFile(JSON.stringify(receipt,null,2)+'\n');await handle.sync();}finally{await handle?.close();}
 await syncDirectory();
 const request=async(path,{method='GET',body,token}={})=>{
  const auth=token??await credential();if(typeof auth!=='string'||auth.length<10||/[\r\n]/.test(auth))throw Error('Cloudflare upload credential is unavailable');
  let entry;
  if(method!=='GET') {
   const grant=await authorize();
   if(!grant||grant.run!==context.run.id||grant.attempt!==context.run.attempt||grant.generation!==(context.run.generation??1)||grant.environmentId!==profile.environmentId||typeof grant.id!=='string'||!Number.isFinite(grant.issuedAt)||!Number.isFinite(grant.checkedAt)||grant.checkedAt>now()+1000||grant.issuedAt>grant.checkedAt||now()-grant.checkedAt>30000||!Number.isFinite(grant.expiresAt)||grant.expiresAt<=now()+30000)throw Error('A fresh server-issued staging authorization is required');
   entry={method,path,authorizationId:grant.id,startedAt:now(),state:'pending'};receipt.requests.push(entry);receipt.state='uploading';await save();
  }
  try {
   const response=await fetcher(apiOrigin+path,{method,redirect:'error',headers:{Authorization:'Bearer '+auth,...(typeof body==='string'?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body}:{}),signal:AbortSignal.timeout(30000)});
   const result=await responseJSON(response);if(entry){entry.state='acknowledged';entry.finishedAt=now();if(uuid(result.id))entry.providerId=result.id;await save();}return result;
  }catch{if(entry){entry.state='unconfirmed';await save();}throw Error(`Cloudflare ${method==='GET'?'observation':'upload'} failed; no provider write was replayed`);}
 };
 const root=`/accounts/${meldUploadTarget.account}/workers/scripts/${meldUploadTarget.script}`;
 const resources=values=>canonical([...values].sort((a,b)=>a.name.localeCompare(b.name)));
 const secrets=values=>resources(values.filter(b=>['secret_text','secret_key'].includes(b.type)).map(b=>({name:b.name,type:b.type})));
 let secretInventory;
 const baseline=async(latestVersion=base.versionId)=>{
  const settings=await request(root+'/settings'),deployments=await request(root+'/deployments'),versions=await request(root+'/versions');
  const current=deployments.deployments?.[0];
  if(meldSettingsFingerprint(settings)!==base.settingsSha256||current?.id!==base.deploymentId||current.versions?.length!==1||current.versions[0].version_id!==base.versionId||current.versions[0].percentage!==100||versions.items?.[0]?.id!==latestVersion)throw Error('Staging changed since its operator-reviewed baseline');
  // Never replace a live non-secret binding with a reviewed-but-different
  // profile. Provider schema differences fail closed until explicitly handled.
  if(!Array.isArray(settings.bindings)||resources(settings.bindings.filter(b=>!['secret_text','secret_key'].includes(b.type)))!==resources(plan.metadata.bindings))throw Error('Upload metadata would change existing staging bindings');
  for(const key of ['compatibility_date','compatibility_flags','limits','cache_options'])if(canonical(settings[key])!==canonical(plan.metadata[key]))throw Error('Upload metadata would change existing staging runtime settings');
  secretInventory=secrets(settings.bindings);
 };
 const verifyUploaded=async versionId=>{
  const uploaded=await request(root+'/versions/'+versionId),bindings=uploaded.resources?.bindings?.result??uploaded.resources?.bindings,runtime=uploaded.resources?.script_runtime;
  if(uploaded.id!==versionId||!Array.isArray(bindings)||secrets(bindings)!==secretInventory||resources(bindings.filter(b=>!['secret_text','secret_key'].includes(b.type)))!==resources(plan.metadata.bindings))throw Error('Uploaded Worker bindings do not match the inspected staging target');
  for(const key of ['compatibility_date','compatibility_flags','limits'])if(canonical(runtime?.[key])!==canonical(plan.metadata[key]))throw Error('Uploaded Worker runtime does not match its reviewed profile');
 };
 try {
  await baseline();receipt.phase='asset-session';await save();
  const session=await request(root+'/assets-upload-session',{method:'POST',body:JSON.stringify({manifest:plan.assetManifest})});
  if(typeof session.jwt!=='string'||session.jwt.length<10||session.jwt.length>16384||!Array.isArray(session.buckets)||session.buckets.length>10000)throw Error('Invalid Cloudflare asset upload session');
  const seen=new Set();
  for(const bucket of session.buckets) {
   if(!Array.isArray(bucket)||!bucket.length||bucket.length>10000)throw Error('Invalid Cloudflare asset upload bucket');
   for(const hash of bucket)if(typeof hash!=='string'||!plan.byHash.has(hash)||seen.has(hash))throw Error('Cloudflare requested an unknown or duplicate asset');else seen.add(hash);
  }
  let completion=session.buckets.length?null:session.jwt;
  receipt.phase='assets';await save();
  for(const bucket of session.buckets) {
   const body=new FormData();
   for(const hash of bucket){const asset=plan.byHash.get(hash);body.append(hash,new Blob([asset.bytes.toString('base64')],{type:asset.contentType}),hash);}
   const result=await request(`/accounts/${meldUploadTarget.account}/workers/assets/upload?base64=true`,{method:'POST',body,token:session.jwt});
   if(result.jwt!==undefined){if(typeof result.jwt!=='string'||!result.jwt||result.jwt.length>16384)throw Error('Invalid Cloudflare asset completion token');completion=result.jwt;}
  }
  if(!completion)throw Error('Cloudflare did not confirm asset completion');
  // Asset uploads do not authorize resource changes or traffic promotion. Check
  // the live target again immediately before the version mutation.
  await baseline();receipt.phase='version';await save();
  const body=new FormData(),metadata={...plan.metadata,main_module:plan.main,assets:{jwt:completion,config:plan.assetConfig},annotations:{'workers/message':`Nanohub ${context.run.head}`}};
  body.append('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));
  for(const module of plan.modules)body.append(module.name,new Blob([module.bytes],{type:module.contentType}),module.name);
  const version=await request(root+'/versions',{method:'POST',body});
  if(!uuid(version.id))throw Error('Cloudflare did not acknowledge a valid Worker version');
  receipt.versionId=version.id;receipt.phase='verify-upload';await save();
  await verifyUploaded(version.id);
  receipt.state='uploaded';receipt.finishedAt=now();await save();
  const summary=Object.freeze({versionId:version.id,target:meldUploadTarget,head:context.run.head,artifactSha256:plan.manifestSha256,receipt:receiptPath,deployed:false});
  const observe=async()=>{
   if(!receipt.deploymentId)throw Error('No acknowledged staging deployment is available');
   const deployment=(await request(root+'/deployments')).deployments?.[0];
   if(deployment?.id!==receipt.deploymentId||deployment.versions?.length!==1||deployment.versions[0].version_id!==version.id||deployment.versions[0].percentage!==100)throw Error('Staging no longer serves the exact acknowledged Worker version');
   await verifyUploaded(version.id);
   return {runId:receipt.deploymentId,versionId:version.id,candidate:binding.head,state:'success',kind:'deployment',verifiedAt:now()};
  };
  uploads.set(summary,{started:false,observe,promote:async()=>{
   // An acknowledged upload is not permission to replace a newer deployment.
   // Compare the private receipt too, before overwriting any local evidence.
   const disk=JSON.parse(await readFile(receiptPath,'utf8'));
   if(canonical(disk)!==canonical(receipt)||receipt.state!=='uploaded')throw Error('Staging upload intent changed; inspect it before promotion');
   receipt.phase='promotion-preflight';receipt.promotionStartedAt=now();await save();
   try {
    await baseline(version.id);await verifyUploaded(version.id);
    receipt.phase='promotion';await save();
    const deployed=await request(root+'/deployments',{method:'POST',body:JSON.stringify({strategy:'percentage',versions:[{version_id:version.id,percentage:100}],annotations:{'workers/message':`Nanohub ${binding.head}`}})});
    if(!uuid(deployed.id))throw Error('Cloudflare did not acknowledge a valid staging deployment');
    receipt.deploymentId=deployed.id;receipt.phase='verify-deployment';await save();
    const observed=await observe();receipt.state='deployed';receipt.promotionFinishedAt=now();await save();return {...observed,head:binding.head,target:meldUploadTarget,deployed:true};
   }catch(error){receipt.state=receipt.requests.some(r=>r.path===root+'/deployments')?'promotion-unverified':'promotion-failed';receipt.promotionFinishedAt=now();await save();throw error;}
  }});
  return summary;
 }catch(error){receipt.state=receipt.requests.some(r=>r.state==='unconfirmed')?'unconfirmed':'failed';receipt.finishedAt=now();await save();throw error;}
}

/** Explicit second operation, with another live baseline and authority check.
 * This never performs an automatic rollback or retries a traffic mutation. */
export async function promoteMeldStageVersion(upload) {
 const operation=uploads.get(upload);if(!operation||operation.started)throw Error('A verified, unused upload is required for staging promotion');
 operation.started=true;return operation.promote();
}

export async function observeMeldStageDeployment(upload) {
 const operation=uploads.get(upload);if(!operation)throw Error('An acknowledged upload from this controller is required');
 return operation.observe();
}
