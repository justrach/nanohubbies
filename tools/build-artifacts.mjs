/** Private build-to-deployer handoff. Candidate archive paths are never
 * extracted on the controller, and no deployment credentials enter the VM. */
import {constants} from 'node:fs';
import {open,readFile,writeFile,mkdir,rename,rm,lstat} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {join,isAbsolute,posix} from 'node:path';
import {quote} from './actions-workflow.mjs';
import {observeSandbox} from './sandbox-observation.mjs';

const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const jobName=value=>typeof value==='string'&&value.length<=100&&/^[\w.-]+\/[\w.-]+$/.test(value)&&value.split('/').every(part=>part!=='.'&&part!=='..');
const integer=(value,max)=>Number.isSafeInteger(value)&&value>0&&value<=max;
const manifestLimit=4*1024*1024,chunkBytes=32768;
const utf8=value=>typeof value==='string'&&Buffer.from(value).toString('utf8')===value;
const relativePath=value=>utf8(value)&&Buffer.byteLength(value)<=1024&&!/[\\\x00-\x1f\x7f]/.test(value)&&value.split('/').every(part=>part!==''&&part!=='.'&&part!=='..')&&value.split('/').length<=32;
const keys=(value,expected)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===expected.length&&expected.every(key=>Object.hasOwn(value,key));

export function buildArtifactPolicies(value) {
  if(value===undefined)return new Map();
  if(!Array.isArray(value)||value.length>29)throw Error('Use at most 29 trusted buildArtifacts policies');
  const policies=new Map();
  for(const item of value) {
    if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(k=>!['job','directory','maxBytes','maxFiles'].includes(k))||!jobName(item.job)||policies.has(item.job))throw Error('Use unique accepted job names for buildArtifacts');
    const directory=item.directory,maxBytes=item.maxBytes===undefined?128*1024*1024:item.maxBytes,maxFiles=item.maxFiles===undefined?10000:item.maxFiles;
    if(!utf8(directory)||!directory.startsWith('/tmp/work/')||posix.normalize(directory)!==directory||!relativePath(directory.slice('/tmp/work/'.length)))throw Error('Build artifact directory must be a canonical child of /tmp/work');
    if(!integer(maxBytes,1024*1024*1024)||!integer(maxFiles,20000))throw Error('Build artifact limits exceed their bounds');
    policies.set(item.job,{job:item.job,directory,maxBytes,maxFiles});
  }
  return policies;
}

export function validateBuildManifest(value,policy) {
  if(!keys(value,['format','files','totalBytes'])||value.format!==1||!Array.isArray(value.files)||!value.files.length||value.files.length>policy.maxFiles)throw Error('Invalid build artifact manifest');
  let total=0,previous;const files=new Map(),blobs=new Map();
  for(const item of value.files) {
    if(!keys(item,['path','bytes','sha256'])||!relativePath(item.path)||!Number.isSafeInteger(item.bytes)||item.bytes<0||item.bytes>policy.maxBytes||!digest(item.sha256))throw Error('Invalid build artifact file');
    if(previous!==undefined&&(Buffer.compare(Buffer.from(previous),Buffer.from(item.path))>=0||item.path.startsWith(previous+'/')))throw Error('Build artifact paths conflict or are not ordered');
    // An ancestor need not be adjacent to its child in the sorted list.
    const parts=item.path.split('/');for(let n=1;n<parts.length;n++)if(files.has(parts.slice(0,n).join('/')))throw Error('Build artifact paths conflict');
    previous=item.path;total+=item.bytes;
    if(total>policy.maxBytes||blobs.has(item.sha256)&&blobs.get(item.sha256)!==item.bytes)throw Error('Build artifact size mismatch');
    files.set(item.path,item);blobs.set(item.sha256,item.bytes);
  }
  if(value.totalBytes!==total)throw Error('Build artifact total does not match');
  return {files,blobs,totalBytes:total};
}

const binding=(run,job,image,sandbox)=>({runId:run.id,attempt:run.attempt,head:run.head,base:run.base,job,image,sandboxId:sandbox});
const receiptName=job=>job.replace('/','-')+'.build.json';
async function save(path,value) {
  const temporary=path+'.'+randomUUID();
  await writeFile(temporary,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
  await rename(temporary,path);
}
async function hashFile(path,bytes) {
  if(!constants.O_NOFOLLOW)throw Error('Build artifact reads require no-follow file support');
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const stat=await file.stat();if(!stat.isFile()||stat.size!==bytes)throw Error('Build artifact file size changed');
    const hash=createHash('sha256');let size=0;
    for await(const part of file.createReadStream({autoClose:false})) {
      size+=part.length;if(size>bytes)throw Error('Build artifact file grew');hash.update(part);
    }
    if(size!==bytes)throw Error('Build artifact file is incomplete');
    return hash.digest('hex');
  }finally{await file.close();}
}

