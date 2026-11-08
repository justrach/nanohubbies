import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import blake3 from 'blake3-wasm';
import {prepareMeldWorkerUpload,uploadMeldStageVersion,promoteMeldStageVersion,observeMeldStageDeployment,meldUploadTarget} from '../../../tools/meld-worker-upload.mjs';
import {meldPackageProfile} from '../../../tools/meld-stage-package.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const accountToken='private-control-credential-fixture',uploadToken='private-upload-session-fixture',completionToken='private-completion-fixture';
const now=()=>1900000000000;
async function fixture(work) {
 const directory=await mkdtemp(join(tmpdir(),'nh-worker-upload-')),source=join(directory,'source'),artifacts=join(directory,'artifacts');
 await mkdir(source);await mkdir(artifacts);
 const run={id:randomUUID(),attempt:1,generation:1,head:'a'.repeat(40),base:'b'.repeat(40),deploymentApprovedBy:'owner'},context={run,source,artifacts};
 const metadata={compatibility_date:meldPackageProfile.compatibilityDate,compatibility_flags:meldPackageProfile.compatibilityFlags,keep_bindings:['secret_text','secret_key'],limits:{cpu_ms:30000},cache_options:{enabled:false},bindings:[
  {type:'assets',name:'ASSETS'},{type:'service',name:'WORKER_SELF_REFERENCE',service:meldUploadTarget.script},{type:'hyperdrive',name:'HYPERDRIVE',id:'98c214c675a34f49a2f31975b182a544'},
  {type:'plain_text',name:'MELD_ENV',text:'staging'},...['BETTER_AUTH_URL','NEXT_PUBLIC_APP_URL'].map(name=>({type:'plain_text',name,text:meldUploadTarget.origin})),
 ]};
 const settings={...structuredClone(metadata),observability:{enabled:true},bindings:[...structuredClone(metadata.bindings),{type:'secret_text',name:'SERVER_SECRET'},{type:'secret_key',name:'CRYPTO_KEY'}]};delete settings.keep_bindings;
 const profile={...meldUploadTarget,environmentId:'env-staging',metadata,baseline:{deploymentId:randomUUID(),versionId:randomUUID(),settingsSha256:sha(canonical(settings))}};
 const bytes=new Map([
  ['modules/worker.js',Buffer.from('export default {fetch(){return new Response("fixture")}}')],['modules/worker.wasm',Buffer.from([0,97,115,109,1,0,0,0])],
  ['assets/index.html',Buffer.from('<h1>fixture</h1>')],['assets/file.bin',Buffer.from([0,255,1,128])],['assets/same.bin',Buffer.from([0,255,1,128])],
  ['assets/private.env',Buffer.from('not-an-asset')],['assets/_headers',Buffer.from('/api/*\n  Cache-Control: no-store\n')],['assets/_redirects',Buffer.from('/old /new 302\n')],['assets/.assetsignore',Buffer.from('private.env\n')],
 ]);
 const item=path=>({path,bytes:bytes.get(path).length,sha256:sha(bytes.get(path))});
 const artifact={binding:{runId:run.id,attempt:run.attempt,head:run.head,base:run.base},descriptor:{profile:meldPackageProfile.id,head:run.head,mainModule:'modules/worker.js'},manifestSha256:'c'.repeat(64),modules:[{...item('modules/worker.js'),contentType:'application/javascript+module'},{...item('modules/worker.wasm'),contentType:'application/wasm'}],assets:[...bytes.keys()].filter(p=>p.startsWith('assets/')).map(item),read:async path=>Buffer.from(bytes.get(path))};
 const requests=[],grants=[];let mode='normal',versionId=randomUUID(),deploymentId=randomUUID(),settingsReads=0,uploaded=false,promoted=false;
 const fetcher=async(url,options)=>{
  const path=new URL(url).pathname.replace('/client/v4','');requests.push({url,path,...options});
  assert.equal(new URL(url).origin,'https://api.cloudflare.com');assert.equal(options.redirect,'error');
  if(options.method==='POST'){const receipt=JSON.parse(await readFile(join(artifacts,'meld-worker-upload.json'),'utf8')),intent=receipt.requests.at(-1);assert.equal(intent.path,path+new URL(url).search);assert.equal(intent.state,'pending');assert.equal(intent.method,'POST');assert.equal(intent.authorizationId,grants.at(-1).id);}
  const success=result=>Response.json({success:true,result});
  if(options.method==='GET') {
   assert.equal(options.headers.Authorization,'Bearer '+accountToken);
   if(path.endsWith('/settings')){settingsReads++;return success(mode==='drift'&&settingsReads===2?{...settings,limits:{cpu_ms:60000}}:settings);}
   if(path.endsWith('/deployments'))return success({deployments:[{id:mode==='foreign-deployment'?randomUUID():promoted?deploymentId:profile.baseline.deploymentId,versions:[{version_id:promoted?versionId:profile.baseline.versionId,percentage:100}]}]});
   if(path.endsWith('/versions'))return success({items:[{id:mode==='unpublished-version'||uploaded?versionId:profile.baseline.versionId}]});
   if(path.endsWith('/versions/'+versionId))return success({id:versionId,resources:{bindings:mode==='lost-secret'?metadata.bindings:settings.bindings,script_runtime:mode==='uploaded-runtime-drift'?{compatibility_date:'2020-01-01'}:{compatibility_date:metadata.compatibility_date,compatibility_flags:metadata.compatibility_flags,limits:metadata.limits}}});
   assert.fail('Unexpected read');
  }
  if(path.endsWith('/assets-upload-session')) {
   assert.equal(options.headers.Authorization,'Bearer '+accountToken);
   const hashes=[...new Set(Object.values(JSON.parse(options.body).manifest).map(item=>item.hash))];
   return success({jwt:mode==='cached'?completionToken:uploadToken,buckets:mode==='cached'?[]:mode==='unknown-asset'?[['0'.repeat(32)]]:mode==='duplicate-asset'?[[hashes[0]],[hashes[0]]]:[hashes]});
  }
  if(path.endsWith('/assets/upload')){assert.equal(options.headers.Authorization,'Bearer '+uploadToken);return success(mode==='no-completion'?{}:{jwt:completionToken});}
  if(path.endsWith('/versions')) {
   assert.equal(options.headers.Authorization,'Bearer '+accountToken);
   if(mode==='unknown-version-ack')throw Error('transport reset with '+accountToken);
   if(mode==='rejected-version')return Response.json({success:false,errors:[{message:accountToken}]},{status:403});
   uploaded=true;return success({id:versionId});
  }
  if(path.endsWith('/deployments')){assert.equal(options.headers.Authorization,'Bearer '+accountToken);promoted=true;if(mode==='unknown-promotion-ack')throw Error('lost acknowledgement');return success({id:deploymentId});}
  assert.fail('Unexpected write');
 };
 const authorize=async()=>{const grant={id:randomUUID(),run:run.id,attempt:run.attempt,generation:run.generation,environmentId:profile.environmentId,issuedAt:now()-60000,checkedAt:now(),expiresAt:now()+120000};grants.push(grant);return grant;};
 const deps={credential:async()=>accountToken,authorize,fetcher,now};
 try{await work({directory,context,profile,settings,artifact,bytes,requests,grants,deps,mode:value=>{mode=value;},prepare:()=>prepareMeldWorkerUpload(context,profile,{load:async()=>artifact}),receipt:async()=>JSON.parse(await readFile(join(artifacts,'meld-worker-upload.json'),'utf8'))});}
 finally{await rm(directory,{recursive:true,force:true});}
}

