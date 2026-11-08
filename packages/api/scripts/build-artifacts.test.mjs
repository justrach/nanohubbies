import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,symlink,unlink,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:net';
import {buildArtifactPolicies,validateBuildManifest,captureBuildArtifact,loadBuildArtifact} from '../../../tools/build-artifacts.mjs';
import {sandboxJob} from '../../../tools/codegraff-actions.mjs';
import {runProcess,runOnce} from '../../../tools/ci-runner.mjs';
import {quote} from '../../../tools/actions-workflow.mjs';

const policy={job:'check/test',directory:'/tmp/work/out',maxBytes:1024*1024,maxFiles:20};
const run={id:'run-id',attempt:1,head:'a'.repeat(40),base:'b'.repeat(40),branch:'feature',leaseUntil:Date.now()+600000};
const image='registry.invalid/ci@sha256:'+'c'.repeat(64);
const normal=[{name:'out',type:'dir'},{name:'out/assets',type:'dir'},{name:'out/worker.mjs',data:Buffer.from('export default {fetch(){return new Response("fixture")}}')},{name:'out/assets/data.bin',data:Buffer.alloc(90000,177)},{name:'out/duplicate.bin',data:Buffer.alloc(90000,177)},{name:'out/empty',data:Buffer.alloc(0)}];
const result={name:policy.job,state:'success',execution:{provider:'codegraff',sandboxId:'box-1',workflow:'.github/workflows/check.yml',job:'test'}};
async function fixture(entries=normal,{fault}={}) {
  const dir=await mkdtemp(join(tmpdir(),'nanohub-build-output-')),vm=join(dir,'vm'),bin=join(dir,'bin'),artifacts=join(dir,'artifacts');
  await mkdir(join(vm,'workspace/nanohub'),{recursive:true});await mkdir(bin);await mkdir(artifacts);
  const snapshot=join(vm,'workspace/nanohub/build-outputs/selected');
  await mkdir(join(snapshot,'assets'),{recursive:true});
  for(const entry of normal.filter(e=>e.data))await writeFile(join(snapshot,entry.name.slice(4)),entry.data);
  const tar=join(dir,'candidate.tar');
  execFileSync('python3',['-c',`import tarfile,io,json,sys,base64
with tarfile.open(sys.argv[1],"w",format=tarfile.PAX_FORMAT) as tar:
 for value in json.loads(sys.argv[2]):
  item=tarfile.TarInfo(value["name"]);item.mode=0o644
  kind=value.get("type","file")
  if kind=="dir":item.type=tarfile.DIRTYPE;tar.addfile(item)
  elif kind in ("symlink","hardlink","fifo"):
   item.type={"symlink":tarfile.SYMTYPE,"hardlink":tarfile.LNKTYPE,"fifo":tarfile.FIFOTYPE}[kind];item.linkname=value.get("target","/etc/passwd");tar.addfile(item)
  else:
   data=base64.b64decode(value.get("data",""));item.size=len(data);tar.addfile(item,io.BytesIO(data))
`,tar,JSON.stringify(entries.map(e=>({...e,name:e.name==='out'?'selected':e.name.startsWith('out/')?'selected'+e.name.slice(3):e.name,data:e.data?.toString('base64')})))]);
  await writeFile(join(bin,'tar'),'#!/bin/sh\ncat '+quote(tar)+'\n',{mode:0o700});
  const calls=[];let injected=false,live=true;
  const client={calls,sleep:async()=>{},api:async()=>({id:'box-1'}),ready:async()=>{},destroy:async()=>{calls.push('destroy');},
    upload:async(_id,path,bytes)=>{const target=join(vm,path);await mkdir(join(target,'..'),{recursive:true});await writeFile(target,bytes);},
    exec:async(_id,command)=>{
      calls.push(command);
      const exportCommand=(command.startsWith('python3 ')&&command.includes('/workspace/nanohub/build-output-'));
      const reading=command.startsWith('dd if=');
      if(reading&&fault==='read-reset'&&!injected){injected=true;throw Object.assign(Error('reset'),{code:'ECONNRESET'});}
      if(reading&&fault==='revoke'&&!injected){injected=true;live=false;throw Object.assign(Error('reset'),{code:'ECONNRESET'});}
      if(!exportCommand&&!reading) {
        if(command.startsWith('docker inspect'))return JSON.stringify({Running:false,ExitCode:fault==='failed-test'?7:0});
        if(command.startsWith('docker logs'))return 'fixture test output';
        return '';
      }
      const commandResult=await runProcess('sh',['-c',command.replaceAll('/workspace/nanohub',join(vm,'workspace/nanohub'))],{env:{PATH:bin+':'+process.env.PATH,HOME:dir},timeoutMs:10000});
      if(commandResult.code)throw Object.assign(Error('control command failed'),{code:'sandbox_command_failed',exitCode:commandResult.code});
      if(exportCommand&&fault==='lost-export')throw Object.assign(Error('lost acknowledgement'),{code:'ECONNRESET'});
      if(reading&&command.includes('/blobs/')&&fault==='corrupt')return (commandResult.output[0]==='A'?'B':'A')+commandResult.output.slice(1);
      // Simulate the real gateway's bounded response.
      return commandResult.output.slice(0,65536);
    }};
  return {dir,snapshot,artifacts,client,active:async()=>live,async capture(selected=policy){return captureBuildArtifact({client,sandbox:'box-1',container:'nanohub-job',run,job:policy.job,image,policy:selected,artifacts,active:async()=>live,deadline:Date.now()+60000});},async cleanupReceipt(needed=false){await writeFile(join(artifacts,'check-test.sandbox.json'),JSON.stringify({sandboxId:'box-1',runId:run.id,attempt:run.attempt,head:run.head,cleanupNeeded:needed}));},load(overrides={}){return loadBuildArtifact({artifacts,run,policy,image,result,...overrides});},close:()=>rm(dir,{recursive:true,force:true})};
}

