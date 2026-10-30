import test,{after} from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'nh-deployment-cli-'));after(()=>rm(dir,{recursive:true,force:true}));
await build({entryPoints:[new URL('../src/deployments/cli.ts',import.meta.url).pathname,new URL('../src/cli/credentials.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',outdir:dir,outExtension:{'.js':'.mjs'}});
const {cliDeploymentRoute}=await import(pathToFileURL(join(dir,'deployments/cli.mjs'))),{cliScopeAllowed,requestedScopes,cliScopeNeedsWriter}=await import(pathToFileURL(join(dir,'cli/credentials.mjs')));
const id='request-fixture',capabilities={version:1,conditionalReviews:true,cliAudit:true,finalGrantCheck:true};
function fixture(scopes=['read','deployments:review'],role='reader'){
 const calls=[],status={id,revision:3,canApprove:true,canReview:true},seq={deploymentCliCapabilities:()=>capabilities,deploymentRequest:async()=>status,deploymentRequests:async()=>({requests:[status],nextCursor:null}),mutateCliDeployment:async(input,actor)=>{calls.push({input,actor});return {id,revision:4};}};
 const env={SEQUENCER:{idFromName:x=>x,get:()=>seq}},user={id:'reviewer',cli:{credentialId:'credential-id',scopes}},access={proof:{role,agentId:null}};
 const invoke=(method='GET',suffix='',body,headers={})=>cliDeploymentRoute(env,new Request('https://nanohub.invalid/api/trunks/fixture/deployment-requests'+suffix,{method,headers:{Origin:'https://nanohub.invalid',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),'fixture',suffix? id:undefined,suffix.endsWith('/reviews')?'reviews':undefined,user,access);
 return {seq,calls,status,invoke};
}
test('deployment review permission can be separately delegated to current readers without content, request or admin rights',()=>{
 for(const role of ['owner','admin','writer','reader','member']){assert.equal(cliScopeAllowed('deployments:review',role,true),true);assert.equal(cliScopeAllowed('deployments:review',role,false),false);}
 assert.equal(cliScopeAllowed('deployments:review','unknown',true),false);assert.equal(cliScopeAllowed('deployments:write','reader',true),false);assert.equal(cliScopeNeedsWriter('deployments:review'),false);assert.equal(cliScopeNeedsWriter('deployments:write'),true);
 assert.deepEqual(requestedScopes(['read','reviews:write','environments:write']),['read','reviews:write','environments:write']);
});
test('CLI deployment review requires its own scope and If-Match, never trusts actor or revision JSON',async()=>{
 const f=fixture();assert.equal((await f.invoke('POST','/'+id+'/reviews',{decision:'approve'})).status,428);assert.equal((await f.invoke('POST','/'+id+'/reviews',{decision:'approve',actor:'other'},{'If-Match':'"deployment-request-3"'})).status,400);assert.equal((await f.invoke('POST','/'+id+'/reviews',{decision:'approve'},{'If-Match':'"deployment-request-03"'})).status,400);
 assert.equal((await f.invoke('POST','/'+id+'/reviews',{decision:'approve',comment:'Reviewed'},{'If-Match':'"deployment-request-3"'})).status,200);assert.deepEqual(f.calls,[{actor:'reviewer',input:{operation:'review',id,decision:'approve',comment:'Reviewed',revision:3,credentialId:'credential-id',origin:'https://nanohub.invalid'}}]);
 for(const scopes of [['read'],['read','environments:write'],['read','deployments:write']]){const denied=fixture(scopes,'writer');assert.equal((await denied.invoke('POST','/'+id+'/reviews',{decision:'approve'},{'If-Match':'"deployment-request-3"'})).status,403);assert.equal(denied.calls.length,0);}
});
test('request intent needs writer access and its separate permission; authorization headers cannot become delegated identities',async()=>{
 for(const [scopes,role]of [[['read','deployments:review'],'writer'],[['read','deployments:write'],'reader']]){const f=fixture(scopes,role);assert.equal((await f.invoke('POST','',{runId:'run-fixture',environment:'staging'})).status,403);assert.equal(f.calls.length,0);}
 const f=fixture(['read','deployments:write'],'writer');assert.equal((await f.invoke('POST','',{runId:'run-fixture',environment:'staging',credentialId:'spoof'})).status,400);assert.equal((await f.invoke('POST','',{runId:'run-fixture',environment:'staging'},{Authorization:'Bearer ordinary-agent'})).status,403);assert.equal((await f.invoke('POST','',{runId:'run-fixture',environment:'staging'})).status,201);assert.equal(f.calls[0].input.operation,'request');
});
test('read-only credentials cannot advertise review capabilities and detail includes the conditional revision',async()=>{
 const f=fixture(['read']);const detail=await f.invoke('GET','/'+id);assert.equal(detail.headers.get('ETag'),'"deployment-request-3"');const data=await detail.json();assert.equal(data.request.canApprove,false);assert.equal(data.request.canReview,false);const list=await(await f.invoke()).json();assert.equal(list.requests[0].canApprove,false);assert.equal(f.calls.length,0);
});
test('mixed receivers stop without falling back to browser mutations',async()=>{
 for(const capabilities of [undefined,null,{version:1,conditionalReviews:true,cliAudit:true}]){const f=fixture();if(capabilities!==undefined)f.seq.deploymentCliCapabilities=()=>capabilities;else f.seq.deploymentCliCapabilities=()=>{throw Error('The RPC receiver does not implement the method "deploymentCliCapabilities".');};const response=await f.invoke('POST','/'+id+'/reviews',{decision:'approve'},{'If-Match':'"deployment-request-3"'});assert.equal(response.status,503);assert.equal(response.headers.get('Retry-After'),'5');assert.equal(f.calls.length,0);}
});