test('opaque Worker/assets upload preserves binary bytes, module names, controls, secrets and target without deploying',async()=>fixture(async f=>{
 const plan=await f.prepare();assert.equal(plan.assetCount,3);assert.equal(plan.moduleCount,2);assert.equal(plan.modules,undefined);assert.equal(plan.byHash,undefined);assert.ok(Object.isFrozen(plan));assert.ok(Object.isFrozen(plan.binding));
 const result=await uploadMeldStageVersion(f.context,plan,f.profile,f.deps);assert.equal(result.deployed,false);assert.equal(result.head,f.context.run.head);
 const writes=f.requests.filter(r=>r.method==='POST');assert.equal(writes.length,3);assert.equal(f.grants.length,3);assert.equal(new Set(f.grants.map(g=>g.id)).size,3);
 const manifest=JSON.parse(writes[0].body).manifest;assert.deepEqual(Object.keys(manifest),['/index.html','/file.bin','/same.bin']);assert.equal(manifest['/file.bin'].hash,manifest['/same.bin'].hash);
 const binaryHash=blake3.hash(f.bytes.get('assets/file.bin').toString('base64')+'bin').toString('hex').slice(0,32);assert.equal(manifest['/file.bin'].hash,binaryHash);
 assert.deepEqual(Buffer.from(await writes[1].body.get(binaryHash).text(),'base64'),f.bytes.get('assets/file.bin'));
 const parts=writes[2].body,metadata=JSON.parse(await parts.get('metadata').text());
 assert.equal(metadata.main_module,'worker.js');assert.deepEqual(metadata.keep_bindings,['secret_text','secret_key']);assert.deepEqual(metadata.bindings,f.profile.metadata.bindings);
 assert.equal(metadata.assets.jwt,completionToken);assert.equal(metadata.assets.config._headers,f.bytes.get('assets/_headers').toString());assert.equal(metadata.assets.config._redirects,f.bytes.get('assets/_redirects').toString());
 assert.equal(metadata.assets.config.run_worker_first,true);assert.deepEqual(Buffer.from(await parts.get('worker.wasm').arrayBuffer()),f.bytes.get('modules/worker.wasm'));assert.equal(parts.get('worker.js').type,'application/javascript+module');
 assert.equal(parts.get('_headers'),null);assert.equal(parts.get('private.env'),null);assert.ok(f.requests.every(r=>!r.path.endsWith('/deployments')||r.method==='GET'));
 const receipt=await f.receipt();assert.equal(receipt.state,'uploaded');assert.equal(receipt.versionId,result.versionId);assert.equal((await stat(result.receipt)).mode&0o777,0o600);
 for(const token of [accountToken,uploadToken,completionToken])assert.ok(!JSON.stringify(receipt).includes(token));
 const count=f.requests.length;await assert.rejects(uploadMeldStageVersion(f.context,plan,f.profile,f.deps),/already has an intent/);assert.equal(f.requests.length,count);
}));

