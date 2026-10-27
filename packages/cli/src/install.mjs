import {homedir} from 'node:os';
import {resolve,join,isAbsolute} from 'node:path';
import {lstat,readFile,mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const marker='#!/bin/sh\n# nanohub-cli managed launcher v1\n';
const quote=value=>`'${value.replaceAll("'","'\\''")}'`;
const sha256=value=>createHash('sha256').update(value).digest('hex');
export function parseInstallOptions(args) {
 const result={};for(let i=0;i<args.length;i++){
  if(!['--prefix','--origin'].includes(args[i])||!args[i+1]||args[i+1].startsWith('--'))throw Error('Usage: bun install.mjs [--prefix DIRECTORY] [--origin HTTPS_ORIGIN]');
  const key=args[i++].slice(2);if(result[key])throw Error(`Duplicate --${key}`);result[key]=args[i];
 }return result;
}
async function readBounded(response,limit) {
 if(!response.ok)throw Error(`Download failed (HTTP ${response.status})`);
 const reader=response.body?.getReader();if(!reader)throw Error('Empty download');
 let length=0;const chunks=[];try{while(true){const{done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit)throw Error('Download exceeds the size limit');chunks.push(value);}}finally{await reader.cancel();}
 return Buffer.concat(chunks);
}
async function existing(path) {try{return await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function atomicWrite(path,data,mode) {
 const temp=path+'.tmp-'+crypto.randomUUID();try{await writeFile(temp,data,{mode,flag:'wx'});await rename(temp,path);}finally{await rm(temp,{force:true});}
}
/** No credentials, package manager, shell-profile edits, or privilege escalation.
 * Only this installer's own launchers may be replaced on a later update. */
export async function install({origin='https://nanohub.sh',prefix=join(homedir(),'.local'),fetcher=fetch,platform=process.platform,executable=process.execPath,bunVersion=globalThis.Bun?.version}={}) {
 if(!['darwin','linux'].includes(platform))throw Error('The installer supports macOS and Linux. On other systems, run the downloaded nh.mjs directly with Bun.');
 const parts=String(bunVersion??'').split('.').map(Number);if(parts[0]<1||parts[0]===1&&parts[1]<4||!Number.isFinite(parts[0]))throw Error('Bun 1.4 or newer is required');
 const url=new URL(origin);if(url.origin!==origin||url.username||url.password||url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw Error('Use an HTTPS origin, or loopback HTTP for local testing');
 prefix=resolve(prefix);if(/[\x00-\x1f\x7f]/.test(prefix)||prefix==='/'||!isAbsolute(executable)||/[\x00-\x1f\x7f]/.test(executable))throw Error('Use a user-owned installation directory and an absolute Bun executable path');
 const binDir=join(prefix,'bin'),launchers=['nh','nanohub'].map(name=>join(binDir,name));
 for(const path of launchers){const info=await existing(path);if(info&&(!info.isFile()||!(await readFile(path,'utf8')).startsWith(marker)))throw Error(`Refusing to replace an existing command: ${path}. Choose another --prefix.`);}
 const get=async(path,limit)=>readBounded(await fetcher(origin+path,{redirect:'error',credentials:'omit',signal:AbortSignal.timeout(30000),headers:{'User-Agent':'nanohub-cli-installer/1'}}),limit);
 let manifest;try{manifest=JSON.parse((await get('/nh/latest.json',8192)).toString('utf8'));}catch(error){throw Error(`Could not read the CLI release manifest: ${error.message}`);}
 if(manifest.format!==1||!/^\d+\.\d+\.\d+$/.test(manifest.version??'')||manifest.path!==`/nh/releases/${manifest.version}/nh.mjs`||!/^[a-f0-9]{64}$/.test(manifest.sha256??'')||!Number.isInteger(manifest.bytes)||manifest.bytes<1||manifest.bytes>2*1024*1024)throw Error('Invalid CLI release manifest');
 const bundle=await get(manifest.path,2*1024*1024);if(bundle.length!==manifest.bytes||sha256(bundle)!==manifest.sha256)throw Error('CLI download integrity check failed; nothing was installed');
 const releaseDir=join(prefix,'share','nanohub-cli',`${manifest.version}-${manifest.sha256}`),bundlePath=join(releaseDir,'nh.mjs');
 const prior=await existing(bundlePath);if(prior&&(!prior.isFile()||sha256(await readFile(bundlePath))!==manifest.sha256))throw Error('Installed release differs from its checksum; choose a clean --prefix');
 await mkdir(releaseDir,{recursive:true,mode:0o700});if(!prior)await atomicWrite(bundlePath,bundle,0o600);await mkdir(binDir,{recursive:true});
 const launcher=marker+`exec ${quote(executable)} ${quote(bundlePath)} "$@"\n`;
 for(const path of launchers)await atomicWrite(path,launcher,0o755);
 return `Installed nh / nanohub ${manifest.version} in ${binDir}.\nAdd ${binDir} to PATH if needed.\nRun: nh --version\nExisting checkouts keep their previous CLI helper; run nh auth setup-git in each checkout to use this installation.`;
}
