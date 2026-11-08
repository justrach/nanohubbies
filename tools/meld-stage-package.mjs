/** Runs only inside the unprivileged, credential-free build container. */
import {readFile,writeFile,mkdir,mkdtemp,rm,readdir,lstat,realpath} from 'node:fs/promises';
import {join,resolve,dirname,posix} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire,builtinModules} from 'node:module';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export const meldPackageProfile={id:'meld-staging-v1',wrangler:'4.136.1',compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat','global_fetch_strictly_public']};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const safePath=value=>typeof value==='string'&&value&&Buffer.from(value).toString('utf8')===value&&Buffer.byteLength(value)<=1024&&!/[\\\x00-\x1f\x7f]/.test(value)&&value.split('/').length<=32&&value.split('/').every(part=>part&&part!=='.'&&part!=='..');
const moduleType=path=>/\.(?:js|mjs)$/.test(path)?'application/javascript+module':path.endsWith('.wasm')?'application/wasm':/\.(?:txt|html|sql)$/.test(path)?'text/plain':path.endsWith('.bin')?'application/octet-stream':null;
const ignoredModule=path=>path==='README.md'||path.endsWith('.map');
const credentials=['CODEGRAFF_API_KEY','NANOHUB_CI_TOKEN','NANOHUB_TOKEN','GITHUB_TOKEN','CLOUDFLARE_API_TOKEN','CLOUDFLARE_API_KEY','PIPELINE_ADMIN_SECRET','DOCKER_AUTH_CONFIG'];
const requiredExports=['default','DOQueueHandler','DOShardedTagCache','BucketCachePurge'];
const runtimeModules=new Set(builtinModules);

function assertGuest(source,head) {
  if(resolve(source)!=='/tmp/work'||process.env.NANOHUB!=='true'||process.getuid?.()!==1000||process.env.GITHUB_SHA!==head||credentials.some(name=>process.env[name]))throw Error('Meld packaging requires the credential-free Nanohub build container');
}

async function runWrangler(binary,args,{cwd,env}) {
  await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[binary,...args],{cwd,env,stdio:'inherit'});
    const timer=setTimeout(()=>child.kill('SIGKILL'),5*60000);timer.unref();
    child.once('error',()=>{clearTimeout(timer);reject(Error('Pinned Wrangler packaging could not start'));});
    child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('Pinned Wrangler dry-run packaging failed'));});
  });
}

async function inventory(root,{ignore=()=>false}={}) {
  if(!(await lstat(root)).isDirectory())throw Error('Expected a regular packaging directory');
  const files=[];let entries=0;
  const visit=async(directory,prefix='')=>{
    for(const entry of await readdir(directory,{withFileTypes:true})) {
      const path=prefix+entry.name;
      if(++entries>20000||!safePath(path))throw Error('Packaging paths exceed their bounds');
      const full=join(directory,entry.name),stat=await lstat(full);
      if(stat.isDirectory()&&!stat.isSymbolicLink())await visit(full,path+'/');
      else if(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1){if(!ignore(path))files.push({path,full,bytes:stat.size});}
      else throw Error('Packaging refuses linked or special files');
    }
  };
  await visit(root);return files.sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path)));
}

/** DI is for local fixtures; the embedded workflow uses the default guard and
 * pinned CLI. The candidate controls content, never deployment authority. */