test('cached assets use their completion JWT without uploading bytes',async()=>fixture(async f=>{
 f.mode('cached');await uploadMeldStageVersion(f.context,await f.prepare(),f.profile,f.deps);
 assert.equal(f.requests.filter(r=>r.method==='POST').length,2);assert.equal(f.grants.length,2);
}));

test('stale, cross-attempt, changed-environment and revoked authorization stop writes',async()=>{
 for(const patch of [{checkedAt:now()-30001},{checkedAt:undefined},{issuedAt:now()+10000},{expiresAt:now()+29999},{run:randomUUID()},{attempt:2},{generation:2},{environmentId:'production'}])await fixture(async f=>{
  const plan=await f.prepare(),authorize=async()=>({...await f.deps.authorize(),...patch});
  await assert.rejects(uploadMeldStageVersion(f.context,plan,f.profile,{...f.deps,authorize}),/fresh server-issued/);assert.equal(f.requests.filter(r=>r.method==='POST').length,0);
 });
 await fixture(async f=>{
  const plan=await f.prepare();let calls=0;const authorize=async()=>{if(++calls===3)throw Error('revoked');return f.deps.authorize();};
  await assert.rejects(uploadMeldStageVersion(f.context,plan,f.profile,{...f.deps,authorize}),/revoked/);assert.equal(f.requests.filter(r=>r.method==='POST').length,2);assert.equal((await f.receipt()).state,'failed');
 });
});

test('resource drift, unpublished versions and malformed asset requests stop before Worker upload',async()=>{
 for(const mode of ['drift','unpublished-version','unknown-asset','duplicate-asset','no-completion'])await fixture(async f=>{
  f.mode(mode);await assert.rejects(uploadMeldStageVersion(f.context,await f.prepare(),f.profile,f.deps),/changed since|unknown or duplicate|confirm asset completion/);
  assert.equal(f.requests.filter(r=>r.method==='POST'&&r.path.endsWith('/versions')).length,0);assert.equal((await f.receipt()).state,'failed');
 });
 await fixture(async f=>{
  f.profile.metadata.bindings.push({type:'plain_text',name:'NEW_RESOURCE',text:'unexpected'});
  await assert.rejects(uploadMeldStageVersion(f.context,await f.prepare(),f.profile,f.deps),/change existing staging bindings/);assert.equal(f.requests.filter(r=>r.method==='POST').length,0);
 });
});

test('lost or rejected version acknowledgements preserve a private uncertain receipt and never replay a mutation',async()=>{
 for(const mode of ['unknown-version-ack','rejected-version'])await fixture(async f=>{
  f.mode(mode);const plan=await f.prepare();
  await assert.rejects(uploadMeldStageVersion(f.context,plan,f.profile,f.deps),error=>{assert.match(error.message,/no provider write was replayed/);assert.ok(!error.message.includes(accountToken));return true;});
  assert.equal(f.requests.filter(r=>r.method==='POST'&&r.path.endsWith('/versions')).length,1);const receipt=await f.receipt();assert.equal(receipt.state,'unconfirmed');assert.equal(receipt.requests.at(-1).state,'unconfirmed');
  const count=f.requests.length;await assert.rejects(uploadMeldStageVersion(f.context,plan,f.profile,f.deps),/already has an intent/);assert.equal(f.requests.length,count);
 });
});

