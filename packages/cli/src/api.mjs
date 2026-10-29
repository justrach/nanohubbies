import {rulesetCommand} from './rulesets.mjs';
import {archiveCommand} from './archive.mjs';
import {defaultBranchCommand} from './default-branch.mjs';
import {mergeSettingsCommand} from './merge-settings.mjs';
import {environmentCommand} from './environments.mjs';
import {runnerCommand} from './runners.mjs';
import {collaboratorCommand} from './collaborators.mjs';
import {pendingCommand,inlineSelection} from './pending.mjs';
const redact=value=>String(value).replace(/nh(?:ci|c|g|d|i)_[a-f0-9]{32,}/gi,'[redacted]');
export class CliApiError extends Error {constructor(message,status){super(message);this.status=status;}}
export async function apiRequest(origin,path,token,{method='GET',body,revision,revisionType='protection',fetcher=fetch}={}) {
 if(!/^nhc_[a-f0-9]{64}$/.test(token??''))throw Error('CLI API access needs an nhc_ credential. Run auth login --with-api-token.');
 const target=new URL(path,origin);if(target.origin!==origin||!target.pathname.startsWith('/api/cli/'))throw Error('CLI API request must stay on the selected host');
 if(revision!==undefined&&(!Number.isSafeInteger(revision)||revision<0))throw Error('Use a current valid resource revision');
 let response;try{response=await fetcher(target.href,{method,redirect:'error',credentials:'omit',signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','User-Agent':'nanohub-cli/0.4',...(revision===undefined?{}:{'If-Match':`"${revisionType}-${revision}"`})},body:body===undefined?undefined:JSON.stringify(body)});}catch{if(method!=='GET'&&path.endsWith('/collaborators'))throw Error('The API response was lost. Inspect access list or recover the same invitation with the saved private file; do not repeat an uncertain edit.');throw Error(method==='GET'?'CLI API request failed. Check --host and network access.':/\/pending-review(?:\/submit)?$/.test(path)?'The API response was lost. Inspect pr draft and the pull request before repeating this operation.':/\/environments(?:\/[a-zA-Z0-9-]+)?$/.test(path)?'The API response was lost. Inspect env list or env export before repeating the edit.':/\/ci\/(?:runners|[a-f0-9-]{36})$/.test(path)?'The API response was lost. Inspect runner list or use runner recover with the saved private file.':path.endsWith('/merge-settings')?'The API response was lost. Inspect repo merge-settings before repeating the edit.':path.endsWith('/default-branch')?'The API response was lost. Inspect repo default-branch before repeating the edit.':path.endsWith('/archive')?'The API response was lost. Inspect repo archive-status before repeating the operation.':path.endsWith('/protection')?'The API response was lost. Inspect rules get or rules list before repeating the edit.':/\/rulesets(?:\/\d+)?$/.test(path)?'The API response was lost. Inspect ruleset list or ruleset export before repeating the edit.':'The API response was lost. Inspect the pull request before repeating this operation.');}
 const text=await response.text();if(text.length>4*1024*1024)throw Error('CLI API response exceeded the display limit');
 let data;try{data=JSON.parse(text);}catch{throw Error(`CLI API returned a non-JSON response (HTTP ${response.status})`);}
 if(!response.ok)throw new CliApiError(redact(data.error??`CLI API returned HTTP ${response.status}`),response.status);return data;
}
export function apiPath(target) {return `/api/cli/${target.repository?`repos/${target.repository}`:`trunks/${target.trunk}`}`;}
export function credentialInput(target) {
 const url=new URL(target.origin);return `protocol=${url.protocol.slice(0,-1)}\nhost=${url.host}\npath=api/cli/${target.repository??target.trunk}\nusername=nanohub-cli\n`;
}
export async function storedApiToken(target,git,environment=process.env) {
 if(environment.NANOHUB_API_TOKEN)return environment.NANOHUB_API_TOKEN.trim();
 try{return (await git(['credential','fill'],credentialInput(target)+'\n')).split('\n').find(s=>s.startsWith('password='))?.slice(9)??null;}catch{return null;}
}
export async function nativeCommand({group,action,pos,opts,target,git,readToken,readProtectionFile,write,fetcher,environment,cwd}) {
 const input=credentialInput(target),request=(path,token,options)=>apiRequest(target.origin,path,token,{...options,fetcher});
 const stored=()=>storedApiToken(target,git,environment);
 const output=(data,message)=>write(opts.json?JSON.stringify(data):message);
 if(group==='auth') {
  if(pos.length)throw Error('Unexpected positional argument');
  if(action==='login') {
   const token=(await readToken()).trim();
   const identity=await request('/api/cli/whoami',token);
   await request(apiPath(target)+'/branches',token);
   await git(['credential','approve'],input+`password=${token}\n\n`);
   const saved=(await git(['credential','fill'],input+'\n')).split('\n').includes(`password=${token}`);
   if(!saved)throw Error('Credential helper did not retain the CLI credential');
   output({authenticated:true,...identity},`CLI credential saved for ${target.repository??target.trunk}. Permissions: ${identity.credential.scopes.join(', ')}.`);return;
  }
  const token=await stored();
  if(action==='logout') {
   let revoked=false;
   if(token)try{await request('/api/cli/logout',token,{method:'POST',body:target.repository?{repository:target.repository}:{trunk:target.trunk}});revoked=true;}catch(error){if(!(error instanceof CliApiError)||error.status!==401)throw error;}
   await git(['credential','reject'],input+'\n');
   output({revoked,inactive:true},revoked?'CLI credential revoked on the server and removed from the local helper.':token?'CLI credential is already invalid; its local entry was removed.':'No CLI credential was found in the selected helper.');return;
  }
  const identity=await request('/api/cli/whoami',token);await request(apiPath(target)+'/branches',token);
  output({authenticated:true,...identity},`${identity.user.name}: ${identity.credential.scopes.join(', ')}; expires ${new Date(identity.credential.expiresAt).toISOString()}`);return;
 }
 const token=await stored(),base=apiPath(target),get=path=>request(base+path,token),post=(path,body,method='POST')=>request(base+path,token,{method,body});
 if(group==='repo')return action==='merge-settings'||action==='edit'&&(opts['allow-merge-methods']!==undefined||opts['default-merge-method']!==undefined)?mergeSettingsCommand({action,pos,opts,base,token,request,output}):['default-branch','edit'].includes(action)?defaultBranchCommand({action,pos,opts,base,token,request,output}):archiveCommand({action,pos,opts,base,token,request,output});
 if(group==='ruleset')return rulesetCommand({action,pos,opts,base,token,request,output,readFile:readProtectionFile});
 if(group==='env')return environmentCommand({action,pos,opts,base,token,request,output,readFile:readProtectionFile});
 if(group==='runner')return runnerCommand({action,pos,opts,target,base,token,request,output,cwd});
 if(group==='access')return collaboratorCommand({action,pos,opts,target,base,token,request,output,cwd});
 if(group==='rules') {
  if(action==='list'||action==='get') {
   if(pos.length!==(action==='get'?1:0))throw Error('Use rules list or rules get EXACT_PATTERN');
   const data=await get('/protection');
   if(action==='list'){output(data,`Protection revision: ${data.revision}\n`+(data.policies.map(p=>`${p.branch}\t${p.locked?'locked':'active'}\t${p.approvals} approvals\t${p.checks.length} checks`).join('\n')||'No branch protection rules.'));return;}
   const policy=data.policies.find(p=>p.branch===pos[0]);if(!policy)throw Error('No branch protection rule with that exact pattern');
   const exported={revision:data.revision,policy};output(exported,JSON.stringify(exported,null,2));return;
  }
  let revision,body,method;
  if(action==='set') {
   if(pos.length||!opts.file||opts.revision!==undefined||opts.confirm!==undefined)throw Error('Use rules set --file FILE containing the revision and complete policy from rules get');
   let document;try{document=JSON.parse(await readProtectionFile(opts.file));}catch(error){throw Error(`Cannot read protection export: ${error.message}`);}
   if(!document||Array.isArray(document)||Object.keys(document).some(k=>!['revision','policy'].includes(k))||!document.policy||Array.isArray(document.policy)||typeof document.policy!=='object'||typeof document.policy.branch!=='string')throw Error('Use a protection export containing only revision and policy');
   revision=document.revision;body=document.policy;method='PUT';
  }else {
   if(pos.length!==1||opts.file!==undefined||opts.confirm!==pos[0]||!/^(0|[1-9]\d{0,15})$/.test(opts.revision??''))throw Error('Use rules delete EXACT_PATTERN --revision N --confirm EXACT_PATTERN');
   revision=Number(opts.revision);body={branch:pos[0]};method='DELETE';
  }
  if(!Number.isSafeInteger(revision)||revision<0)throw Error('Use the protection revision from rules get or rules list');
  const data=await request(base+'/protection',token,{method,body,revision});
  output(data,`${method==='PUT'?'Saved':'Removed'} protection ${body.branch}. Revision: ${data.revision}.`);return;
 }
 if(group==='pr'&&action==='list') {
  if(pos.length)throw Error('Unexpected positional argument');const data=await get('/pulls');
  output({pulls:data.pulls},data.pulls.map(p=>`#${p.number}\t${p.state}\t${p.title}\t${p.head} → ${p.base}`).join('\n')||'No pull requests.');return;
 }
 if(group==='run') {
  if(pos.length)throw Error('Unexpected positional argument');const data=await get('/branches'),runs=data.runs??[];
  output({runs},runs.map(r=>`${r.id}\t${r.state}${r.state==='complete'?' / '+([...new Set([...(r.results??[]),...(r.deployments??[])].map(check=>check.state))].join(', ')||'no results'):''}\t${r.ref??`refs/heads/${r.branch}`}\t${r.head}`).join('\n')||'No Actions runs.');return;
 }
 if(action==='create') {
  if(pos.length||!opts.title?.trim()||!opts.head)throw Error('Use pr create --title TITLE --head BRANCH [--base BRANCH] [--body TEXT]');
  const data=await post('/pulls',{title:opts.title,head:opts.head,...(opts.base!==undefined?{base:opts.base}:{}),body:opts.body??''});
  const p=data.pulls.reduce((latest,pull)=>!latest||pull.number>latest.number?pull:latest,null);output({pull:p},`Created #${p.number}: ${p.title}`);return;
 }
 const number=pos.shift();if(!/^[1-9]\d{0,8}$/.test(number??'')||pos.length)throw Error('Choose one positive pull request number');
 if(action==='draft'||action==='comment'&&opts.draft||action==='review'&&opts.pending)return pendingCommand({action,number,opts,get,post,output});
 const data=await get(`/pulls/${number}`),p=data.pull;
 if(action==='view') {
  output(data,`#${p.number} ${p.title}\n${p.state} · ${p.head} → ${p.base}\nHead: ${data.head.commit}\n\n${p.body}\n\nReview: ${data.reviewGate?.ready?'ready':data.reviewGate?.error??'not ready'}\n${target.url}/pulls/${number}`);return;
 }
 if(action==='diff') {
  const diff=data.files.map(f=>`diff --git a/${f.previous??f.path} b/${f.path}\n${f.patch??'[Binary or omitted diff — open the full file in the browser]'}\n`).join('\n');
  output({files:data.files,truncated:data.truncated??[]},diff+(data.truncated?.length?'\n[Diff truncated by server limits]\n':''));return;
 }
 const observed={commit:data.head.commit,anchor:p.anchor};let result;
 if(action==='review') {
  const verdict={'comment':'COMMENT','approve':'APPROVE','request-changes':'REQUEST_CHANGES'}[opts.verdict??'comment'];
  if(!verdict)throw Error('Choose --verdict comment, approve or request-changes');
  result=await post(`/pulls/${number}/reviews`,{...observed,verdict,body:opts.body??''});
  const review=result.reviews.at(-1);output({review},`Submitted ${verdict.toLowerCase().replaceAll('_',' ')} on #${number} at ${observed.commit.slice(0,7)}.`);return;
 }
 if(action==='comment') {
  if(!opts.body?.trim())throw Error('Provide --body for the inline comment');
  const body={...observed,id:crypto.randomUUID(),body:opts.body};
  if(opts['reply-to'])body.replyTo=opts['reply-to'];else {
   Object.assign(body,inlineSelection(opts));
  }
  result=await post(`/pulls/${number}/comments`,body);output({id:body.id,discussion:result},`Posted inline comment ${body.id} on #${number}.`);return;
 }
 if(action==='resolve') {
  if(!opts.thread)throw Error('Provide --thread ID');
  result=await post(`/pulls/${number}/comments`,{...observed,id:opts.thread,resolved:!opts.reopen},'PATCH');
  output({discussion:result},`${opts.reopen?'Reopened':'Resolved'} thread ${opts.thread}.`);return;
 }
 if(action==='merge'||action==='close') {
  let payload=observed;
  if(action==='merge') {
   const settings=data.mergeSettings,method=opts.method??settings?.defaultMethod??'fast-forward';
   if(settings&&(!Number.isSafeInteger(settings.revision)||settings.revision<0||!Array.isArray(settings.allowedMethods)||!settings.allowedMethods.includes(method)))throw Error('Current merge settings are unavailable; inspect the pull request again');
   if(data.mergeMethods&&!data.mergeMethods.includes(method)||method!=='fast-forward'&&!data.mergeMethods?.includes(method))throw Error('The selected merge method is unavailable under this repository policy or server version');
   if(settings)payload={...payload,method,mergeSettingsRevision:settings.revision};
   if(method!=='fast-forward'){
    const base=data.branches?.find(branch=>branch.name===p.base);if(!base)throw Error('Cannot observe the current target branch; refresh before merging');
    payload={...payload,method,targetBase:base.commit,...(opts.message!==undefined?{message:opts.message}:{})};
   }
  }
  result=await post(`/pulls/${number}/${action}`,payload);const pull=result.pulls.find(row=>row.number===Number(number));
  output({pull},`${pull.state==='merged'?'Merged':'Closed'} #${number}.`);return;
 }
 throw Error('Unsupported native CLI command');
}
