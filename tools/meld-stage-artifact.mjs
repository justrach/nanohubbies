/** Read-only validation before a trusted uploader receives any package bytes.
 * This grants no deployment authority and executes no artifact code/hooks. */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {isAbsolute} from 'node:path';
import {loadBuildArtifact} from './build-artifacts.mjs';
import {meldPackageProfile} from './meld-stage-package.mjs';

const exec=promisify(execFile),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const keys=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const types=new Set(['application/javascript+module','application/wasm','text/plain','application/octet-stream']);
const controls=['_headers','_redirects','.assetsignore','_worker.js','_routes.json'];

export async function loadMeldStagePackage(context) {
  const job='meld/check',policy=context.buildArtifacts?.find(item=>item.job===job),result=context.results?.find(item=>item.name===job);
  if(!policy||policy.directory!=='/tmp/work/.nanohub-staging'||!isAbsolute(context.source??'')||!/^[a-f0-9]{40}$/.test(context.run?.head??''))throw Error('Meld staging requires its exact native build artifact');
  const artifact=await loadBuildArtifact({artifacts:context.artifacts,run:context.run,policy,image:context.toolchainImage,result});
  const fileMap=new Map(artifact.files.map(file=>[file.path,file]));
  const header=fileMap.get('staging-package.json');
  if(!header||header.bytes>65536)throw Error('Meld package descriptor is unavailable');
  const descriptor=JSON.parse((await artifact.read('staging-package.json')).toString('utf8'));
  if(!keys(descriptor,['format','kind','profile','head','wrangler','compatibilityDate','compatibilityFlags','mainModule','modules','exports','assets','wrapperSha256'])||descriptor.format!==1||descriptor.kind!=='meld-staging-package'||descriptor.profile!==meldPackageProfile.id||descriptor.head!==context.run.head||descriptor.wrangler!==meldPackageProfile.wrangler||descriptor.compatibilityDate!==meldPackageProfile.compatibilityDate||JSON.stringify(descriptor.compatibilityFlags)!==JSON.stringify(meldPackageProfile.compatibilityFlags)||!/^[a-f0-9]{64}$/.test(descriptor.wrapperSha256??''))throw Error('Meld package profile or candidate does not match');
  if(!Array.isArray(descriptor.modules)||!descriptor.modules.length||descriptor.modules.length>1000||!Array.isArray(descriptor.exports)||descriptor.exports.length>200||descriptor.exports.some(value=>typeof value!=='string'||value.length>200)||['default','DOQueueHandler','DOShardedTagCache','BucketCachePurge'].some(name=>!descriptor.exports.includes(name)))throw Error('Meld package module exports are incomplete');
  const modulePaths=new Set();
  for(const module of descriptor.modules) {
    if(!keys(module,['path','contentType'])||typeof module.path!=='string'||!module.path.startsWith('modules/')||modulePaths.has(module.path)||!fileMap.has(module.path)||!types.has(module.contentType))throw Error('Invalid Meld package module');
    modulePaths.add(module.path);
  }
  const main=descriptor.modules.find(module=>module.path===descriptor.mainModule);
  if(!main||main.contentType!=='application/javascript+module'||!fileMap.get(main.path).bytes)throw Error('Meld package has no module Worker entrypoint');
  const assets=artifact.files.filter(file=>file.path.startsWith('assets/'));
  if(!keys(descriptor.assets,['directory','files','controlFiles'])||descriptor.assets.directory!=='assets'||descriptor.assets.files!==assets.length||!assets.length||JSON.stringify(descriptor.assets.controlFiles)!==JSON.stringify(controls.filter(name=>fileMap.has('assets/'+name))))throw Error('Meld package assets are incomplete');
  if(artifact.files.some(file=>file.path!=='staging-package.json'&&!modulePaths.has(file.path)&&!file.path.startsWith('assets/')))throw Error('Unexpected content in the Meld package');
  // Read the committed blob through Git plumbing, never a candidate symlink on
  // the controller filesystem. No credentials, hooks or artifact code run here.
  let wrapper;
  try{wrapper=(await exec('git',['-C',context.source,'cat-file','blob',context.run.head+':apps/api/worker.mjs'],{env:{PATH:process.env.PATH,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'},encoding:'buffer',maxBuffer:1024*1024,timeout:30000})).stdout;}
  catch{throw Error('Cannot verify the committed Meld Worker wrapper');}
  if(sha(wrapper)!==descriptor.wrapperSha256)throw Error('Meld package wrapper differs from its committed candidate');
  return {binding:artifact.binding,manifestSha256:artifact.manifestSha256,descriptor,modules:descriptor.modules.map(module=>({...module,bytes:fileMap.get(module.path).bytes,sha256:fileMap.get(module.path).sha256})),assets,read:path=>artifact.read(path)};
}
