import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir,symlink,stat,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {packageMeldStaging,meldPackageProfile} from '../../../tools/meld-stage-package.mjs';
import {loadMeldStagePackage} from '../../../tools/meld-stage-artifact.mjs';
import {buildArtifactPolicies} from '../../../tools/build-artifacts.mjs';
const head='a'.repeat(40);
async function fixture(work) {
 const source=await realpath(await mkdtemp(join(tmpdir(),'nh-meld-package-'))),api=join(source,'apps/api'),wrangler=join(api,'node_modules/wrangler');
 await mkdir(join(api,'.open-next/assets'),{recursive:true});await mkdir(join(wrangler,'bin'),{recursive:true});await mkdir(join(wrangler,'dist'));
 await writeFile(join(api,'worker.mjs'),'export default {fetch(){return new Response("fixture")}}');await writeFile(join(api,'package.json'),'{}');
 await writeFile(join(api,'.open-next/assets','index.html'),'<h1>fixture</h1>');await writeFile(join(api,'.open-next/assets','_headers'),'/api/*\n  Cache-Control: no-store\n');
 await writeFile(join(wrangler,'package.json'),JSON.stringify({name:'wrangler',version:meldPackageProfile.wrangler,exports:{'.':'./dist/api.js'}}));await writeFile(join(wrangler,'dist/api.js'),'');await writeFile(join(wrangler,'bin/wrangler.js'),'');
 let mode='valid',calls=0;
 const run=async(binary,args,options)=>{
  calls++;assert.ok(binary.endsWith('/bin/wrangler.js'));assert.deepEqual(args.slice(0,2),['deploy','--dry-run']);
  const out=args[args.indexOf('--outdir')+1],meta=args[args.indexOf('--metafile')+1],config=JSON.parse(await readFile(args[args.indexOf('--config')+1],'utf8'));
  assert.equal(config.main,join(api,'worker.mjs'));assert.equal(config.name,'nanohub-meld-build-only');
  for(const field of ['account_id','routes','build','services','hyperdrive','migrations','vars'])assert.equal(config[field],undefined);
  assert.equal(config.assets.binding,'ASSETS');assert.deepEqual(config.compatibility_flags,meldPackageProfile.compatibilityFlags);
  assert.ok(!options.cwd.startsWith(source+'/'));for(const key of ['CODEGRAFF_API_KEY','CLOUDFLARE_API_TOKEN','GITHUB_TOKEN'])assert.equal(options.env[key],undefined);
  await writeFile(join(out,'worker.js'),'import wasm from "./worker.wasm";export default {fetch(){return new Response("fixture")}}');await writeFile(join(out,'worker.wasm'),Buffer.from([0,97,115,109,1,0,0,0]));
  await writeFile(join(out,'worker.js.map'),'source-map-stays-in-private-temporary-directory');await writeFile(join(out,'README.md'),'Wrangler tooling note');
  if(mode==='link')await symlink('/etc/passwd',join(out,'linked.js'));
  if(mode==='unknown-module')await writeFile(join(out,'unexpected.native'),'unsupported');
  const outputs={'bundle/worker.js':{entryPoint:'worker.mjs',exports:['default','DOQueueHandler','DOShardedTagCache','BucketCachePurge'],imports:[{path:mode==='missing'?'./missing.wasm':mode==='missing-package'?'unbundled-npm-package':'./worker.wasm',external:true},{path:'node:async_hooks',external:true},{path:'cloudflare:workers',external:true},...['stream','async_hooks','buffer'].map(path=>({path,external:true}))]}};
  if(mode==='multiple')outputs['bundle/other.js']={entryPoint:'other.js',exports:['default'],imports:[]};
  if(mode==='no-default')outputs['bundle/worker.js'].exports=[];
  await writeFile(meta,JSON.stringify({outputs}));if(mode==='cli-failure')throw Error('fixture CLI failure');
 };
 try{await work({source,api,wrangler,output:join(source,'.nanohub-staging'),options:{source,head},deps:{run,guest:()=>{}},mode:value=>{mode=value;},calls:()=>calls});}
 finally{await rm(source,{recursive:true,force:true});}
}