test('artifact policy validates before provider access or a claim',async()=>{
  assert.equal(buildArtifactPolicies().size,0);
  for(const value of [null,{},[{...policy,job:'../bad'}],[policy,policy],[{...policy,directory:'/etc'}],[{...policy,directory:'/tmp/work/a/../b'}],[{...policy,directory:'/tmp/work/'}],[{...policy,maxBytes:null}],[{...policy,maxFiles:20001}],[{...policy,secret:'no'}]])assert.throws(()=>buildArtifactPolicies(value));
  const config={origin:'https://never-contact.invalid',repository:'alice/repo',backend:'codegraff',image,artifacts:'/private/artifacts',buildArtifacts:[{...policy,directory:'/root'}]};
  await assert.rejects(runOnce(config,'unused'),/canonical child/);
  await assert.rejects(runOnce({...config,backend:'docker',buildArtifacts:[policy]},'unused'),/Codegraff backend/);
});

test('actual trusted tar reader and bounded transport retain binary, empty and duplicate output files',async()=>{
  const f=await fixture(normal,{fault:'read-reset'});
  try {
    const receipt=await f.capture();assert.equal(receipt.state,'complete');assert.equal(receipt.fileCount,4);
    assert.equal(f.client.calls.filter(c=>(c.startsWith('python3 ')&&c.includes('/workspace/nanohub/build-output-'))).length,1);
    await assert.rejects(f.load(),/ENOENT|cleanup/);await f.cleanupReceipt(true);await assert.rejects(f.load(),/cleanup/);await f.cleanupReceipt();
    const artifact=await f.load();assert.deepEqual(await artifact.read('assets/data.bin'),normal[3].data);assert.deepEqual(await artifact.read('empty'),Buffer.alloc(0));
    assert.deepEqual(await artifact.read('duplicate.bin'),normal[3].data);await assert.rejects(artifact.read('../escape'),/Unknown/);
    assert.equal((await readdir(join(f.artifacts,receipt.directory,'blobs'))).length,3);
    for(const overrides of [{run:{...run,attempt:2}},{run:{...run,head:'d'.repeat(40)}},{image:'sha256:'+'e'.repeat(64)},{result:{...result,state:'failure'}},{result:{...result,execution:{...result.execution,job:'other'}}}])await assert.rejects(f.load(overrides),/successful run/);
    const blob=artifact.files.find(e=>e.path==='worker.mjs'),path=join(f.artifacts,receipt.directory,'blobs',blob.sha256);
    await writeFile(path,Buffer.alloc(blob.bytes,0));await assert.rejects(f.load(),/blob changed/);await assert.rejects(artifact.read('worker.mjs'),/blob changed/);
    await unlink(path);await writeFile(join(f.dir,'outside'),normal[2].data);await symlink(join(f.dir,'outside'),path);await assert.rejects(f.load());
  }finally{await f.close();}
});