test('acknowledged versions remain undeployed and fail verification if secret bindings or runtime settings drift',async()=>{
 for(const mode of ['lost-secret','uploaded-runtime-drift'])await fixture(async f=>{
  f.mode(mode);await assert.rejects(uploadMeldStageVersion(f.context,await f.prepare(),f.profile,f.deps),/Uploaded Worker/);const receipt=await f.receipt();assert.equal(receipt.state,'failed');assert.ok(receipt.versionId);assert.equal(receipt.requests.filter(r=>r.path.endsWith('/versions')).length,1);
  assert.equal(f.requests.filter(r=>r.method==='POST'&&r.path.endsWith('/deployments')).length,0);
 });
});

test('explicit staging promotion rechecks target and authority, moves only the verified version, and independently observes it',async()=>fixture(async f=>{
 const upload=await uploadMeldStageVersion(f.context,await f.prepare(),f.profile,f.deps),before=f.grants.length;
 assert.equal(upload.deployed,false);await assert.rejects(promoteMeldStageVersion({...upload}),/verified, unused/);
 const deployed=await promoteMeldStageVersion(upload);assert.equal(deployed.deployed,true);assert.equal(deployed.versionId,upload.versionId);assert.equal(deployed.candidate,f.context.run.head);assert.equal(f.grants.length,before+1);
 const mutation=f.requests.filter(r=>r.method==='POST'&&r.path.endsWith('/deployments'));assert.equal(mutation.length,1);assert.deepEqual(JSON.parse(mutation[0].body).versions,[{version_id:upload.versionId,percentage:100}]);assert.ok(!mutation[0].url.includes('force=true'));
 assert.equal((await f.receipt()).state,'deployed');assert.equal((await observeMeldStageDeployment(upload)).runId,deployed.runId);
 await assert.rejects(promoteMeldStageVersion(upload),/verified, unused/);assert.equal(f.requests.filter(r=>r.method==='POST'&&r.path.endsWith('/deployments')).length,1);
 f.mode('foreign-deployment');await assert.rejects(observeMeldStageDeployment(upload),/no longer serves/);
}));

test('changed staging or revoked authority stops promotion, while a lost traffic acknowledgement remains unverified without retry',async()=>{
 await fixture(async f=>{const upload=await uploadMeldStageVersion(f.context,await f.prepare(),f.profile,f.deps);f.mode('foreign-deployment');await assert.rejects(promoteMeldStageVersion(upload),/changed since/);assert.equal(f.requests.filter(r=>r.method==='POST'&&r.path.endsWith('/deployments')).length,0);assert.equal((await f.receipt()).state,'promotion-failed');});
 await fixture(async f=>{let calls=0;const upload=await uploadMeldStageVersion(f.context,await f.prepare(),f.profile,{...f.deps,authorize:async()=>{if(++calls>3)throw Error('revoked');return f.deps.authorize();}});await assert.rejects(promoteMeldStageVersion(upload),/revoked/);assert.equal(f.requests.filter(r=>r.method==='POST'&&r.path.endsWith('/deployments')).length,0);});
 await fixture(async f=>{const upload=await uploadMeldStageVersion(f.context,await f.prepare(),f.profile,f.deps);f.mode('unknown-promotion-ack');await assert.rejects(promoteMeldStageVersion(upload),/no provider write was replayed/);const receipt=await f.receipt();assert.equal(receipt.state,'promotion-unverified');assert.equal(receipt.requests.at(-1).state,'unconfirmed');await assert.rejects(promoteMeldStageVersion(upload),/verified, unused/);assert.equal(f.requests.filter(r=>r.method==='POST'&&r.path.endsWith('/deployments')).length,1);});
});