test('Meld package uses locked dry-run bundling and retains complete module/assets roles without target credentials',async()=>fixture(async f=>{
 const result=await packageMeldStaging(f.options,f.deps),descriptor=JSON.parse(await readFile(join(f.output,'staging-package.json'),'utf8'));
 assert.equal(result.head,head);assert.equal(result.mainModule,'modules/worker.js');assert.equal(result.moduleCount,2);assert.equal(result.assetFiles,2);
 assert.equal(descriptor.profile,'meld-staging-v1');assert.equal(descriptor.wrangler,'4.136.1');assert.deepEqual(descriptor.assets.controlFiles,['_headers']);
 assert.deepEqual(descriptor.modules,[{path:'modules/worker.js',contentType:'application/javascript+module'},{path:'modules/worker.wasm',contentType:'application/wasm'}]);
 assert.deepEqual(await readFile(join(f.output,'modules/worker.wasm')),Buffer.from([0,97,115,109,1,0,0,0]));
 assert.equal(await readFile(join(f.output,'assets/index.html'),'utf8'),'<h1>fixture</h1>');assert.deepEqual(await readdir(join(f.output,'modules')),['worker.js','worker.wasm']);
 assert.equal((await stat(f.output)).mode&0o777,0o700);assert.equal((await stat(join(f.output,'staging-package.json'))).mode&0o777,0o600);
}));

test('missing modules, wrong exports, multiple entries, unsafe files and failed bundling remove only their new package',async()=>{
 for(const mode of ['missing','missing-package','no-default','multiple','link','unknown-module','cli-failure'])await fixture(async f=>{
  const errors={missing:/unresolved external/,'missing-package':/unresolved external/, 'no-default':/preserve.*exports/,multiple:/preserve.*exports/,link:/linked or special/, 'unknown-module':/Unsupported emitted/, 'cli-failure':/fixture CLI failure/};
  f.mode(mode);await assert.rejects(packageMeldStaging(f.options,f.deps),errors[mode]);assert.equal(f.calls(),1);await assert.rejects(stat(f.output),{code:'ENOENT'});
 });
});

test('Wrangler drift, missing build assets and existing output fail before replacing evidence',async()=>{
 await fixture(async f=>{await writeFile(join(f.wrangler,'package.json'),JSON.stringify({name:'wrangler',version:'0.0.0'}));await assert.rejects(packageMeldStaging(f.options,f.deps),/lock changed/);assert.equal(f.calls(),0);});
 await fixture(async f=>{await rm(join(f.api,'.open-next/assets'),{recursive:true});await assert.rejects(packageMeldStaging(f.options,f.deps));assert.equal(f.calls(),0);});
 await fixture(async f=>{await mkdir(f.output);await writeFile(join(f.output,'prior'),'retain');await assert.rejects(packageMeldStaging(f.options,f.deps),{code:'EEXIST'});assert.equal(await readFile(join(f.output,'prior'),'utf8'),'retain');assert.equal(f.calls(),0);});
});

test('default packaging entrypoint refuses accidental execution on the controller',async()=>{
 await assert.rejects(packageMeldStaging({source:'/controller-not-build-workspace',head}),/credential-free Nanohub build container/);
});