export async function captureBuildArtifact({client,sandbox,container,run,job,image,policy,artifacts,active,deadline,now=Date.now}) {
  policy=buildArtifactPolicies([policy]).get(job);
  if(!policy||!isAbsolute(artifacts)||!/^[-\w]{1,160}$/.test(sandbox)||!/^[\w.-]{1,80}$/.test(container)||!/^[-\w]{1,160}$/.test(run?.id??'')||!integer(run?.attempt,Number.MAX_SAFE_INTEGER)||!/^[a-f0-9]{40}$/.test(run?.head??'')||!/^[a-f0-9]{40}$/.test(run?.base??'')||typeof image!=='string'||!/^(?:sha256:|[^\s]+@sha256:)[a-f0-9]{64}$/.test(image))throw Error('Invalid build artifact capture context');
  const record=binding(run,job,image,sandbox),receipt=join(artifacts,receiptName(job));
  const directory=job.replace('/','-')+'.build-'+randomUUID(),local=join(artifacts,directory);
  const remote='/workspace/nanohub/build-output-'+randomUUID(),script=remote+'.py';
  const pending={format:1,state:'pending',binding:record,policy,directory};
  const authorize=async options=>{
    if(now()>=deadline)throw Object.assign(Error('Job timed out during build output export'),{code:'job_deadline'});
    if(!await active(options))throw Object.assign(Error('Candidate lease is no longer active during build output export'),{code:'ci_cancelled'});
  };
  const observe=command=>observeSandbox(options=>client.exec(sandbox,command,options),{deadline,label:'build output read',now,sleep:ms=>client.sleep(ms),beforeRetry:authorize});
  await authorize();
  try{await writeFile(receipt,JSON.stringify(pending)+'\n',{flag:'wx',mode:0o600});}
  catch{throw Error('Build output receipt already exists or cannot be saved; reconcile before retrying');}
  let created=false;
  try {
    await mkdir(local,{mode:0o700});created=true;await mkdir(join(local,'blobs'),{mode:0o700});
    await client.upload(sandbox,script,await readFile(new URL('./build-artifact-export.py',import.meta.url)),{recover:true});
    await authorize();
    // This preparation mutates only a fresh VM-owned directory. Launch once;
    // a lost acknowledgement never starts another exporter.
    let summaryText;
    try{summaryText=await client.exec(sandbox,`python3 ${quote(script)} /workspace/nanohub/build-outputs/selected ${quote(remote)} ${policy.maxBytes} ${policy.maxFiles}`,{timeoutMs:Math.max(1,Math.min(60000,deadline-now()))});}
    catch(error){if(error.code==='sandbox_command_failed'&&error.exitCode===2)throw Object.assign(Error('Build output rejected'),{code:'build_artifact_rejected'});throw error;}
    const summary=JSON.parse(summaryText);
    if(!keys(summary,['bytes','sha256'])||!integer(summary.bytes,manifestLimit)||!digest(summary.sha256))throw Error('Invalid build output summary');
    const readPart=async(path,offset,bytes)=>{
      await authorize();
      const encoded=(await observe(`dd if=${quote(path)} bs=${chunkBytes} skip=${offset/chunkBytes} count=1 status=none | base64 -w 0`)).trim();
      const data=Buffer.from(encoded,'base64');
      if(data.length!==bytes||data.toString('base64')!==encoded)throw Error('Invalid build output chunk');
      return data;
    };
    const parts=[];
    for(let offset=0;offset<summary.bytes;offset+=chunkBytes)parts.push(await readPart(remote+'/manifest.json',offset,Math.min(chunkBytes,summary.bytes-offset)));
    const manifestBytes=Buffer.concat(parts);
    if(sha(manifestBytes)!==summary.sha256)throw Error('Build output manifest checksum mismatch');
    const manifest=JSON.parse(manifestBytes.toString('utf8')),validated=validateBuildManifest(manifest,policy);
    const tasks=[];
    for(const [digest,bytes] of validated.blobs) {
      const file=await open(join(local,'blobs',digest),'wx',0o600);
      try{await file.truncate(bytes);}finally{await file.close();}
      for(let offset=0;offset<bytes;offset+=chunkBytes)tasks.push({digest,offset,bytes:Math.min(chunkBytes,bytes-offset)});
    }
    let cursor=0,failure;
    await Promise.all(Array.from({length:Math.min(4,tasks.length)},async()=>{
      while(!failure&&cursor<tasks.length) {
        const task=tasks[cursor++];
        try {
          const data=await readPart(remote+'/blobs/'+task.digest,task.offset,task.bytes);
          const file=await open(join(local,'blobs',task.digest),constants.O_RDWR|constants.O_NOFOLLOW);
          try{let done=0;while(done<data.length){const written=await file.write(data,done,data.length-done,task.offset+done);if(!written.bytesWritten)throw Error('Build output write stopped');done+=written.bytesWritten;}}
          finally{await file.close();}
        }catch(error){failure??=error;}
      }
    }));
    if(failure)throw failure;
    for(const [digest,bytes] of validated.blobs)if(await hashFile(join(local,'blobs',digest),bytes)!==digest)throw Error('Build output blob checksum mismatch');
    await writeFile(join(local,'manifest.json'),manifestBytes,{flag:'wx',mode:0o600});
    await authorize();
    const complete={...pending,state:'complete',manifestSha256:summary.sha256,manifestBytes:summary.bytes,totalBytes:validated.totalBytes,fileCount:validated.files.size};
    await save(receipt,complete);return complete;
  }catch(error){
    // Drain issued reads before removing our own newly created host directory.
    if(created)await rm(local,{recursive:true,force:true});
    await save(receipt,{...pending,state:'failed',failure:['ci_cancelled','job_deadline','build_artifact_rejected'].includes(error.code)?error.code:'build_artifact_failed'});
    if(['ci_cancelled','job_deadline'].includes(error.code))throw error;
    throw Error('Build output export failed; inspect the private receipt');
  }
}