test('production targets, secret payloads, foreign artifacts and malformed modules cannot gain upload authority',async()=>{
 await fixture(async f=>{f.profile.script='meld-api';await assert.rejects(f.prepare(),/fixed Meld staging target/);});
 for(const binding of [{name:'BAD',type:'inherit'},{name:'BAD',type:'secret_text',text:'never-upload'},{name:'BAD',type:'secret_key',value:'never-upload'}])await fixture(async f=>{f.profile.metadata.bindings.push(binding);await assert.rejects(f.prepare(),/refuses inherited or plaintext secret/);});
 await fixture(async f=>{f.artifact.modules[0].path='modules/../worker.js';await assert.rejects(f.prepare(),/multipart module/);});
 await fixture(async f=>{f.artifact.modules[0].contentType='text/plain\r\nInjected: yes';await assert.rejects(f.prepare(),/multipart module/);});
 await fixture(async f=>{f.artifact.modules[0].sha256='0'.repeat(64);await assert.rejects(f.prepare(),/bytes changed/);});
 await fixture(async f=>{f.artifact.binding.attempt=2;await assert.rejects(uploadMeldStageVersion(f.context,await f.prepare(),f.profile,f.deps),/another attempt/);assert.equal(f.requests.length,0);});
 await fixture(async f=>{const plan=await f.prepare();await assert.rejects(uploadMeldStageVersion(f.context,{...plan},f.profile,f.deps),/Trusted upload context/);assert.equal(f.requests.length,0);});
 await fixture(async f=>{await assert.rejects(prepareMeldWorkerUpload(f.context,f.profile),/exact native build artifact/);});
});

test('asset ignore rules, unsafe control content and Pages controls are interpreted before any provider operation',async()=>{
 await fixture(async f=>{f.bytes.set('assets/.assetsignore',Buffer.from('private.env\n*.bin\n!same.bin\n'));const item=f.artifact.assets.find(a=>a.path==='assets/.assetsignore');item.bytes=f.bytes.get(item.path).length;item.sha256=sha(f.bytes.get(item.path));const plan=await f.prepare();assert.equal(plan.assetCount,2);});
 await fixture(async f=>{f.bytes.set('assets/_headers',Buffer.from([255,0]));const item=f.artifact.assets.find(a=>a.path==='assets/_headers');item.bytes=2;item.sha256=sha(f.bytes.get(item.path));await assert.rejects(f.prepare(),/Invalid asset control/);});
 for(const name of ['_worker.js','_routes.json'])await fixture(async f=>{const path='assets/'+name,data=Buffer.from('{}');f.bytes.set(path,data);f.artifact.assets.push({path,bytes:data.length,sha256:sha(data)});await assert.rejects(f.prepare(),/Pages-specific/);});
});

test('installed Wrangler dry-run confirms multipart modules, cache options and retained secret types',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'nh-upload-contract-'));
 try {
  const assets=join(directory,'assets'),worker=join(directory,'worker.mjs'),config=join(directory,'wrangler.json'),bundle=join(directory,'worker.multipart');
  await mkdir(assets);await writeFile(worker,'export default {fetch(){return new Response("contract fixture")}};');
  await writeFile(join(assets,'index.html'),'fixture');await writeFile(join(assets,'_headers'),'/api/*\n  Cache-Control: no-store\n');await writeFile(join(assets,'_redirects'),'/old /new 302\n');
  await writeFile(config,JSON.stringify({name:'nanohub-upload-contract',main:worker,compatibility_date:meldPackageProfile.compatibilityDate,compatibility_flags:meldPackageProfile.compatibilityFlags,cache:{enabled:false},assets:{directory:assets,binding:'ASSETS',run_worker_first:true}}));
  const cli=fileURLToPath(new URL('../../../node_modules/wrangler/bin/wrangler.js',import.meta.url));
  const result=await promisify(execFile)(process.execPath,[cli,'deploy','--dry-run','--outfile',bundle,'--config',config],{cwd:directory,env:{PATH:process.env.PATH,HOME:directory,XDG_CONFIG_HOME:directory,CI:'true',WRANGLER_SEND_METRICS:'false',NO_COLOR:'1'},timeout:60000,maxBuffer:2*1024*1024});
  assert.match(result.stdout,/--dry-run: exiting now/);assert.doesNotMatch(result.stdout,/Starting asset upload/);
  const data=await readFile(bundle),boundary=data.subarray(0,data.indexOf('\r\n')).toString().slice(2),parts=await new Response(data,{headers:{'Content-Type':'multipart/form-data; boundary='+boundary}}).formData(),metadata=JSON.parse(parts.get('metadata'));
  assert.deepEqual(metadata.keep_bindings,['secret_text','secret_key']);assert.deepEqual(metadata.cache_options,{enabled:false});
  // Wrangler omits assets on a credential-free dry-run because there is no
  // upload completion JWT. This check cannot establish live asset acceptance.
  assert.equal(metadata.assets,undefined);
  assert.equal(parts.get('_headers'),null);assert.equal(parts.get('_redirects'),null);assert.ok(parts.get(metadata.main_module));assert.deepEqual(metadata.bindings,[{name:'ASSETS',type:'assets'}]);
 }finally{await rm(directory,{recursive:true,force:true});}
});