test('trusted package consumer verifies closed metadata, opaque module roles and the committed wrapper without following source links',async()=>fixture(async f=>{
 const git=(...args)=>execFileSync('git',['-C',f.source,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args],{env:{PATH:process.env.PATH,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}}).toString().trim();
 git('init','-q','-b','main');git('add','apps/api/worker.mjs');git('commit','-qm','Fixture wrapper');const commit=git('rev-parse','HEAD');
 await packageMeldStaging({...f.options,head:commit},f.deps);
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 const image='registry.invalid/toolchain@sha256:'+'c'.repeat(64),policy=buildArtifactPolicies([{job:'meld/check',directory:'/tmp/work/.nanohub-staging'}]).get('meld/check');
 const run={id:'package-run',attempt:1,head:commit,base:commit},result={name:'meld/check',state:'success',execution:{provider:'codegraff',sandboxId:'box-1',workflow:'.github/workflows/meld.yml',job:'check'}};
 const store=async(mutate=()=>{},extra=false)=>{
  const artifacts=join(f.source,'private-'+randomUUID()),directory='meld-check.build-'+randomUUID(),local=join(artifacts,directory);
  await mkdir(join(local,'blobs'),{recursive:true,mode:0o700});const files=[];
  const visit=async(path,prefix='')=>{for(const entry of await readdir(path,{withFileTypes:true})){const name=prefix+entry.name;if(entry.isDirectory())await visit(join(path,entry.name),name+'/');else{
   let data=await readFile(join(path,entry.name));if(name==='staging-package.json'){const value=JSON.parse(data);mutate(value);data=Buffer.from(JSON.stringify(value));}
   const sha256=hash(data);await writeFile(join(local,'blobs',sha256),data);files.push({path:name,bytes:data.length,sha256});
  }}};
  await visit(f.output);
  if(extra){const data=Buffer.from('fixture');await writeFile(join(local,'blobs',hash(data)),data);files.push({path:'wrangler.toml',bytes:data.length,sha256:hash(data)});}
  files.sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path)));const totalBytes=files.reduce((n,file)=>n+file.bytes,0),manifest=Buffer.from(JSON.stringify({format:1,files,totalBytes}));await writeFile(join(local,'manifest.json'),manifest);
  await writeFile(join(artifacts,'meld-check.build.json'),JSON.stringify({format:1,state:'complete',binding:{runId:run.id,attempt:run.attempt,head:commit,base:commit,job:'meld/check',image,sandboxId:'box-1'},policy,directory,manifestSha256:hash(manifest),manifestBytes:manifest.length,totalBytes,fileCount:files.length}));
  await writeFile(join(artifacts,'meld-check.sandbox.json'),JSON.stringify({runId:run.id,attempt:1,head:commit,sandboxId:'box-1',cleanupNeeded:false}));
  return{run,results:[result],buildArtifacts:[policy],toolchainImage:image,source:f.source,artifacts};
 };
 const valid=await store(),loaded=await loadMeldStagePackage(valid);assert.equal(loaded.modules.length,2);assert.equal(loaded.assets.length,2);assert.equal((await loaded.read('assets/index.html')).toString(),'<h1>fixture</h1>');
 const attacks=[
  [value=>{value.account_id='untrusted-target';},/profile/],
  [value=>{value.head='b'.repeat(40);},/candidate/],
  [value=>{value.modules[0].path='../../outside';},/module/],
  [value=>{value.modules[0].contentType='application/javascript+module\r\nX-Forged: fixture';},/module/],
  [value=>{value.assets.files--;},/assets/],
  [value=>{value.wrapperSha256='b'.repeat(64);},/wrapper differs/],
  [value=>{value.exports=['default'];},/exports/],
 ];
 for(const [change,error] of attacks)await assert.rejects(loadMeldStagePackage(await store(change)),error);
 await assert.rejects(loadMeldStagePackage(await store(()=>{},true)),/Unexpected content/);
 await assert.rejects(loadMeldStagePackage({...valid,run:{...run,attempt:2}}),/successful run/);
 // A candidate-controlled working-tree link is not the source of truth.
 await rm(join(f.api,'worker.mjs'));await symlink('/etc/passwd',join(f.api,'worker.mjs'));
 assert.equal((await loadMeldStagePackage(valid)).descriptor.wrapperSha256,loaded.descriptor.wrapperSha256);
}));
