/** Host-side credential issuance. Never import candidate code or forward the
 * Cloudflare control credential into a sandbox. Wrangler output stays private. */
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {runProcess} from './ci-runner.mjs';
import {cloudflareRegistry} from './toolchain.mjs';
const require=createRequire(import.meta.url);
export async function cloudflarePullCredentials(image,configuration,{processRunner=runProcess,env=process.env,now=Date.now}={}) {
  const selected=cloudflareRegistry(image,configuration);
  const started=now();
  // Each job issues a new pull-only credential after VM startup. The provider
  // scopes this to the account registry, not to an individual image repository.
  const args=[join(dirname(require.resolve('wrangler/package.json')),'bin/wrangler.js'),'containers','registries','credentials','registry.cloudflare.com','--pull','--expiration-minutes','15','--json','--config',selected.config];
  const logs=await mkdtemp(join(tmpdir(),'nanohub-registry-issuer-'));
  const cleanEnv={CI:'true',WRANGLER_SEND_METRICS:'false',WRANGLER_LOG_SANITIZE:'true',WRANGLER_LOG_PATH:join(logs,'wrangler.log')};
  for(const name of ['PATH','HOME','TMPDIR','XDG_CONFIG_HOME','CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_API_KEY','CLOUDFLARE_EMAIL'])if(env[name])cleanEnv[name]=env[name];
  let result;
  try {result=await processRunner(process.execPath,args,{env:cleanEnv,timeoutMs:60000});}
  catch {throw Error('Could not issue a temporary Cloudflare registry pull credential');}
  finally {await rm(logs,{recursive:true,force:true});}
  if(result.code!==0)throw Error('Could not issue a temporary Cloudflare registry pull credential');
  let credentials;
  try {credentials=JSON.parse(result.output);}
  catch {throw Error('Cloudflare registry returned invalid pull credentials');}
  if(credentials?.username!=='v1'||typeof credentials.password!=='string'||credentials.password.length<1||credentials.password.length>16384||/[^\x21-\x7e]/.test(credentials.password))throw Error('Cloudflare registry returned invalid pull credentials');
  if(now()-started>=60000)throw Error('Cloudflare registry credential issuance exceeded its preparation window');
  return {username:credentials.username,password:credentials.password,expiresAt:started+15*60000};
}
