import {mkdir,mkdtemp,readFile,writeFile,rename,rm,rmdir,lstat,chmod} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';

const stable=version=>typeof version==='string'&&version.length<=64&&/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const exists=async path=>{try{return await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}};
async function regular(path,limit=2*1024*1024){
  const stat=await exists(path);
  if(!stat)return null;
  if(!stat.isFile()||stat.size>limit)throw Error('CLI publication requires a bounded regular file: '+path);
  return readFile(path);
}
const immutable=version=>Error(`CLI release ${version} differs from its existing module or checksum; bump the package version or restore the verified release`);
async function sameRelease(release,version,module,checksum){
  const stat=await exists(release);
  if(!stat)return false;
  if(!stat.isDirectory()||stat.isSymbolicLink())throw immutable(version);
  const [prior,priorChecksum]=await Promise.all([regular(join(release,'nh.mjs')),regular(join(release,'SHA256SUMS'),256)]);
  if(!prior?.equals(module)||!priorChecksum?.equals(checksum))throw immutable(version);
  return true;
}
async function publishVersion(releases,version,module,checksum){
  const release=join(releases,version);
  if(await sameRelease(release,version,module,checksum))return;
  const staging=await mkdtemp(join(releases,'.stage-'));
  try{
    await writeFile(join(staging,'nh.mjs'),module,{flag:'wx'});
    await writeFile(join(staging,'SHA256SUMS'),checksum,{flag:'wx'});
    await chmod(staging,0o755);
    try{await rename(staging,release);}
    catch(error){
      // A directory is published complete. Never replace a winning release,
      // including a publisher that does not share this process's lock.
      if(!['EEXIST','ENOTEMPTY'].includes(error.code))throw error;
      if(!await sameRelease(release,version,module,checksum))throw error;
    }
  }finally{await rm(staging,{recursive:true,force:true});}
}
async function acquire(output,timeout){
  const path=join(output,'.release-publication-lock'),deadline=performance.now()+timeout;
  for(;;){
    try{await mkdir(path);return async()=>rmdir(path);}
    catch(error){if(error.code!=='EEXIST')throw error;}
    const stat=await exists(path);
    if(!stat)continue;
    if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Invalid CLI publication lock: '+path);
    const remaining=deadline-performance.now();
    if(remaining<=0)throw Error('CLI publication is busy; verify active builds before removing '+path);
    await pause(Math.min(50,remaining));
  }
}
function compare(a,b){
  const left=a.split('.').map(BigInt),right=b.split('.').map(BigInt);
  for(let i=0;i<3;i++)if(left[i]!==right[i])return left[i]>right[i]?1:-1;
  return 0;
}
function published(catalog,manifest){
  if(!catalog||catalog.format!==1||!catalog.releases||typeof catalog.releases!=='object'||Array.isArray(catalog.releases))throw Error('A valid published release catalog is required');
  const entries=Object.entries(catalog.releases);
  if(entries.length>10000)throw Error('Published release catalog is too large');
  let newest;
  for(const [version,record] of entries){
    if(!stable(version)||!record||!Number.isSafeInteger(record.bytes)||record.bytes<1||record.bytes>2*1024*1024||typeof record.sha256!=='string'||!/^[a-f0-9]{64}$/.test(record.sha256))throw Error('Published release catalog contains an invalid record');
    if(!newest||compare(version,newest)>0)newest=version;
    if(version===manifest.version&&(record.bytes!==manifest.bytes||record.sha256!==manifest.sha256))throw Error(`Published CLI release ${version} does not match its recorded bytes; bump the package version`);
  }
  if(newest&&compare(manifest.version,newest)<0)throw Error(`Refusing to publish older CLI ${manifest.version}; the catalog records ${newest}`);
}
async function latest(output,manifest){
  const bytes=await regular(join(output,'latest.json'),8192);
  if(!bytes)return;
  let prior;try{prior=JSON.parse(bytes.toString('utf8'));}catch{throw Error('Existing CLI release manifest is invalid; inspect it before publishing');}
  if(prior?.format!==1||!stable(prior.version)||prior.path!==`/nh/releases/${prior.version}/nh.mjs`||!Number.isSafeInteger(prior.bytes)||prior.bytes<1||prior.bytes>2*1024*1024||!/^[a-f0-9]{64}$/.test(prior.sha256??''))
    throw Error('Existing CLI release manifest is invalid; inspect it before publishing');
  if(compare(prior.version,manifest.version)>0)throw Error(`Refusing to move latest from ${prior.version} to older CLI ${manifest.version}`);
  if(prior.version===manifest.version&&(prior.bytes!==manifest.bytes||prior.sha256!==manifest.sha256))throw immutable(manifest.version);
}
async function prepare(path,bytes){
  const prior=await regular(path);
  if(prior?.equals(bytes))return null;
  const temporary=path+'.'+randomUUID()+'.tmp';
  try{await writeFile(temporary,bytes,{flag:'wx'});return temporary;}
  catch(error){if(error.code!=='EEXIST')await rm(temporary,{force:true});throw error;}
}

/** Cooperating processes serialize head updates. Version directories become
 * visible complete, and existing module/checksum bytes are never overwritten.
 * A crashed publisher's lock is deliberately not expired or stolen. */
export async function publishRelease(output,version,moduleBytes,installerBytes,{lockTimeoutMs=10000,catalog}={}){
  if(!stable(version))throw Error('A stable CLI version is required');
  if(!Number.isSafeInteger(lockTimeoutMs)||lockTimeoutMs<1||lockTimeoutMs>60000)throw Error('Use a bounded publication lock timeout');
  const module=Buffer.from(moduleBytes),installer=Buffer.from(installerBytes);
  if(!module.length||module.length>2*1024*1024||!installer.length||installer.length>2*1024*1024)throw Error('CLI module and installer must contain 1–2097152 bytes');
  output=resolve(output);
  const manifest={format:1,version,path:`/nh/releases/${version}/nh.mjs`,bytes:module.length,sha256:digest(module)};
  // A reviewed, committed catalog survives fresh offline CI checkouts. Missing
  // local output cannot turn a published version into an unlocked candidate.
  published(catalog,manifest);
  const checksum=Buffer.from(`${manifest.sha256}  nh.mjs\n`),head=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
  await mkdir(output,{recursive:true});
  const releaseLock=await acquire(output,lockTimeoutMs);
  let installerTemporary,manifestTemporary;
  try{
    await latest(output,manifest);
    const releases=join(output,'releases'),release=join(releases,version);
    const parent=await exists(releases);
    if(parent&&(!parent.isDirectory()||parent.isSymbolicLink()))throw Error('CLI releases require a regular directory: '+releases);
    // Detect legacy-layout conflicts before preparing or replacing either head.
    await sameRelease(release,version,module,checksum);
    installerTemporary=await prepare(join(output,'install.mjs'),installer);
    manifestTemporary=await prepare(join(output,'latest.json'),head);
    await mkdir(releases,{recursive:true});
    await publishVersion(releases,version,module,checksum);
    if(installerTemporary)await rename(installerTemporary,join(output,'install.mjs'));
    // The current manifest only names a complete, verified version directory.
    if(manifestTemporary)await rename(manifestTemporary,join(output,'latest.json'));
    return manifest;
  }finally{
    try{await Promise.all([installerTemporary,manifestTemporary].filter(Boolean).map(path=>rm(path,{force:true})));}
    finally{await releaseLock();}
  }
}
