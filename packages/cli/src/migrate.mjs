import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const exec=promisify(execFile),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function responseText(response,max){
 const chunks=[];let size=0;
 if(response.body){const reader=response.body.getReader();for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw Error('Import receiver response exceeds its limit');}chunks.push(value);}}
 return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size));
}
/** Source stays read-only. Retry immutable uploads; never retry ref publication
 * automatically. An identical existing ref set proceeds to clone verification. */
export async function migrate(source,remote,handle,token,progress=()=>{},{fetcher=fetch,sleep=pause,environment=process.env}={}){
 const url=new URL(remote),address=url.pathname.match(/^\/git\/([a-z0-9][a-z0-9-]{0,62})(?:\/([a-z0-9][a-z0-9._-]{0,99}))?\.git\/?$/);
 if(url.username||url.password||url.search||url.hash||!/^https?:$/.test(url.protocol)||!address)throw Error('Use a plain Nanohub Git URL without credentials');
 if(url.protocol!=='https:'&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('HTTPS required');
 if(typeof handle!=='string'||!handle||handle.length>80||/[:\r\n\0]/.test(handle)||typeof token!=='string'||!/^[\x21-\x7e]{1,1024}$/.test(token))throw Error('A repository-scoped Git credential is required');
 const encoded=Buffer.from(`${handle}:${token}`).toString('base64'),authorization='Basic '+encoded,redact=value=>String(value).replaceAll(token,'[redacted]').replaceAll(encoded,'[redacted]');
 const clean={PATH:environment.PATH??process.env.PATH,HOME:environment.HOME??process.env.HOME,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'};
 const git=async(...args)=>(await exec('git',['-C',source,...args],{maxBuffer:128<<20,encoding:'buffer',env:clean})).stdout;
 const request=async(path,{method='GET',body,type='application/x-git-packed-objects',immutable=false}={})=>{
  for(let attempt=0;;attempt++){
   let response;
   try{response=await fetcher(url.href.replace(/\/$/,'')+path,{method,headers:{Authorization:authorization,...(body?{'Content-Type':type}:{})},body,redirect:'error',credentials:'omit',signal:AbortSignal.timeout(300000)});}
   catch{if(immutable&&attempt<3){progress({phase:'retrying immutable object upload',attempt:attempt+1});await sleep(500*(attempt+1));continue;}throw Error(method==='POST'&&!immutable?'Ref publication response was lost. Rerun the same import to verify identical refs; existing refs are never overwritten.':'Import transport failed; keep the destination and retry the same source');}
   if(immutable&&[429,503].includes(response.status)&&attempt<3){const seconds=Number(response.headers.get('retry-after'));await response.body?.cancel();await sleep(Number.isFinite(seconds)&&seconds>0?Math.min(60,seconds)*1000:1000*(attempt+1));continue;}
   return response;
  }
 };
 if((await git('rev-parse','--is-shallow-repository')).toString().trim()==='true')throw Error('Fetch complete history before migrating; a shallow source cannot prove lossless history');
 await git('fsck','--strict');
 const refs=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await git('for-each-ref','--format=%(objectname) %(refname)','refs/heads','refs/tags')).split('\n').filter(Boolean);
 const response=await request('/nanohub-import');
 if(!response.ok){await response.body?.cancel();throw Error(`Import discovery failed (${response.status}); receiver may be updating or this credential lacks access`);}
 const state=JSON.parse(await responseText(response,4<<20));
 if(state.protocol!=='nanohub-git-import-v1')throw Error('Import receiver is updating; no objects uploaded');
 if(state.mode!=='git'||!Array.isArray(state.refs))throw Error('Migration requires Git repository mode');
 if(!state.writable)throw Error('Migration requires current repository write access and Git push permission');
 const wanted=new Map(refs.map(line=>{const [sha,ref]=line.split(' ');return [ref,sha];}));
 const resumed=state.refs.length>0&&state.refs.length===refs.length&&state.refs.every(ref=>wanted.get(ref.name)===ref.commit);
 if(state.refs.length&&!resumed)throw Error('Migration requires an empty repository or exactly the same pinned refs; no existing ref is overwritten');
 const maximum=state.initialImportMaxRefs??100;
 if(!Number.isSafeInteger(maximum)||maximum<1||maximum>10_000||refs.length>maximum)throw Error(`Destination supports at most ${maximum} initial refs; no objects uploaded`);
 const branch=state.defaultBranch??'main';
 if(!wanted.has(`refs/heads/${branch}`))throw Error(`Destination default branch ${branch} is absent from the source; create the destination with a matching initial defaultBranch`);
 const ids=(await git('rev-list','--objects','--no-object-names',...wanted.values())).toString().trim().split('\n');let stored=0;
 if(!resumed){
  const descriptions=(await git('cat-file','--batch-check=%(objectname) %(objecttype) %(objectsize)','--batch-all-objects')).toString().trim().split('\n');
  const metadata=new Map(descriptions.map(line=>{const [sha,type,size]=line.split(' ');return [sha,{type,size:Number(size)}];}));
  const types={commit:1,tree:2,blob:3,tag:4};let entries=[],bytes=0;
  async function flush(){
   if(!entries.length)return;
   const header=Buffer.alloc(12);header.write('PACK');header.writeUInt32BE(2,4);header.writeUInt32BE(entries.length,8);
   const payload=Buffer.concat([header,...entries]),pack=Buffer.concat([payload,createHash('sha1').update(payload).digest()]);
   const answer=await request('/nanohub-import/objects',{method:'POST',body:pack,immutable:true});
   if(!answer.ok)throw Error(`Object upload failed (${answer.status}): ${redact(await responseText(answer,4096))}`);
   let acknowledgement;try{acknowledgement=JSON.parse(await responseText(answer,4096));}catch{throw Error('Object upload acknowledgement could not be read; retry the same import while its destination is empty');}
   if(acknowledgement.stored!==entries.length||acknowledgement.refsPublished!==false)throw Error('Object upload was not confirmed; inspect the destination before retrying');
   stored+=entries.length;progress({stored,total:ids.length});entries=[];bytes=0;
  }
  for(const sha of ids){
   const object=metadata.get(sha);if(!object||!types[object.type]||object.size>16<<20)throw Error(`Unsupported or oversized object ${sha}; no refs published`);
   if(bytes+object.size>4<<20)await flush();
   const body=await git('cat-file',object.type,sha),head=[types[object.type]<<4|body.length&15];
   for(let n=Math.floor(body.length/16);n;n=Math.floor(n/128)){head[head.length-1]|=128;head.push(n&127);}
   entries.push(Buffer.concat([Buffer.from(head),deflateSync(body)]));bytes+=body.length;
  }
  await flush();
  const pkt=text=>Buffer.from((Buffer.byteLength(text)+4).toString(16).padStart(4,'0')+text);
  const commands=refs.map((line,i)=>{const [sha,ref]=line.split(' ');return pkt(`${'0'.repeat(40)} ${sha} ${ref}${i===0?'\0report-status':''}\n`);});
  progress({phase:'publishing atomic refs',objects:stored});
  const answer=await request('/git-receive-pack',{method:'POST',type:'application/x-git-receive-pack-request',body:Buffer.concat([...commands,Buffer.from('0000')])});
  let report;try{report=await responseText(answer,4<<20);}catch{throw Error('Ref publication response could not be read. Rerun the same import to verify identical refs; existing refs are never overwritten.');}
  if(!answer.ok||report.includes('ng ')||!report.includes('unpack ok'))throw Error(`Refs were not confirmed: ${redact(report)}. Rerun the same import to inspect identical refs; existing refs are never overwritten.`);
 }
 progress({phase:'verifying independent clone',objects:ids.length,resumed});
 const directory=await mkdtemp(join(tmpdir(),'nanohub-verify-'));
 try{
  const env={...clean,HOME:directory,GIT_CONFIG_COUNT:'3',GIT_CONFIG_KEY_0:`http.${url.href.replace(/\/$/,'')}/.extraHeader`,GIT_CONFIG_VALUE_0:`Authorization: ${authorization}`,GIT_CONFIG_KEY_1:'http.followRedirects',GIT_CONFIG_VALUE_1:'false',GIT_CONFIG_KEY_2:'credential.helper',GIT_CONFIG_VALUE_2:''};
  try{await exec('git',['clone','--quiet','--mirror','--',url.href,join(directory,'copy.git')],{env,maxBuffer:2<<20});}
  catch(error){throw Error(`Verification clone failed: ${redact(error.stderr??error.message).slice(0,1500)}. Rerun the same import to verify identical refs.`);}
  const verify=async(...args)=>(await exec('git',['--git-dir',join(directory,'copy.git'),...args],{encoding:'utf8',maxBuffer:128<<20,env:clean})).stdout.replace(/\n$/,'');
  await verify('fsck','--strict');
  if(await verify('for-each-ref','--format=%(objectname) %(refname)','refs/heads','refs/tags')!==refs.join('\n'))throw Error('Ref/ID mismatch after migration');
  for(const line of refs.filter(ref=>ref.includes(' refs/heads/'))){const sha=line.split(' ')[0];if(await verify('ls-tree','-rz',sha)!==(await git('ls-tree','-rz',sha)).toString().trim())throw Error(`Tree/mode mismatch at ${sha}`);}
  return {verified:true,objects:ids.length,uploadedObjects:stored,refs:refs.length,fsck:'strict',resumed,scope:'committed branches and tags only; external LFS and submodules rejected'};
 }finally{await rm(directory,{recursive:true,force:true});}
}
