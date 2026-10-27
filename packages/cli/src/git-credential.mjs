import {fileURLToPath} from 'node:url';
import {apiPath,apiRequest,storedApiToken} from './api.mjs';
const quote=value=>`'${String(value).replaceAll("'","'\\''")}'`;
export function gitHelperCommand(target,helper,{executable=process.execPath,bin=globalThis.Bun?.main??fileURLToPath(new URL('../bin/nh.mjs',import.meta.url))}={}) {
 return '!'+[executable,bin,'auth','git-credential','--host',target.origin,target.repository?'--repo':'--trunk',target.repository??target.trunk,'--credential-helper',helper].map(quote).join(' ');
}
export async function configureGitHelper(git,directory,helper,{cli=false}={}) {
 await git(['config','credential.useHttpPath','true'],'',directory);
 await git(['config','credential.helper',''],'',directory);
 await git(['config','--add','credential.helper',helper],'',directory);
 if(cli)await git(['config','http.followRedirects','false'],'',directory);
}
export async function requireGitAccess(target,git,environment,fetcher,token) {
 token??=await storedApiToken(target,git,environment);
 const identity=await apiRequest(target.origin,'/api/cli/whoami',token,{fetcher});
 if(!identity.credential.scopes.includes('contents:read'))throw Error('This CLI credential lacks clone/fetch permission. Authorize contents:read, or use repo clone --git with a separate Git credential.');
 await apiRequest(target.origin,apiPath(target)+'/branches',token,{fetcher});
 return identity;
}
/** Git's private credential protocol, not ordinary CLI output. Validate the
 * complete context before consulting the OS helper. Store/erase never broaden
 * or revoke API grants on behalf of a remote Git server. */
export async function gitCredentialHelper({target,git,environment,readCredential,write,operation}) {
 if(!['get','store','erase'].includes(operation))throw Error('Git credential helper expects get, store or erase');
 if(operation!=='get')return;
 const raw=await readCredential();if(typeof raw!=='string'||raw.length>16384)return;
 const fields=new Map();
 for(let line of raw.split('\n')) {
  line=line.replace(/\r$/,'');if(!line)break;
  const at=line.indexOf('=');if(at<1)return;
  const key=line.slice(0,at);if(['protocol','host','path','username'].includes(key)){if(fields.has(key))return;fields.set(key,line.slice(at+1));}
 }
 const url=new URL(target.gitUrl);
 if(fields.get('protocol')!==url.protocol.slice(0,-1)||fields.get('host')?.toLowerCase()!==url.host.toLowerCase()||fields.get('path')!==url.pathname.slice(1)||fields.has('username')&&fields.get('username')!=='git')return;
 const token=await storedApiToken(target,git,environment);
 if(/^nhc_[a-f0-9]{64}$/.test(token??''))write(`username=git\npassword=${token}\n`);
}
