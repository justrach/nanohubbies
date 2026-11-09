/** Prepare reviewed acceptance code from Git objects, never a candidate checkout.
 * The runtime-only, parentless bundle deliberately excludes human review media;
 * it is not a repository migration or a substitute for candidate CI. */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile,open,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,join,dirname,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';

const exec=promisify(execFile),prepared=new WeakMap(),sha=b=>createHash('sha256').update(b).digest('hex');
const required=['package.json','bun.lock','apps/web/package.json','apps/web/playwright.live.config.ts','tools/staging/live.mjs',...['global-setup','global-teardown','session','social-speed.live.spec','social-timings','target'].map(n=>'apps/web/e2e/live/'+n+'.ts')];
const script='playwright test -c playwright.live.config.ts social-speed --project=desktop';
const safe=path=>Buffer.byteLength(path)<=1024&&!/[\\\x00-\x1f\x7f]/.test(path)&&path.split('/').length<=32&&path.split('/').every(p=>p&&p!=='.'&&p!=='..'&&p.toLowerCase()!=='.git');

export async function prepareMeldLiveSuite({source,commit,output}) {
 if(!isAbsolute(source??'')||!isAbsolute(output??'')||!/^[a-f0-9]{40}$/.test(commit??''))throw Error('Use a private Git source, reviewed full suite commit and new absolute output path');
 source=await realpath(source);const parent=await realpath(dirname(output));output=join(parent,output.split('/').at(-1));
 if(output===source||output.startsWith(source+'/'))throw Error('Keep the trusted suite outside its source repository');
 const env={PATH:process.env.PATH,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_NO_REPLACE_OBJECTS:'1'};
 const git=async(repo,...args)=>(await exec('git',['--no-replace-objects','-C',repo,'-c','core.fsmonitor=false',...args],{env,timeout:120000,maxBuffer:4<<20})).stdout.trim();
 if(await git(source,'cat-file','-t',commit)!=='commit')throw Error('The reviewed acceptance source must be a commit');
 const raw=(await exec('git',['--no-replace-objects','-C',source,'ls-tree','-rlz','--full-tree',commit],{env,encoding:'buffer',timeout:30000,maxBuffer:4<<20})).stdout;
 if(!Buffer.from(raw.toString('utf8')).equals(raw))throw Error('Unsupported acceptance source paths');
 const entries=raw.toString('utf8').split('\0').filter(Boolean).map(line=>{const m=/^(\d{6}) (\w+) ([a-f0-9]{40})\s+(\d+|-)\t(.+)$/.exec(line);if(!m)throw Error('Invalid acceptance source tree');return {mode:m[1],type:m[2],blob:m[3],bytes:Number(m[4]),path:m[5]};});
 const keep=[],remove=[];let bytes=0;
 for(const entry of entries){
  if(!safe(entry.path))throw Error('Unsupported acceptance source paths');
  if(/^(?:review|review-evidence)\//.test(entry.path)){remove.push(entry.path);continue;}
  if(!['100644','100755'].includes(entry.mode)||entry.type!=='blob'||!Number.isSafeInteger(entry.bytes)||entry.bytes<0||entry.bytes>32*1024*1024)throw Error('Acceptance source refuses linked, special or oversized entries');
  if(/^(?:\.env(?:\..*)?|apps\/[^/]+\/\.env(?:\..*)?)$/.test(entry.path)&&!/(?:\.example|\.sample|\.template)$/.test(entry.path))throw Error('Active environment files are forbidden in the acceptance source');
  if((bytes+=entry.bytes)>128*1024*1024||keep.length>=9999)throw Error('Acceptance runtime source exceeds its bound');keep.push(entry);
 }
 if(required.some(path=>!keep.some(entry=>entry.path===path)))throw Error('The reviewed social acceptance suite is incomplete');
 const web=JSON.parse((await exec('git',['--no-replace-objects','-C',source,'show',commit+':apps/web/package.json'],{env,timeout:30000,maxBuffer:1<<20})).stdout);
 if(web.scripts?.['e2e:live:social']!==script||web.scripts['pree2e:live:social']||web.scripts['poste2e:live:social'])throw Error('Review the changed social acceptance command before using it');
 await mkdir(output,{mode:0o700});const repo=join(output,'snapshot.git');
 await exec('git',['init','--bare','-q','--initial-branch=main',repo],{env,timeout:30000});
 const objects=await realpath(resolve(source,await git(source,'rev-parse','--git-path','objects')));await writeFile(join(repo,'objects/info/alternates'),objects+'\n',{flag:'wx',mode:0o600});
 const buildEnv={...env,GIT_INDEX_FILE:join(output,'index'),GIT_AUTHOR_NAME:'Nanohub trusted acceptance',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Nanohub trusted acceptance',GIT_COMMITTER_EMAIL:'fixture@example.invalid',GIT_AUTHOR_DATE:'2000-01-01T00:00:00Z',GIT_COMMITTER_DATE:'2000-01-01T00:00:00Z'};
 const build=async(...args)=>(await exec('git',['--no-replace-objects','-C',repo,...args],{env:buildEnv,timeout:120000,maxBuffer:4<<20})).stdout.trim();
 await build('read-tree',commit);
 if(remove.length)await new Promise((accept,reject)=>{const child=execFile('git',['--no-replace-objects','-C',repo,'update-index','--index-info'],{env:buildEnv,timeout:30000},error=>error?reject(error):accept());child.stdin.end(remove.map(path=>'0 '+'0'.repeat(40)+'\t'+path+'\n').join(''));});
 const tree=await build('write-tree'),snapshot=await build('-c','commit.gpgSign=false','commit-tree',tree,'-m','Reviewed acceptance runtime snapshot of '+commit);
 await build('update-ref','refs/heads/main',snapshot);const bundlePath=join(output,'suite.bundle');await build('bundle','create',bundlePath,'HEAD');
 const bundle=await readFile(bundlePath);if(bundle.length>64*1024*1024)throw Error('Acceptance bundle exceeds the runner transfer bound');
 const manifest=Buffer.from(JSON.stringify({format:1,sourceCommit:commit,snapshotCommit:snapshot,excludedTopLevel:['review','review-evidence'],files:keep.map(({mode,blob,bytes,path})=>({path,mode,blob,bytes}))})+'\n');
 await writeFile(join(output,'manifest.json'),manifest,{flag:'wx',mode:0o600});
 const summary=Object.freeze({sourceCommit:commit,snapshotCommit:snapshot,fileCount:keep.length,runtimeBytes:bytes,bundleBytes:bundle.length,bundleSha256:sha(bundle),manifestSha256:sha(manifest)});
 prepared.set(summary,{source,directory:output,bundlePath,manifestPath:join(output,'manifest.json'),manifestBytes:manifest.length});return summary;
}

export async function readMeldLiveSuite(suite) {
 const state=prepared.get(suite);if(!state)throw Error('Use the original prepared trusted suite');
 const verified=async(path,bytes,digest)=>{
  let handle;
  try{
   handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
   const stat=await handle.stat();if(!stat.isFile()||stat.nlink!==1||stat.size!==bytes)throw Error('Acceptance suite provenance changed');
   const content=Buffer.alloc(bytes+1);let used=0;
   while(used<content.length){const result=await handle.read(content,used,content.length-used,used);if(!result.bytesRead)break;used+=result.bytesRead;}
   if(used!==bytes||sha(content.subarray(0,used))!==digest)throw Error('Acceptance suite provenance changed');
   return content.subarray(0,used);
  }catch{throw Error('Acceptance suite provenance changed');}finally{await handle?.close();}
 };
 const bundle=await verified(state.bundlePath,suite.bundleBytes,suite.bundleSha256);await verified(state.manifestPath,state.manifestBytes,suite.manifestSha256);
 return {source:state.source,directory:state.directory,bundle};
}
