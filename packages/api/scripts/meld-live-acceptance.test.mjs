import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir,chmod} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {prepareMeldLiveSuite} from '../../../tools/meld-live-suite.mjs';
import {createMeldLiveAcceptance} from '../../../tools/meld-live-acceptance.mjs';
import {meldUploadTarget} from '../../../tools/meld-worker-upload.mjs';

const token='testtesttesttest',digest=value=>createHash('sha256').update(value).digest('hex');
const marker='NANOHUB_MELD_LIVE_REPORT ';
const timing=platform=>({platform,ok:true,run:1,media:1,mediaBytes:10,previewMs:1,closeMs:1,saveMs:1,totalMs:3,lookupMs:1,downloadMs:1,uploadMs:1,failedRequests:0});
async function fixture(work){
 const directory=await mkdtemp(join(tmpdir(),'nh-live-acceptance-')),source=join(directory,'trusted-source'),candidate=join(directory,'candidate'),artifacts=join(directory,'artifacts');
 await Promise.all([source,candidate,artifacts].map(path=>mkdir(path)));
 const git=(...args)=>execFileSync('git',['-C',source,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args],{stdio:['ignore','pipe','pipe']}).toString().trim();
 const paths=['package.json','bun.lock','apps/web/playwright.live.config.ts','tools/staging/live.mjs',...['global-setup','global-teardown','session','social-speed.live.spec','social-timings','target'].map(n=>'apps/web/e2e/live/'+n+'.ts')];
 for(const path of paths){await mkdir(join(source,path,'..'),{recursive:true});await writeFile(join(source,path),'fixture');}
 await writeFile(join(source,'apps/web/package.json'),JSON.stringify({scripts:{'e2e:live:social':'playwright test -c playwright.live.config.ts social-speed --project=desktop'}}));git('init','-q','-b','main');git('add','.');git('commit','-qm','Reviewed suite');
 const suite=await prepareMeldLiveSuite({source,commit:git('rev-parse','HEAD'),output:join(directory,'prepared')});
 let clock=1000000,mode='success',jobs=0,authorizations=0,providerReads=0,setupReady=false,jobDone=false;const uploads=[],commands=[],versions=[];
 const context={run:{id:'run-1',attempt:1,branch:'release-1',ref:'refs/tags/release-1',head:'a'.repeat(40),base:'b'.repeat(40),leaseUntil:clock+3600000,deploymentApprovedBy:'owner'},source:candidate,artifacts,artifactOrigin:'https://nanohub.invalid/private/logs/',stagingOrigin:meldUploadTarget.origin,deploymentAuthorization:{id:'authorization-1'},deployRunId:'deployment-1',verifyDeployment:async()=>{providerReads++;if(mode==='provider-during-setup'&&setupReady||mode==='provider-after-job'&&jobDone)throw Error('Changed provider identity');},authorizeDeployment:async()=>{authorizations++;if(mode==='revoked'||mode==='revoke-during-setup'&&setupReady||mode==='revoke-after-job'&&jobDone)throw Error(token);return {id:'authorization-1'};}};
 const client={sleep:async()=>{clock+=1000;},exec:async(_sandbox,command)=>{commands.push(command);if(command.startsWith('docker exec')){if(mode==='expiry')clock+=3600000;if(mode==='setup')return 'invalid';setupReady=true;return 'ready';}return '';},upload:async(_sandbox,path,bytes)=>{uploads.push({path,bytes:Buffer.from(bytes)});if(mode==='upload')throw Error(token);}};
 const options={suite,client,image:'registry.cloudflare.com/'+'c'.repeat(32)+'/meld-ci@sha256:'+'d'.repeat(64),imageRegistry:{provider:'cloudflare',config:'/private/wrangler.jsonc'},registryCredentials:async()=>({}),credential:async()=>mode==='credential-during-setup'&&setupReady?token+'x':token,testTokenSha256:digest(token),fetcher:async url=>{versions.push(String(url));return Response.json({buildId:mode==='version'||mode==='version-during-setup'&&setupReady||mode==='version-after-job'&&jobDone?'ccccccc':context.run.head.slice(0,7)});},now:()=>clock};
 const dependencies={runJob:async job=>{
  jobs++;assert.equal(job.network,'bridge');assert.equal(job.controllerInput,true);assert.equal(job.bundle.toString('hex'),(await readFile(join(directory,'prepared','suite.bundle'))).toString('hex'));assert.equal(job.run.head,suite.snapshotCommit);assert.equal(job.run.base,suite.snapshotCommit);assert.equal(job.run.ref,'refs/heads/trusted-acceptance');assert.equal(context.run.ref,'refs/tags/release-1');assert.ok(!job.job.script.includes(token));assert.ok(!job.job.script.includes(context.source));
  const identity={candidate:context.run.head,sourceCommit:suite.sourceCommit,snapshotCommit:suite.snapshotCommit,deployRunId:context.deployRunId};
  const report={format:1,...identity,state:'success',exitCode:0,timings:['pinterest','x','telegram'].map(timing)};
  let startupError;try{await job.onStarted({sandbox:'owned-fixture',container:'nanohub-job',inputDirectory:'/workspace/nanohub/controller-input',deadline:clock+600000,active:job.active});}catch(error){startupError=error;}
  if(mode==='coverage')report.timings.pop();if(mode==='failed')report.timings[0].ok=false;if(mode==='identity')report.candidate='e'.repeat(40);if(mode==='text')report.timings[0].url=token;if(mode==='number')report.timings[0].saveMs=Infinity;if(mode==='exit')report.exitCode=1;if(mode==='empty')report.timings=[];
  const line=marker+Buffer.from(JSON.stringify(report)).toString('base64');
  await writeFile(join(job.artifacts,'acceptance-live.log'),mode==='duplicate'?line+'\n'+line:line+'\n');
  const receipt={cleanupNeeded:mode==='cleanup',image:options.image,controllerInput:true,sourceBundle:{sha256:suite.bundleSha256}};if(mode==='provenance')receipt.sourceBundle.sha256='e'.repeat(64);
  await writeFile(join(job.artifacts,'acceptance-live.sandbox.json'),JSON.stringify(receipt));
  jobDone=true;return {state:startupError||mode==='job'?'failure':'success'};
 }};
 try{await work({directory,context,suite,options,dependencies,uploads,commands,versions,make:()=>createMeldLiveAcceptance(options,dependencies),mode:value=>{mode=value;},get jobs(){return jobs;},get authorizations(){return authorizations;},get providerReads(){return providerReads;}});}finally{await rm(directory,{recursive:true,force:true});}
}

