/** Trusted real-service acceptance controller. Candidate source never runs here.
 * Activation requires an independently reviewed suite, inspected staging token
 * digest and explicit operator configuration. No credential discovery/fallback. */
import {open,mkdir,realpath,readFile,writeFile} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {sandboxJob} from './codegraff-actions.mjs';
import {readMeldLiveSuite} from './meld-live-suite.mjs';
import {cloudflareRegistry} from './toolchain.mjs';
import {meldUploadTarget} from './meld-worker-upload.mjs';
import {verifyVersion} from './ci-runner.mjs';
import {observeSandbox} from './sandbox-observation.mjs';
import {quote} from './actions-workflow.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');
const marker='NANOHUB_MELD_LIVE_REPORT ';
const platforms=['pinterest','x','telegram'];
const numbers=['run','media','mediaBytes','previewMs','closeMs','saveMs','totalMs','lookupMs','downloadMs','uploadMs','failedRequests'];
const inside=(child,parent)=>child===parent||child.startsWith(parent+'/');
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const keys=(value,allowed)=>object(value)&&Object.keys(value).length===allowed.length&&Object.keys(value).every(k=>allowed.includes(k));

// Runs only inside the disposable, non-root acceptance container. All raw
// browser traces, cookies, failure screenshots and stdout stay in its tmpfs.
function guestMain() {
 return `(async()=>{
 const {readFile,writeFile,stat}=await import('node:fs/promises');
 const {spawn}=await import('node:child_process');
 let state='failure',exitCode=1,timings=[];
 const identity=JSON.parse(process.argv[2]);
 try {
  await writeFile('/tmp/nanohub-live-ready','ready',{mode:0o600});
  const until=Date.now()+120000;let input;
  while(Date.now()<until){try{const s=await stat('/nanohub-input/live.json');if(s.size>8192)throw Error('Invalid input');input=JSON.parse(await readFile('/nanohub-input/live.json','utf8'));break;}catch{await new Promise(r=>setTimeout(r,250));}}
  if(!input||input.candidate!==identity.candidate)throw Error('No exact candidate input');
  const {liveEnvironment,liveResult}=await import('/tmp/work/tools/staging/live.mjs');
  const env={...liveEnvironment(identity.candidate,input.token),MELD_LIVE_AUTH_STATE:'/tmp/nanohub-live-session.json'};
  exitCode=await new Promise(resolve=>{const child=spawn('bun',['run','--cwd','apps/web','e2e:live:social'],{env,stdio:'ignore'});child.once('error',()=>resolve(1));child.once('exit',code=>resolve(Number.isInteger(code)?code:1));});
  const file='/tmp/work/apps/web/test-results/live/social-timings.jsonl';
  const info=await stat(file);if(info.size>1048576)throw Error('Oversized timings');
  const raw=(await readFile(file,'utf8')).split('\\n').filter(Boolean).map(line=>JSON.parse(line));
  if(raw.length<3||raw.length>24)throw Error('Invalid sample count');
  state=liveResult(exitCode,raw).state;
  timings=raw.map(row=>Object.fromEntries(['platform','ok',...${JSON.stringify(numbers)}].map(key=>[key,key==='failedRequests'?row.failedRequests?.length:row[key]])));
 }catch{state='failure';exitCode=1;timings=[];}
 const report={format:1,...identity,state,exitCode,timings};
 console.log(${JSON.stringify(marker)}+Buffer.from(JSON.stringify(report)).toString('base64'));
 process.exitCode=state==='success'&&exitCode===0?0:1;
})();`;
}