/** Require the trusted successful result and confirmed VM cleanup before use.
 * Every read rechecks the selected blob's hash; no candidate paths are opened. */
export async function loadBuildArtifact({artifacts,run,policy,image,result}) {
  if(!isAbsolute(artifacts))throw Error('Use an absolute private build output directory');
  const selected=buildArtifactPolicies([policy]).get(policy.job),job=selected.job;
  const receipt=JSON.parse(await readFile(join(artifacts,receiptName(job)),'utf8'));
  const b=receipt.binding,execution=result?.execution;
  if(receipt.format!==1||receipt.state!=='complete'||!b||JSON.stringify(receipt.policy)!==JSON.stringify(selected)||!digest(receipt.manifestSha256)||!integer(receipt.manifestBytes,manifestLimit))throw Error('Build output is not complete');
  const [workflow,jobId]=job.split('/');
  if(!result||result.name!==job||result.state!=='success'||execution?.provider!=='codegraff'||execution.job!==jobId||![`.github/workflows/${workflow}.yml`,`.github/workflows/${workflow}.yaml`].includes(execution.workflow)||!/^[-\w]{1,160}$/.test(execution.sandboxId??'')||JSON.stringify(b)!==JSON.stringify(binding(run,job,image,execution.sandboxId)))throw Error('Build output does not match the successful run');
  const prefix=job.replace('/','-')+'.build-';
  if(typeof receipt.directory!=='string'||!receipt.directory.startsWith(prefix)||!/^[a-f0-9-]{36}$/.test(receipt.directory.slice(prefix.length)))throw Error('Invalid private build output directory');
  const local=join(artifacts,receipt.directory),stat=await lstat(local);
  if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Invalid private build output directory');
  const cleanup=JSON.parse(await readFile(join(artifacts,job.replace('/','-')+'.sandbox.json'),'utf8'));
  if(cleanup.cleanupNeeded!==false||cleanup.sandboxId!==b.sandboxId||cleanup.runId!==run.id||cleanup.attempt!==run.attempt||cleanup.head!==run.head)throw Error('Build output VM cleanup is not confirmed');
  const manifestPath=join(local,'manifest.json');
  if(await hashFile(manifestPath,receipt.manifestBytes)!==receipt.manifestSha256)throw Error('Build output manifest changed');
  const manifest=JSON.parse(await readFile(manifestPath,'utf8')),validated=validateBuildManifest(manifest,selected);
  if(receipt.fileCount!==validated.files.size||receipt.totalBytes!==validated.totalBytes)throw Error('Build output receipt does not match its manifest');
  for(const [digest,bytes] of validated.blobs)if(await hashFile(join(local,'blobs',digest),bytes)!==digest)throw Error('Build output blob changed');
  return {binding:b,manifestSha256:receipt.manifestSha256,files:manifest.files,async read(path){
    const entry=validated.files.get(path);if(!entry)throw Error('Unknown build output file');
    if(await hashFile(join(local,'blobs',entry.sha256),entry.bytes)!==entry.sha256)throw Error('Build output blob changed');
    const file=await open(join(local,'blobs',entry.sha256),constants.O_RDONLY|constants.O_NOFOLLOW);
    try{const data=await file.readFile();if(data.length!==entry.bytes||sha(data)!==entry.sha256)throw Error('Build output blob changed');return data;}finally{await file.close();}
  }};
}