test('trusted live acceptance uses the independent suite, delayed readonly input, exact deployment and numeric private evidence',async()=>fixture(async f=>{
 const acceptance=f.make();assert.equal((await acceptance.preflight(f.context)).configured,true);assert.equal(f.jobs,0);
 const result=await acceptance.accept(f.context);assert.deepEqual(result,[{realService:true,url:f.context.artifactOrigin+'meld-live.log'}]);assert.equal(f.jobs,1);assert.equal(f.versions.length,3);assert.equal(f.providerReads,3);assert.ok(f.authorizations>=6);
 assert.equal(f.uploads.length,1);assert.deepEqual(JSON.parse(f.uploads[0].bytes),{candidate:f.context.run.head,token});assert.ok(f.uploads[0].path.endsWith('/pending.json'));assert.ok(f.commands.some(command=>command.startsWith('chmod 400')));assert.ok(!JSON.stringify(f.commands).includes(token));
 const evidence=await readFile(join(f.context.artifacts,'meld-live.log'),'utf8');assert.ok(!evidence.includes(token));const report=JSON.parse(evidence);assert.equal(report.binding.candidate,f.context.run.head);assert.equal(report.binding.sourceCommit,f.suite.sourceCommit);assert.equal(report.sandboxDestroyed,true);assert.equal(report.report.timings.length,3);
 assert.deepEqual((await readdir(f.context.artifacts)).filter(name=>name.endsWith('.log')),['meld-live.log']);
 await assert.rejects(acceptance.accept(f.context),/already started/);await assert.rejects(f.make().accept(f.context),/already started/);assert.equal(f.jobs,1);
}));