test('candidate archives cannot extract links, devices, traversal, duplicate or conflicting paths',async()=>{
  const attacks=[
    [{name:'out/link',type:'symlink'}],[{name:'out/link',type:'hardlink'}],[{name:'out/pipe',type:'fifo'}],
    [{name:'../escape',data:Buffer.from('bad')}],[{name:'/out/escape',data:Buffer.from('bad')}],
    [{name:'out/a',data:Buffer.from('a')},{name:'out/a',data:Buffer.from('b')}],
    [{name:'out/a',data:Buffer.from('a')},{name:'out/a/b',data:Buffer.from('b')}],
    [{name:'out/back\\slash',data:Buffer.from('bad')}],
    [{name:'out/'+('x/'.repeat(33))+'file',data:Buffer.from('bad')}],
  ];
  for(const attack of attacks) {
    const f=await fixture([{name:'out',type:'dir'},...attack]);
    try{await assert.rejects(f.capture(),/export failed/);assert.equal(JSON.parse(await readFile(join(f.artifacts,'check-test.build.json'))).state,'failed');assert.deepEqual(await readdir(f.artifacts),['check-test.build.json']);await assert.rejects(readFile(join(f.dir,'escape')));}
    finally{await f.close();}
  }
});

test('export bounds, corrupt chunks, revocation and ambiguous exporter acknowledgements never publish an artifact',async()=>{
  for(const mode of ['size','count','corrupt','revoke','lost-export']) {
    const f=await fixture(normal,{fault:mode});
    try {
      await assert.rejects(f.capture(mode==='size'?{...policy,maxBytes:10}:mode==='count'?{...policy,maxFiles:1}:policy));
      assert.equal(JSON.parse(await readFile(join(f.artifacts,'check-test.build.json'))).state,'failed');
      assert.deepEqual(await readdir(f.artifacts),['check-test.build.json']);
      assert.equal(f.client.calls.filter(c=>(c.startsWith('python3 ')&&c.includes('/workspace/nanohub/build-output-'))).length,1);
      await assert.rejects(f.capture(),/receipt already exists|no longer active/);
      assert.equal(f.client.calls.filter(c=>(c.startsWith('python3 ')&&c.includes('/workspace/nanohub/build-output-'))).length,1);
    }finally{await f.close();}
  }
});

test('snapshot inspection refuses actual sockets and symlinked roots before tar can omit them',async()=>{
  for(const kind of ['socket','root-link']) {
    const f=await fixture();let server;
    try {
      if(kind==='socket'){
        server=createServer();const socket=join(f.dir,'s');
        await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socket,resolve);});
        await rename(socket,join(f.snapshot,'socket'));
      }else{await rm(f.snapshot,{recursive:true});await symlink(f.dir,f.snapshot);}
      await assert.rejects(f.capture(),/export failed/);
      const record=JSON.parse(await readFile(join(f.artifacts,'check-test.build.json')));assert.equal(record.failure,'build_artifact_rejected');
      assert.deepEqual(await readdir(f.artifacts),['check-test.build.json']);
    }finally{if(server)await new Promise(resolve=>server.close(resolve));await f.close();}
  }
});

test('manifest validation rejects host traversal, ordering, ancestor collisions and inconsistent content identities',()=>{
  const file=(path,bytes=1)=>({path,bytes,sha256:'a'.repeat(64)}),manifest=files=>({format:1,files,totalBytes:files.reduce((n,f)=>n+f.bytes,0)});
  for(const files of [[file('../escape')],[file('/root')],[file('a'),file('a')],[file('z'),file('a')],[file('a'),file('a-b'),file('a/b')],[file('a',1),file('b',2)]])assert.throws(()=>validateBuildManifest(manifest(files),policy));
});

test('native jobs capture only after successful exit, require outputs and confirm VM cleanup before handoff',async()=>{
  for(const fault of [undefined,'failed-test','lost-export']) {
    const f=await fixture(normal,{fault});
    try {
      const job={name:policy.job,id:'test',workflow:'.github/workflows/check.yml',script:'true',timeoutMs:60000};
      const completed=await sandboxJob({client:f.client,job,run,bundle:Buffer.from('synthetic bundle'),image,artifacts:f.artifacts,artifactOrigin:'https://logs.invalid/',repository:'alice/repo',active:f.active,buildArtifact:policy});
      assert.equal(completed.state,fault?'failure':'success');assert.equal(f.client.calls.filter(c=>c==='destroy').length,1);
      if(!fault){const artifact=await f.load({result:completed});assert.deepEqual(await artifact.read('worker.mjs'),normal[2].data);}
      if(fault==='failed-test')assert.ok(!f.client.calls.some(c=>(c.startsWith('python3 ')&&c.includes('/workspace/nanohub/build-output-'))));
      else assert.equal(f.client.calls.filter(c=>(c.startsWith('python3 ')&&c.includes('/workspace/nanohub/build-output-'))).length,1);
    }finally{await f.close();}
  }
});