export async function packageMeldStaging({source='/tmp/work',head=process.env.GITHUB_SHA}={}, {run=runWrangler,guest=assertGuest}={}) {
  if(!/^[a-f0-9]{40}$/.test(head??''))throw Error('Packaging requires the full candidate SHA');
  guest(source,head);source=await realpath(source);
  const api=join(source,'apps/api'),worker=join(api,'worker.mjs'),assets=join(api,'.open-next/assets'),output=join(source,'.nanohub-staging');
  const entryStat=await lstat(worker);if(!entryStat.isFile()||entryStat.isSymbolicLink()||entryStat.size>1024*1024)throw Error('Missing or unsafe Meld Worker wrapper');
  const assetFiles=await inventory(assets);
  if(!assetFiles.length)throw Error('Meld staging assets are empty');
  const require=createRequire(join(api,'package.json'));
  let packagePath;try{packagePath=require.resolve('wrangler/package.json');}catch{packagePath=join(dirname(require.resolve('wrangler')),'../package.json');}
  const installed=JSON.parse(await readFile(packagePath,'utf8'));
  if(installed.name!=='wrangler'||installed.version!==meldPackageProfile.wrangler)throw Error('Meld Wrangler lock changed; review the packaging profile');
  const binary=join(dirname(packagePath),'bin/wrangler.js');
  const temporary=await mkdtemp(join(tmpdir(),'nanohub-meld-package-'));
  let created=false;
  try {
    await mkdir(output,{mode:0o700});created=true;
    const bundle=join(temporary,'bundle'),metafile=join(temporary,'metafile.json'),configFile=join(temporary,'wrangler.json');
    await mkdir(bundle);await mkdir(join(temporary,'home'));await mkdir(join(temporary,'config'));
    // No account, routes, services, migrations, secrets or source build hooks.
    const config={name:'nanohub-meld-build-only',main:worker,compatibility_date:meldPackageProfile.compatibilityDate,compatibility_flags:meldPackageProfile.compatibilityFlags,assets:{directory:assets,binding:'ASSETS',run_worker_first:true}};
    await writeFile(configFile,JSON.stringify(config)+'\n',{flag:'wx',mode:0o600});
    await run(binary,['deploy','--dry-run','--outdir',bundle,'--metafile',metafile,'--config',configFile],{cwd:temporary,env:{PATH:process.env.PATH,HOME:join(temporary,'home'),XDG_CONFIG_HOME:join(temporary,'config'),CI:'true',NODE_ENV:'production',WRANGLER_SEND_METRICS:'false'}});
    if((await lstat(metafile)).size>32*1024*1024)throw Error('Wrangler metadata exceeds its bound');
    const meta=JSON.parse(await readFile(metafile,'utf8'));
    if(!meta.outputs||typeof meta.outputs!=='object'||Array.isArray(meta.outputs))throw Error('Wrangler did not report bundle outputs');
    const entries=Object.entries(meta.outputs).filter(([,value])=>typeof value?.entryPoint==='string');
    if(entries.length!==1||!Array.isArray(entries[0][1].exports)||requiredExports.some(name=>!entries[0][1].exports.includes(name)))throw Error('Wrangler did not preserve the Meld module Worker exports');
    const moduleFiles=await inventory(bundle,{ignore:ignoredModule});
    const candidates=moduleFiles.filter(file=>entries[0][0]===file.path||entries[0][0].endsWith('/'+file.path));
    if(candidates.length!==1||moduleType(candidates[0].path)!=='application/javascript+module')throw Error('Cannot identify the packaged Worker entrypoint');
    const names=new Set(moduleFiles.map(file=>file.path));
    for(const file of moduleFiles)if(!moduleType(file.path))throw Error('Unsupported emitted Worker module type');
    for(const [path,value] of Object.entries(meta.outputs)) {
      const matches=moduleFiles.filter(file=>path===file.path||path.endsWith('/'+file.path));
      if(!matches.length)continue;
      if(matches.length!==1||!Array.isArray(value.imports))throw Error('Invalid Wrangler module dependency metadata');
      for(const imported of value.imports) {
        if(typeof imported?.path!=='string')throw Error('Invalid emitted module import');
        // Wrangler 4.136 preserves bare Node builtins in esbuild metadata under
        // nodejs_compat (for example stream, async_hooks and buffer). They are
        // runtime imports, not missing emitted files. Arbitrary bare packages
        // still have to be present in the bundle inventory.
        if(/^(?:node|cloudflare):/.test(imported.path)||runtimeModules.has(imported.path))continue;
        const target=posix.normalize(posix.join(posix.dirname(matches[0].path),imported.path));
        if(posix.isAbsolute(imported.path)||!safePath(target)||!names.has(target))throw Error('Packaged Worker has an unresolved external module');
      }
    }
    let bytes=0,files=0;
    const copy=async(item,prefix)=>{
      if(++files>9999||(bytes+=item.bytes)>128*1024*1024-65536)throw Error('Meld staging package exceeds export bounds');
      const data=await readFile(item.full);if(data.length!==item.bytes)throw Error('Packaging input changed');
      const target=join(output,prefix,item.path);await mkdir(dirname(target),{recursive:true,mode:0o700});await writeFile(target,data,{flag:'wx',mode:0o600});
    };
    for(const file of moduleFiles)await copy(file,'modules');
    for(const file of assetFiles)await copy(file,'assets');
    const descriptor={format:1,kind:'meld-staging-package',profile:meldPackageProfile.id,head,wrangler:installed.version,compatibilityDate:meldPackageProfile.compatibilityDate,compatibilityFlags:meldPackageProfile.compatibilityFlags,mainModule:'modules/'+candidates[0].path,modules:moduleFiles.map(file=>({path:'modules/'+file.path,contentType:moduleType(file.path)})),exports:entries[0][1].exports,assets:{directory:'assets',files:assetFiles.length,controlFiles:['_headers','_redirects','.assetsignore','_worker.js','_routes.json'].filter(path=>assetFiles.some(file=>file.path===path))},wrapperSha256:sha(await readFile(worker))};
    const content=Buffer.from(JSON.stringify(descriptor,null,2)+'\n');if(content.length>65536)throw Error('Meld package descriptor exceeds its bound');
    await writeFile(join(output,'staging-package.json'),content,{flag:'wx',mode:0o600});
    return {head,output,mainModule:descriptor.mainModule,moduleCount:moduleFiles.length,assetFiles:assetFiles.length,bytes:bytes+content.length,descriptorSha256:sha(content)};
  }catch(error){if(created)await rm(output,{recursive:true,force:true});throw error;}
  finally{await rm(temporary,{recursive:true,force:true});}
}

if(import.meta.url===pathToFileURL(process.argv[1]??'').href)console.log(JSON.stringify(await packageMeldStaging()));