test('credential mismatch, resolver failures, target/approval and source boundaries fail before allocation',async()=>{
 for(const mode of ['digest','credential','resolver','target','approval','candidate-suite','receipts','lease','origin'])await fixture(async f=>{
  if(mode==='digest')f.options.testTokenSha256='e'.repeat(64);
  if(mode==='credential')f.options.credential=async()=>token+'\n';
  if(mode==='resolver')f.options.credential=async()=>{throw Error(token);};
  if(mode==='target')f.context.stagingOrigin='https://meld.space';if(mode==='approval')f.context.run.deploymentApprovedBy=null;
  if(mode==='candidate-suite')f.context.source=f.directory;if(mode==='receipts')f.context.artifacts=f.context.source;
  if(mode==='lease')f.context.run.leaseUntil=0;if(mode==='origin')f.context.artifactOrigin='https://host.invalid/logs/?secret=fixture';
  await assert.rejects(f.make().preflight(f.context),error=>!error.message.includes(token));assert.equal(f.jobs,0);assert.equal(f.uploads.length,0);assert.deepEqual(await readdir(f.context.artifacts),[]);
 });
});

test('failed jobs, ambiguous/incomplete/forged reports, cleanup and provenance cannot become real-service evidence',async()=>{
 for(const mode of ['coverage','failed','identity','text','number','exit','empty','duplicate','cleanup','provenance','job'])await fixture(async f=>{
  f.mode(mode);await assert.rejects(f.make().accept(f.context),/Trusted real-service acceptance failed/);await assert.rejects(readFile(join(f.context.artifacts,'meld-live.log')),{code:'ENOENT'});assert.equal(f.jobs,1);await assert.rejects(f.make().accept(f.context),/already started/);assert.equal(f.jobs,1);
 });
});

test('revoked authority, setup failure, expired deadline, version movement or uncertain input writes stop without retrying',async()=>{
 for(const mode of ['revoked','setup','expiry','version','upload'])await fixture(async f=>{
  f.mode(mode);await assert.rejects(f.make().accept(f.context),error=>/Trusted real-service acceptance failed/.test(error.message)&&!error.message.includes(token));
  assert.ok(f.jobs<=1);assert.equal(f.uploads.length,mode==='upload'?1:0);assert.ok(!f.commands.some(command=>command.startsWith('chmod 400')));await assert.rejects(readFile(join(f.context.artifacts,'meld-live.log')),{code:'ENOENT'});
  if(mode==='expiry')f.context.run.leaseUntil+=3600000;
  const priorJobs=f.jobs;await assert.rejects(f.make().accept(f.context),/already started/);assert.equal(f.jobs,priorJobs);
 });
});

test('trusted wrapper and shell script parse without executing application code or real service calls',async()=>fixture(async f=>{
 const dependencies={runJob:async options=>{
  const encoded=/printf %s '([^']+)' \| base64 -d/.exec(options.job.script)?.[1];assert.ok(encoded);const guest=Buffer.from(encoded,'base64').toString();assert.ok(guest.includes("stdio:'ignore'"));assert.ok(guest.includes("['run','--cwd','apps/web','e2e:live:social']"));assert.ok(!guest.includes(token));
  const shell=join(f.directory,'job.sh'),script=join(f.directory,'guest.mjs');await writeFile(shell,options.job.script);await writeFile(script,guest);execFileSync('bash',['-n',shell]);execFileSync(process.execPath,['--check',script]);return {state:'failure'};
 }};
 await assert.rejects(createMeldLiveAcceptance(f.options,dependencies).accept(f.context),/Trusted real-service acceptance failed/);
}));


test('authority, deployed build and credential digest are revalidated after setup and after the live suite',async()=>{
 for(const mode of ['credential-during-setup','revoke-during-setup','version-during-setup','revoke-after-job','version-after-job','provider-during-setup','provider-after-job'])await fixture(async f=>{
  f.mode(mode);await assert.rejects(f.make().accept(f.context),/Trusted real-service acceptance failed/);
  assert.equal(f.jobs,1);assert.equal(f.uploads.length,mode.endsWith('after-job')?1:0);await assert.rejects(readFile(join(f.context.artifacts,'meld-live.log')),{code:'ENOENT'});
 });
});

