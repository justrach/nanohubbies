import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {teamFixture} from './team/fixture.ts';
const f=await teamFixture(),exec=promisify(execFile),trunk='cli-git',base=`/api/trunks/${trunk}`,repo='cli-owner/project';
const home=join(f.dir,'cache');await mkdir(home,{mode:0o700});
const globalConfig=join(f.dir,'global.gitconfig'),env={...process.env,XDG_CACHE_HOME:home,GIT_CONFIG_GLOBAL:globalConfig,GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0',NANOHUB_API_TOKEN:''};
await exec('git',['config','--file',globalConfig,'credential.helper','!f() { test "$1" = get && printf "username=git\\npassword=wrong-inherited-credential\\n"; }; f']);
const globalBefore=await readFile(globalConfig,'utf8'),copy=join(f.dir,"CLI's source path");await cp(resolve(import.meta.dirname,'../../cli'),copy,{recursive:true});let bin=join(copy,'bin/nh.mjs');
if(process.argv.includes('--bundle')) {const bundled=join(copy,'nh.mjs');await exec('bun',['build',bin,'--target=bun','--outfile',bundled],{env});bin=bundled;}
const cli=(args:string[],{input='',token='',cwd=f.dir}: {input?:string;token?:string;cwd?:string}={})=>new Promise<{code:number|null;stdout:string;stderr:string;data:any}>((done,reject)=>{const child=spawn('bun',[bin,...args,'--host',f.origin,'-R',repo,'--credential-helper','cache','--json'],{cwd,env:{...env,NANOHUB_API_TOKEN:token},stdio:['pipe','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);child.on('error',reject);child.on('close',code=>{let data;try{data=JSON.parse(stdout);}catch{data=null;}done({code,stdout,stderr,data});});child.stdin.end(input);});
const okay=async(args:string[],options:any={})=>{const r=await cli(args,options);assert.equal(r.code,0,r.stderr+r.stdout);return r.data;};
let owner:any,gitToken:any;const credentials:{id:string;cookie:any}[]=[];const servers:ReturnType<typeof createServer>[]=[];
try {
  owner=await f.login('owner','101');const writer=await f.login('writer','202'),reader=await f.login('reader','303');
  await f.json('POST',base,{mode:'git'},owner);await f.json('POST','/api/trunks/other-cli-git',{mode:'git'},owner);await f.json('POST','/api/namespaces',{name:'cli-owner'},owner);await f.json('POST',`/api/repository-addresses/${trunk}`,{namespace:'cli-owner',name:'project'},owner);
  for(const [id,who,role]of[['writer',writer,'writer'],['reader',reader,'reader']]as const){const invitation=await f.json('POST',base+'/collaborators',{userId:`codegraff:${id}`,role},owner);await f.json('POST','/api/invitations/accept',{trunk,token:invitation.token},who);}
  gitToken=await f.json('POST',base+'/git-tokens',{label:'CLI Git fixture seed'},owner);
  const source=join(f.dir,'source');await mkdir(source);const git=async(directory:string,...args:string[])=>(await exec('git',['-C',directory,'-c','user.name=CLI Git fixture','-c','user.email=fixture@example.invalid',...args],{env})).stdout.trim();
  await git(source,'init','-b','main');await writeFile(join(source,'README.md'),'CLI Git seed\n');await git(source,'add','.');await git(source,'commit','-m','Base');const initial=await git(source,'rev-parse','HEAD'),remote=`${f.origin}/git/${repo}.git`;
  await exec('git',['-C',source,'-c',`http.extraHeader=Authorization: Basic ${btoa('git:'+gitToken.token)}`,'push',remote,'main'],{env});
  const make=async(who:any,scopes:string[])=>{const c=await f.json('POST',base+'/cli-credentials',{label:'CLI Git test',scopes,days:1},who);credentials.push({id:c.id,cookie:who});return c;};
  assert.equal((await f.request('POST',base+'/cli-credentials',{label:'Missing read dependency',scopes:['read','contents:write'],days:1},owner)).status,400);
  assert.equal((await f.request('POST',base+'/cli-credentials',{label:'Reader write',scopes:['read','contents:read','contents:write'],days:1},reader)).status,403);
  const read=await make(owner,['read','contents:read']),write=await make(writer,['read','contents:read','contents:write']),readerRead=await make(reader,['read','contents:read']),apiOnly=await make(owner,['read','reviews:write']);
  const basic=(token:string)=>({Authorization:'Basic '+btoa('git:'+token)});
  assert.equal((await f.request('GET',`/git/${repo}.git/HEAD`,undefined,basic(apiOnly.token))).status,401,'Existing API-only scopes must not expand');
  assert.equal((await f.request('GET',base+'/pulls',undefined,basic(write.token))).status,401,'Git context does not create application API identity');
  assert.equal((await f.request('GET','/git/other-cli-git.git/HEAD',undefined,basic(write.token))).status,401);
  const wrongOrigin=await f.mf.dispatchFetch(`https://other.invalid/git/${repo}.git/HEAD`,{headers:basic(write.token)});assert.equal(wrongOrigin.status,401);
  assert.equal((await f.request('GET',`/git/${repo}.git/HEAD`,undefined,basic(readerRead.token))).status,200);
  const deniedClone=await cli(['repo','clone','no-content'],{token:apiOnly.token});assert.equal(deniedClone.code,1);assert.match(deniedClone.data.error,/contents:read/);
  await okay(['auth','login','--with-api-token'],{input:write.token+'\n'});
  const cloned=await okay(['repo','clone','checkout']);const checkout=cloned.directory;
  assert.equal(await git(checkout,'rev-parse','HEAD'),initial);await git(checkout,'fsck','--strict');
  const config=await git(checkout,'config','--local','--list');assert.ok(config.includes('auth')&&config.includes('git-credential'));assert.ok(config.includes("CLI'\\''s source path"),'Quoted helper source path survives Git shell execution');assert.ok(![read.token,write.token,gitToken.token].some(t=>config.includes(t)));assert.equal(await git(checkout,'config','--local','http.followRedirects'),'false');assert.equal(await git(checkout,'remote','get-url','origin'),remote);
  await git(checkout,'checkout','-b','feature');await writeFile(join(checkout,'README.md'),'Pushed through CLI helper\n');await git(checkout,'commit','-am','Feature');const candidate=await git(checkout,'rev-parse','HEAD');await git(checkout,'push','origin','feature');
  const policy={branch:'main',pullRequest:false,approvals:0,checks:[],beforeOpen:[],preventForce:true,preventDelete:true,locked:true};await f.json('PUT',base+'/protection',policy,owner);
  await assert.rejects(git(checkout,'push','origin','HEAD:main'),error=>/locked/.test(String((error as any).stderr)));
  const rule=await f.json('POST',base+'/rulesets',{name:'CLI cannot inherit browser bypass',target:'branch',enforcement:'active',conditions:{ref_name:{include:['refs/heads/no-cli-bypass'],exclude:[]}},rules:[{type:'creation'}],bypass_actors:[{actor_type:'User',actor_id:'codegraff:writer',bypass_mode:'always'}]},owner);
  await assert.rejects(git(checkout,'push','origin','HEAD:refs/heads/no-cli-bypass'),error=>/creation/.test(String((error as any).stderr)));await f.json('DELETE',`${base}/rulesets/${rule.id}`,undefined,owner);
  // Owner role alone cannot turn a read-scoped credential into a pusher.
  const readClone=await okay(['repo','clone','read-checkout'],{token:read.token}),readDir=readClone.directory;
  await git(readDir,'checkout','-b','read-attempt');await writeFile(join(readDir,'README.md'),'Must remain local\n');await git(readDir,'commit','-am','Read-only attempt');
  await assert.rejects(exec('git',['-C',readDir,'push','origin','HEAD:refs/heads/read-attempt'],{env:{...env,NANOHUB_API_TOKEN:read.token}}),error=>/403/.test(String((error as any).stderr)));
  await f.json('PATCH',base+'/collaborators',{userId:'codegraff:writer',role:'reader'},owner);await assert.rejects(git(checkout,'push','origin','HEAD:refs/heads/demoted'),error=>/403/.test(String((error as any).stderr)));await f.json('PATCH',base+'/collaborators',{userId:'codegraff:writer',role:'writer'},owner);
  // Explicit setup in an existing checkout uses only local config.
  await git(source,'remote','add','origin',remote);await okay(['auth','setup-git'],{cwd:source});assert.ok((await git(source,'config','--local','--get-all','credential.helper')).includes('git-credential'));
  await git(source,'remote','set-url','origin',`${f.origin}/git/other-cli-git.git`);const beforeWrong=await git(source,'config','--local','--list');const wrongSetup=await cli(['auth','setup-git'],{cwd:source});assert.equal(wrongSetup.code,1);assert.equal(await git(source,'config','--local','--list'),beforeWrong);await git(source,'remote','set-url','origin',remote);
  await f.json('POST',base+'/archive',{archived:true,revision:0,confirmation:'project'},owner);await okay(['repo','clone','archived-checkout']);await assert.rejects(git(checkout,'push','origin','HEAD:refs/heads/archived'),error=>/403/.test(String((error as any).stderr)));
  const archivedRead=await make(owner,['read','contents:read']);assert.equal((await f.request('GET',`/git/${repo}.git/HEAD`,undefined,basic(archivedRead.token))).status,200);assert.equal((await f.request('POST',base+'/cli-credentials',{label:'Archived write',scopes:['read','contents:read','contents:write'],days:1},owner)).status,403);await f.json('POST',base+'/archive',{archived:false,revision:1,confirmation:'project'},owner);
  // API credential revocation invalidates the repo-local Git helper immediately.
  await okay(['auth','logout']);assert.equal((await f.request('GET',`/git/${repo}.git/HEAD`,undefined,basic(write.token))).status,401);await assert.rejects(git(checkout,'ls-remote','origin'),error=>/Authentication|could not read Username/.test(String((error as any).stderr)));
  await f.json('DELETE',`/api/cli/credentials/${read.id}`,undefined,owner);assert.equal((await f.request('GET',`/git/${repo}.git/HEAD`,undefined,basic(read.token))).status,401);
  assert.equal(await readFile(globalConfig,'utf8'),globalBefore,'Global Git settings and independent helpers are untouched');
  const refs=await f.json('GET',base+'/repository',undefined,owner);assert.equal(refs.refs.find((r:any)=>r.name==='refs/heads/main').commit,initial);assert.equal(refs.refs.find((r:any)=>r.name==='refs/heads/feature').commit,candidate);
  // Repo-local redirect refusal applies to ordinary Git, not just CLI clone.
  let followed=0,initialAuthorization='';const targetServer=createServer((_req,res)=>{followed++;res.writeHead(200).end('unexpected');});servers.push(targetServer);await new Promise<void>(r=>targetServer.listen(0,'127.0.0.1',r));
  const redirectServer=createServer((req,res)=>{initialAuthorization=req.headers.authorization??'';res.writeHead(302,{Location:`http://127.0.0.1:${(targetServer.address()as any).port}/git/redirect.git/info/refs`}).end();});servers.push(redirectServer);await new Promise<void>(r=>redirectServer.listen(0,'127.0.0.1',r));
  await assert.rejects(git(checkout,'ls-remote',`http://127.0.0.1:${(redirectServer.address()as any).port}/git/redirect.git`));assert.equal(followed,0);assert.equal(initialAuthorization,'');
  console.log('PASS: actual Bun API login to Git clone/fsck and ordinary feature push via quoted repository-bound helper; old API scope/Git-only isolation, read scopes versus owner role, current membership, locks/archive/browser-bypass refusal, local setup matching, no secret in config/remote/output, global helper isolation, redirect refusal and revocation');
}finally {
  for(const c of credentials)await f.request('DELETE',`/api/cli/credentials/${c.id}`,undefined,c.cookie).catch(()=>{});
  if(gitToken&&owner)await f.request('DELETE',`/api/tokens/${gitToken.id}`,undefined,owner).catch(()=>{});
  for(const server of servers)await new Promise<void>(r=>server.close(()=>r()));
  await exec('git',['credential-cache','exit'],{env}).catch(()=>{});await f.close();
}