function readReport(log,identity) {
 const lines=log.split('\n').filter(line=>line.startsWith(marker));
 if(lines.length!==1||lines[0].length>12000)throw Error('Missing or ambiguous real-service report');
 const encoded=lines[0].slice(marker.length);if(!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw Error('Invalid real-service report');
 let report;try{const bytes=Buffer.from(encoded,'base64');if(bytes.toString('base64')!==encoded)throw Error();report=JSON.parse(bytes.toString('utf8'));}catch{throw Error('Invalid real-service report');}
 if(!keys(report,['format',...Object.keys(identity),'state','exitCode','timings'])||report.format!==1||Object.keys(identity).some(key=>report[key]!==identity[key])||report.state!=='success'||report.exitCode!==0||!Array.isArray(report.timings)||report.timings.length<3||report.timings.length>24)throw Error('Real-service acceptance did not pass for this exact deployment');
 for(const row of report.timings)if(!keys(row,['platform','ok',...numbers])||!platforms.includes(row.platform)||row.ok!==true||numbers.some(key=>!Number.isFinite(row[key])||row[key]<0||row[key]>(key==='mediaBytes'?2**32:3600000))||['run','media','mediaBytes','failedRequests'].some(key=>!Number.isSafeInteger(row[key])))throw Error('Invalid real-service timing samples');
 if(platforms.some(platform=>!report.timings.some(row=>row.platform===platform)))throw Error('Real-service platform coverage is incomplete');
 return report;
}

export function createMeldLiveAcceptance({suite,client,image,imageRegistry,registryCredentials,credential,testTokenSha256,timeoutMs=20*60000,fetcher=fetch,now=Date.now},{runJob=sandboxJob}={}) {
 cloudflareRegistry(image,imageRegistry);
 if(typeof credential!=='function'||!/^[a-f0-9]{64}$/.test(testTokenSha256??'')||!client||['exec','upload','sleep'].some(name=>typeof client[name]!=='function')||!Number.isSafeInteger(timeoutMs)||timeoutMs<60000||timeoutMs>45*60000)throw Error('Configure a private pinned acceptance image, scoped test credential and bounded timeout');
 const token=async()=>{let value;try{value=await credential();}catch{throw Error('Staging live-test credential is unavailable');}if(typeof value!=='string'||!/^[A-Za-z0-9._~+/=-]{16,4096}$/.test(value)||digest(value)!==testTokenSha256)throw Error('Staging live-test credential does not match the inspected staging target');return value;};
 const check=async context=>{
  const run=context.run;
  if(context.stagingOrigin!==meldUploadTarget.origin||!run?.deploymentApprovedBy||!/^[a-f0-9]{40}$/.test(run.head??'')||!/^[a-f0-9]{40}$/.test(run.base??'')||!/^[A-Za-z0-9-]{1,100}$/.test(run.id??'')||!Number.isSafeInteger(run.attempt)||run.attempt<1||!Number.isFinite(run.leaseUntil)||run.leaseUntil<=now()+60000||typeof context.authorizeDeployment!=='function'||!context.deploymentAuthorization?.id||!isAbsolute(context.source??'')||!isAbsolute(context.artifacts??''))throw Error('Exact approved staging run and private controller paths are required');
  const loaded=await readMeldLiveSuite(suite),source=await realpath(context.source),artifacts=await realpath(context.artifacts);
  if(inside(loaded.source,source)||inside(loaded.directory,source)||inside(artifacts,source))throw Error('Keep acceptance code and receipts outside candidate execution');
  const origin=new URL(context.artifactOrigin);if(origin.protocol!=='https:'||origin.username||origin.password||origin.search||origin.hash||!origin.pathname.endsWith('/'))throw Error('Use the private hosted evidence origin');
  return {...loaded,artifacts,origin};
 };
 const preflight=async context=>{await check(context);await token();return {configured:true,sourceCommit:suite.sourceCommit};};
 return {preflight,async accept(context) {
  const {bundle,artifacts,origin}=await check(context);await token();
  if(!/^[A-Za-z0-9-]{1,100}$/.test(context.deployRunId??'')||typeof context.verifyDeployment!=='function')throw Error('An acknowledged exact deployment and provider verification are required');
  const identity={candidate:context.run.head,sourceCommit:suite.sourceCommit,snapshotCommit:suite.snapshotCommit,deployRunId:context.deployRunId};
  const binding={runId:context.run.id,attempt:context.run.attempt,base:context.run.base,authorizationId:context.deploymentAuthorization.id,...identity};
  const intentPath=join(artifacts,'meld-live.intent.json');let intent;
  try{intent=await open(intentPath,'wx',0o600);await intent.writeFile(JSON.stringify({format:1,state:'started',startedAt:now(),binding})+'\n');await intent.sync();}catch{throw Error('Real-service acceptance already started or its intent is unavailable; inspect without replaying it');}finally{await intent?.close();}
  const privateLogs=join(artifacts,'meld-live-private');await mkdir(privateLogs,{mode:0o700});
  const active=async()=>{if(now()>=context.run.leaseUntil-30000)return false;await context.authorizeDeployment();return true;};
  const requireActive=async()=>{if(!await active())throw Error('Staging acceptance authority expired');};
  const verify=async()=>{await requireActive();await context.verifyDeployment();await verifyVersion(meldUploadTarget.origin,context.run.head,fetcher,7);await requireActive();};
  try{
   await verify();
   const job={name:'acceptance/live',id:'live',workflow:'trusted-meld-social',timeoutMs,script:`test "$(id -u)" = 1000\ntest "$(bun --version)" = 1.4.2\ntest ! -e /var/run/docker.sock\n! command -v npm\n! command -v npx\nfor name in CODEGRAFF_API_KEY NANOHUB_CI_TOKEN NANOHUB_TOKEN GITHUB_TOKEN CLOUDFLARE_API_TOKEN CLOUDFLARE_API_KEY DOCKER_AUTH_CONFIG; do test -z "$(printenv \"$name\" 2>/dev/null || true)"; done\nbun install --frozen-lockfile --offline\nprintf %s ${quote(Buffer.from(guestMain()).toString('base64'))} | base64 -d > /tmp/nanohub-live.mjs\nbun /tmp/nanohub-live.mjs ${quote(JSON.stringify(identity))}`};
   const result=await runJob({client,image,imageRegistry,registryCredentials,job,run:{...context.run,branch:'trusted-acceptance',ref:'refs/heads/trusted-acceptance',refTarget:undefined,head:suite.snapshotCommit,base:suite.snapshotCommit},bundle,network:'bridge',artifacts:privateLogs,artifactOrigin:origin.href,repository:'yourmeld/meld2',active,now,controllerInput:true,onStarted:async started=>{
    const requireStarted=async()=>{if(now()>=started.deadline)throw Object.assign(Error('Acceptance setup timed out'),{code:'job_deadline'});await requireActive();if(now()>=started.deadline)throw Object.assign(Error('Acceptance setup timed out'),{code:'job_deadline'});};
    // Only the reviewed suite runs before this point, with no test credential.
    for(;;){
     await requireActive();if(now()>=started.deadline)throw Object.assign(Error('Acceptance setup timed out'),{code:'job_deadline'});
     const status=await observeSandbox(options=>client.exec(started.sandbox,`docker exec ${started.container} sh -c 'if test -f /tmp/nanohub-live-ready; then printf ready; else printf waiting; fi'`,options),{deadline:started.deadline,label:'acceptance setup',now,sleep:ms=>client.sleep(ms),beforeRetry:requireActive});
     if(status==='ready')break;if(status!=='waiting')throw Error('Invalid acceptance setup state');await client.sleep(1000);
    }
    await requireStarted();await verify();
    const input=Buffer.from(JSON.stringify({candidate:context.run.head,token:await token()}));
    try{await requireStarted();await client.upload(started.sandbox,started.inputDirectory+'/pending.json',input);
    await requireStarted();await client.exec(started.sandbox,`chmod 400 ${quote(started.inputDirectory+'/pending.json')} && chown 1000:1000 ${quote(started.inputDirectory+'/pending.json')} && mv ${quote(started.inputDirectory+'/pending.json')} ${quote(started.inputDirectory+'/live.json')}`);
    }finally{input.fill(0);}
    await requireStarted();
   }});
   if(result.state!=='success')throw Error('Real-service acceptance or sandbox cleanup failed');
   const receipt=JSON.parse(await readFile(join(privateLogs,'acceptance-live.sandbox.json'),'utf8'));
   if(receipt.cleanupNeeded!==false||receipt.image!==image||receipt.controllerInput!==true||receipt.sourceBundle?.sha256!==suite.bundleSha256)throw Error('Acceptance sandbox provenance or destruction was not confirmed');
   const report=readReport(await readFile(join(privateLogs,'acceptance-live.log'),'utf8'),identity);
   await verify();
   // Publish only this closed, numeric report. Never upload raw guest logs.
   await writeFile(join(artifacts,'meld-live.log'),JSON.stringify({format:1,binding,image,bundleSha256:suite.bundleSha256,manifestSha256:suite.manifestSha256,verifiedAt:now(),sandboxDestroyed:true,report})+'\n',{flag:'wx',mode:0o600});
   return [{realService:true,url:new URL('meld-live.log',origin).href}];
  }catch{throw Error('Trusted real-service acceptance failed; inspect private controller receipts without replaying it');}
 }};
}