test('the actual guest wrapper consumes multiline timings, runs the fixed command with only test-scoped environment and suppresses child output',async()=>fixture(async f=>{
 const dependencies={runJob:async options=>{
  await options.onStarted({sandbox:'owned-fixture',container:'nanohub-job',inputDirectory:'/workspace/nanohub/controller-input',deadline:f.options.now()+600000,active:options.active});
  const root=join(f.directory,'guest-runtime'),work=join(root,'work'),input=join(root,'input'),bin=join(root,'bin');
  await mkdir(join(work,'tools/staging'),{recursive:true});await mkdir(join(work,'apps/web/test-results/live'),{recursive:true});await mkdir(input);await mkdir(bin);
  await writeFile(join(input,'live.json'),f.uploads[0].bytes);
  await writeFile(join(work,'tools/staging/live.mjs'),`export function liveEnvironment(candidate,token){return {PATH:process.env.PATH,MELD_LIVE_TEST_TOKEN:token,MELD_LIVE_EXPECT_BUILD:candidate};} export function liveResult(code,rows){return {state:code===0&&rows.every(row=>row.ok)?'success':'failure'};}`);
  const stub=`#!${process.execPath}\nimport assert from 'node:assert/strict';import {writeFileSync} from 'node:fs';assert.deepEqual(process.argv.slice(2),['run','--cwd','apps/web','e2e:live:social']);assert.equal(process.env.MELD_LIVE_TEST_TOKEN,${JSON.stringify(token)});assert.equal(process.env.MELD_LIVE_EXPECT_BUILD,${JSON.stringify(f.context.run.head)});assert.equal(process.env.CODEGRAFF_API_KEY,undefined);assert.ok(process.env.MELD_LIVE_AUTH_STATE.startsWith(${JSON.stringify(root)}));writeFileSync(${JSON.stringify(join(work,'apps/web/test-results/live/social-timings.jsonl'))},${JSON.stringify(['pinterest','x','telegram'].map(timing).map(row=>JSON.stringify({...row,failedRequests:[],url:'https://private.invalid/fixture'})).join('\n')+'\n')});console.log('private fixture output must be suppressed');`;
  await writeFile(join(bin,'bun'),stub);await chmod(join(bin,'bun'),0o755);
  const encoded=/printf %s '([^']+)' \| base64 -d/.exec(options.job.script)[1];
  const guest=Buffer.from(encoded,'base64').toString().replaceAll('/tmp/work',work).replaceAll('/nanohub-input',input).replaceAll('/tmp/nanohub-live-ready',join(root,'ready')).replaceAll('/tmp/nanohub-live-session.json',join(root,'session.json'));
  const script=join(root,'guest.mjs');await writeFile(script,guest);const identity={candidate:f.context.run.head,sourceCommit:f.suite.sourceCommit,snapshotCommit:f.suite.snapshotCommit,deployRunId:f.context.deployRunId};
  const output=execFileSync(process.execPath,[script,JSON.stringify(identity)],{cwd:work,env:{PATH:bin+':'+process.env.PATH,CODEGRAFF_API_KEY:'testtesttesttest'},stdio:['ignore','pipe','pipe'],timeout:10000}).toString();
  assert.equal(output.trim().split('\n').length,1);assert.ok(output.startsWith(marker));assert.ok(!output.includes('private fixture output'));
  await writeFile(join(options.artifacts,'acceptance-live.log'),output);await writeFile(join(options.artifacts,'acceptance-live.sandbox.json'),JSON.stringify({cleanupNeeded:false,image:f.options.image,controllerInput:true,sourceBundle:{sha256:f.suite.bundleSha256}}));return {state:'success'};
 }};
 const result=await createMeldLiveAcceptance(f.options,dependencies).accept(f.context);assert.equal(result[0].realService,true);
 const evidence=await readFile(join(f.context.artifacts,'meld-live.log'),'utf8');assert.ok(!evidence.includes('private.invalid'));assert.ok(!evidence.includes(token));
}));
