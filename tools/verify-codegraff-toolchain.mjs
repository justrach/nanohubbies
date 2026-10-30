/** Explicit real-cloud acceptance for this repository's trusted toolchain.
 * Does not register a runner or mutate a hosted Nanohub repository. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
import {Codegraff,sandboxJob} from './codegraff-actions.mjs';
import {runProcess} from './ci-runner.mjs';
import {toolchain} from './toolchain.mjs';
import {acceptanceGates,acceptanceGateScript} from './acceptance-gates.mjs';

if(process.env.NANOHUB_LIVE_CODEGRAFF!=='1'||!process.env.CODEGRAFF_API_KEY)
  throw Error('Explicit NANOHUB_LIVE_CODEGRAFF=1 and an existing sandbox-scoped key are required');
const [configPath,sourcePath,artifactPath]=process.argv.slice(2);
if(![configPath,sourcePath,artifactPath].every(p=>p&&isAbsolute(p)))
  throw Error('Provide absolute trusted config, clean source checkout and private artifact paths');
const config=JSON.parse(await readFile(configPath,'utf8'));
const selected=toolchain(config.image,config.imageSnapshot,config.imageArchive,config.imageDownload,config.imageRegistry);
const source=resolve(sourcePath),artifacts=resolve(artifactPath);
if(artifacts===source||artifacts.startsWith(source+'/'))throw Error('Artifacts must be outside candidate source');
await mkdir(artifacts,{recursive:true,mode:0o700});
const git=async(...args)=>{
  const result=await runProcess('git',['-C',source,...args],{env:{PATH:process.env.PATH,HOME:artifacts,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});
  if(result.code)throw Error('Source Git validation failed');return result.output.trim();
};
if(await git('status','--porcelain','--untracked-files=all'))throw Error('Use a clean credential-free source checkout');
const head=await git('rev-parse','HEAD');assert.match(head,/^[a-f0-9]{40}$/);
const bundlePath=join(artifacts,'source.bundle');await git('bundle','create',bundlePath,'HEAD');
const gates=acceptanceGates;
const script=`test "$(git rev-parse HEAD)" = '${head}'
test "$(bun --version)" = '1.4.4'
test "$(node --version)" = 'v24.14.1'
! command -v npm
! command -v npx
for name in CODEGRAFF_API_KEY NANOHUB_CI_TOKEN NANOHUB_TOKEN GITHUB_TOKEN CLOUDFLARE_API_TOKEN CLOUDFLARE_API_KEY DOCKER_AUTH_CONFIG; do test -z "$(printenv "$name" 2>/dev/null || true)"; done
test ! -e /var/run/docker.sock
export NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1
${acceptanceGateScript(gates)}
printf '\\nNANOHUB_FULL_LINUX_PASS\\n'
`;
const run={id:'toolchain-acceptance-'+Date.now(),attempt:1,branch:'toolchain-acceptance',head,base:head,leaseUntil:Date.now()+60*60000};
const client=new Codegraff(process.env.CODEGRAFF_API_KEY);
const result=await sandboxJob({client,job:{name:'toolchain/full',id:'full',workflow:'trusted full-project acceptance',timeoutMs:40*60000,script},run,bundle:await readFile(bundlePath),image:config.image,imageSnapshot:config.imageSnapshot,imageArchive:config.imageArchive,imageDownload:config.imageDownload,imageRegistry:config.imageRegistry,network:'none',artifacts,artifactOrigin:'https://logs.invalid/',repository:'nanohub/toolchain-validation'});
await writeFile(join(artifacts,'result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
assert.equal(result.state,'success');
const log=await readFile(join(artifacts,'toolchain-full.log'),'utf8');
assert.ok(!log.includes(process.env.CODEGRAFF_API_KEY));
for(const [name]of gates)assert.ok(log.includes('NANOHUB_GATE_PASS '+name),'Missing gate '+name);
assert.ok(log.includes('NANOHUB_FULL_LINUX_PASS'));
const cleanup=JSON.parse(await readFile(join(artifacts,'toolchain-full.sandbox.json'),'utf8'));
assert.equal(cleanup.cleanupNeeded,false);
const provenance=selected.registry?{image:selected.image,registryProvider:'cloudflare'}:selected.download?{image:selected.image,imageDownload:{sha256:selected.download.sha256,bytes:selected.download.bytes}}:selected;
await writeFile(join(artifacts,'receipt.json'),JSON.stringify({checkedAt:new Date().toISOString(),productionCodegraff:true,hostedNanohub:false,source:head,...provenance,sandboxId:result.execution.sandboxId,gates:gates.map(([name])=>name),network:'none',credentialFreeCandidate:true,cleanupDeleted:true},null,2)+'\n',{mode:0o600});
console.log('PASS: fresh Codegraff VM, exact trusted toolchain, credential-free offline full-project checks and confirmed destruction');
