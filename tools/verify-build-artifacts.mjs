/** Opt-in real-cloud component acceptance. No application deployment. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rename,realpath} from 'node:fs/promises';
import {join,isAbsolute,resolve} from 'node:path';
import {parseEnv,promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {stringify} from 'yaml';
import {Codegraff,executeActions} from './codegraff-actions.mjs';
import {loadBuildArtifact} from './build-artifacts.mjs';
import {verifySandboxAccess} from './sandbox-access.mjs';
import {observeSandbox} from './sandbox-observation.mjs';
import {quote} from './actions-workflow.mjs';

if(process.env.NANOHUB_LIVE_BUILD_ARTIFACTS!=='1')throw Error('Explicit NANOHUB_LIVE_BUILD_ARTIFACTS=1 is required; no cloud operation started');
const [imageFile,providerFile,destination]=process.argv.slice(2);
if(![imageFile,providerFile,destination].every(value=>value&&isAbsolute(value)))throw Error('Provide trusted image, provider environment and new private artifact paths');
const root=resolve(import.meta.dirname,'..'),exec=promisify(execFile);
const canonicalRoot=await realpath(root),canonicalParent=await realpath(join(destination,'..'));
const canonicalDestination=join(canonicalParent,destination.split('/').at(-1));
if(canonicalDestination===canonicalRoot||canonicalDestination.startsWith(canonicalRoot+'/'))throw Error('Keep private cloud receipts outside trusted source');
const clean={PATH:process.env.PATH,HOME:destination,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'};
const git=async(cwd,...args)=>(await exec('git',['-C',cwd,'-c','user.name=Artifact acceptance','-c','user.email=fixture@example.invalid',...args],{env:clean,timeout:60000,maxBuffer:2<<20})).stdout.trim();
assert.equal(await git(root,'status','--porcelain','--untracked-files=all'),'','Commit trusted tools before live acceptance');
if(destination===root||destination.startsWith(root+'/'))throw Error('Keep private cloud receipts outside trusted source');
await mkdir(destination,{mode:0o700});
const operation={format:1,phase:'preflight',pid:process.pid,startedAt:new Date().toISOString(),nanohubSource:await git(root,'rev-parse','HEAD'),hostedNanohub:false,applicationDeployment:false,cleanup:[],cleanupErrors:[]};
const save=async()=>{const path=join(destination,'operation.json'),temporary=path+'.'+randomUUID();await writeFile(temporary,JSON.stringify(operation,null,2)+'\n',{flag:'wx',mode:0o600});await rename(temporary,path);};
await save();let client,run,artifacts,secret;
try {
  const config=JSON.parse(await readFile(imageFile,'utf8'));
  secret=parseEnv(await readFile(providerFile,'utf8')).CODEGRAFF_API_KEY;
  await verifySandboxAccess(secret,{sandboxId:config.sandboxAccessProbeId});client=new Codegraff(secret);
  const source=join(destination,'source');artifacts=join(destination,'artifacts');await mkdir(source);await mkdir(artifacts,{mode:0o700});await mkdir(join(source,'.github/workflows'),{recursive:true});
  const producer=`const fs=require('node:fs');fs.mkdirSync('.stage-out/assets',{recursive:true});const b=Buffer.from(Array.from({length:200003},(_,i)=>(i*17+3)%256));fs.writeFileSync('.stage-out/assets/data.bin',b);fs.writeFileSync('.stage-out/duplicate.bin',b);fs.writeFileSync('.stage-out/empty','');fs.writeFileSync('.stage-out/worker.mjs','export default {fetch(){return new Response("artifact fixture")}};');`;
  const unsafe=`const fs=require('node:fs');fs.mkdirSync('.stage-out',{recursive:true});fs.writeFileSync('.stage-out/ordinary','fixture');fs.symlinkSync('/etc/passwd','.stage-out/unsafe-link');`;
  const workflow=stringify({name:'Artifact acceptance',on:'push',permissions:{contents:'read'},jobs:{valid:{'runs-on':'codegraff','timeout-minutes':10,steps:[{run:'node -e '+quote(producer)}]},unsafe:{'runs-on':'codegraff',needs:'valid','timeout-minutes':10,steps:[{run:'node -e '+quote(unsafe)}]}}},{aliasDuplicateObjects:false,lineWidth:0});
  await writeFile(join(source,'.github/workflows/artifact.yml'),workflow);await git(source,'init','-b','main');await git(source,'add','.');await git(source,'commit','-m','Synthetic artifact handoff acceptance');const head=await git(source,'rev-parse','HEAD');
  run={id:'artifact-live-'+Date.now(),attempt:1,head,base:head,branch:'main',leaseUntil:Date.now()+25*60000};operation.run=run;
  const policies=['valid','unsafe'].map(name=>({job:'artifact/'+name,directory:'/tmp/work/.stage-out',maxBytes:1024*1024,maxFiles:20}));
  operation.phase='execute';await save();console.log(JSON.stringify({phase:operation.phase,runId:run.id}));
  const completed=await executeActions({run,source,artifacts,artifactOrigin:'https://artifact-fixture.invalid/',active:async()=>Date.now()<run.leaseUntil-30000},{backend:'codegraff',image:config.image,imageRegistry:config.imageRegistry,network:'none',jobConcurrency:1,repository:'fixture/artifact',buildArtifacts:policies},{client});
  operation.results=completed.results;await save();
  const valid=completed.results.find(result=>result.name==='artifact/valid'),unsafeResult=completed.results.find(result=>result.name==='artifact/unsafe');assert.equal(valid.state,'success');assert.equal(unsafeResult.state,'failure');
  const artifact=await loadBuildArtifact({artifacts,run,policy:policies[0],image:config.image,result:valid});
  assert.deepEqual(await artifact.read('assets/data.bin'),Buffer.from(Array.from({length:200003},(_,i)=>(i*17+3)%256)));assert.deepEqual(await artifact.read('duplicate.bin'),await artifact.read('assets/data.bin'));assert.equal((await artifact.read('empty')).length,0);assert.equal((await artifact.read('worker.mjs')).toString(),'export default {fetch(){return new Response("artifact fixture")}};');
  const rejected=JSON.parse(await readFile(join(artifacts,'artifact-unsafe.build.json'),'utf8'));assert.equal(rejected.state,'failed');assert.equal(rejected.failure,'build_artifact_rejected');
  operation.validArtifact={manifestSha256:artifact.manifestSha256,fileCount:artifact.files.length,totalBytes:artifact.files.reduce((n,file)=>n+file.bytes,0)};operation.unsafeOutputRejected=true;operation.corePassed=true;
}catch(error){operation.corePassed=false;operation.failure=String(error?.message??error).replaceAll(secret??'\0','[redacted]').slice(0,1000);}
finally {
  if(client&&run&&artifacts)for(const job of ['artifact-valid','artifact-unsafe']) {
    let receipt;
    try{receipt=JSON.parse(await readFile(join(artifacts,job+'.sandbox.json'),'utf8'));}catch(error){if(error.code==='ENOENT')continue;operation.cleanupErrors.push('Cannot read owned VM receipt');continue;}
    try {
      assert.equal(receipt.runId,run.id);assert.equal(receipt.attempt,run.attempt);
      const observe=()=>observeSandbox(({timeoutMs})=>client.api('/sandboxes/'+receipt.sandboxId,undefined,'GET',timeoutMs),{deadline:Date.now()+60000,label:'artifact VM cleanup'});
      let state;try{state=(await observe()).state;}catch(error){if(error.status!==404)throw error;state='absent';}
      if(!['destroyed','deleted','expired','absent'].includes(state)){
        await client.destroy(receipt.sandboxId);try{state=(await observe()).state;}catch(error){if(error.status!==404)throw error;state='absent';}
      }
      assert.ok(['destroyed','deleted','expired','absent'].includes(state));
      operation.cleanup.push({sandboxId:receipt.sandboxId,state,independentRead:true,originalCleanupNeeded:receipt.cleanupNeeded});
    }catch{operation.cleanupErrors.push('Owned VM cleanup could not be confirmed');}
  }
  operation.acceptancePassed=operation.corePassed===true&&operation.cleanup.length===2&&operation.cleanupErrors.length===0&&operation.cleanup.every(value=>value.originalCleanupNeeded===false);
  operation.phase=operation.acceptancePassed?'finished':'failed';operation.finishedAt=new Date().toISOString();await save();
}
if(!operation.acceptancePassed)throw Error('Build artifact acceptance failed; inspect private receipts without replaying the launch');
console.log(JSON.stringify({acceptancePassed:true,validArtifact:operation.validArtifact,unsafeOutputRejected:true,cleanup:operation.cleanup}));
