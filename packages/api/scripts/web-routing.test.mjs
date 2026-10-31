import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'nh-web-routing-'));after(()=>rm(dir,{recursive:true,force:true}));
const bundle=await build({entryPoints:[new URL('../../../apps/web/worker.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'routing-targets',setup(p){
 p.onResolve({filter:/^\.\/\.open-next\/worker\.js$/},()=>({path:'next',namespace:'fixture'}));
 p.onResolve({filter:/^@swarm\/api$/},()=>({path:'api',namespace:'fixture'}));
 p.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({loader:'js',contents:path==='next'?`export default {fetch:async request=>new Response('next:'+new URL(request.url).pathname,{status:new URL(request.url).searchParams.has('missing')?404:200})};`:`export default {fetch:async()=>new Response('api')}; ${['Account','Agent','Driver','Hub','ImportJob','Lane','Packer','Room','Sequencer'].map(n=>'export class '+n+' {}').join('\n')}`}));
}}]});
await writeFile(join(dir,'worker.mjs'),bundle.outputFiles[0].text);const {default:worker}=await import(pathToFileURL(join(dir,'worker.mjs')).href);
const environment={LEGACY_PATHS:'/cli,/download,/downloads/',LEGACY:{fetch:async request=>new Response('legacy:'+new URL(request.url).pathname)}},ctx={};
test('native CLI consent owns its exact path despite an inherited /cli legacy prefix',async()=>{
 for(const path of ['/cli/authorize?code=ABCD-EFGH','/cli/authorize/?code=ABCD-EFGH']){
  const r=await worker.fetch(new Request('https://nanohub.sh'+path),environment,ctx);assert.equal(await r.text(),'next:'+new URL('https://nanohub.sh'+path).pathname);assert.equal(r.headers.get('Cache-Control'),'private, no-store');
 }
 const missing=await worker.fetch(new Request('https://nanohub.sh/cli/authorize?missing=1&code=ABCD-EFGH'),environment,ctx);assert.equal(missing.status,404);assert.equal(await missing.text(),'next:/cli/authorize','Consent codes cannot fall through to the legacy app');
});
test('legacy CLI pages/downloads and native API dispatch retain their ownership',async()=>{
 for(const path of ['/cli','/cli/manual','/download','/downloads/nh'])assert.equal(await(await worker.fetch(new Request('https://nanohub.sh'+path),environment,ctx)).text(),'legacy:'+path);
 assert.equal(await(await worker.fetch(new Request('https://nanohub.sh/api/cli/device'),environment,ctx)).text(),'api');
 assert.equal(await(await worker.fetch(new Request('https://nanohub.sh/other?missing=1'),environment,ctx)).text(),'legacy:/other');
});
test('portable CLI distribution comes only from assets; missing downloads never reach Next or legacy',async()=>{
 const paths=['/nh/latest.json','/nh/install.mjs','/nh/releases/0.4.1/nh.mjs','/nh/releases/0.4.1/SHA256SUMS'];
 const env={...environment,LEGACY_PATHS:environment.LEGACY_PATHS+',/nh',ASSETS:{fetch:async request=>{
  const path=new URL(request.url).pathname;
  return paths.includes(path)?new Response('asset:'+path):new Response('Asset not found',{status:404});
 }}};
 for(const path of paths){
  const r=await worker.fetch(new Request('https://nanohub.sh'+path),env,ctx);assert.equal(r.status,200);assert.equal(await r.text(),'asset:'+path);assert.equal(r.headers.get('Cache-Control'),'public, max-age=0, must-revalidate');assert.equal(r.headers.get('X-Content-Type-Options'),'nosniff');
 }
 const missing=await worker.fetch(new Request('https://nanohub.sh/nh/releases/9.9.9/nh.mjs'),env,ctx);assert.equal(missing.status,404);assert.equal(await missing.text(),'Asset not found');assert.equal(missing.headers.get('Cache-Control'),'private, no-store');
 const unavailable=await worker.fetch(new Request('https://nanohub.sh/nh/latest.json'),{...env,ASSETS:undefined},ctx);assert.equal(unavailable.status,503);assert.equal(unavailable.headers.get('Retry-After'),'60');assert.equal(unavailable.headers.get('Cache-Control'),'private, no-store');
 assert.equal(await(await worker.fetch(new Request('https://nanohub.sh/nh/other'),env,ctx)).text(),'legacy:/nh/other');
});
