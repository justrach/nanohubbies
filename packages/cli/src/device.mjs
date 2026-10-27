import {apiRequest,nativeCommand} from './api.mjs';
const scopes=['read','contents:read','contents:write','pulls:write','reviews:write','pulls:merge'];
const availableScopes=[...scopes,'protections:write','rulesets:write','repository:archive','repository:default','environments:write'];
export async function browserLogin({target,opts,pos,git,execute,write,progress,platform,cwd,fetcher,environment,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=Date.now}) {
 if(pos.length)throw Error('Unexpected positional argument');
 const permissions=opts.scopes?[...new Set(['read',...opts.scopes.split(',')])]:[...scopes],days=Number(opts.days??7),label=opts.label??'Nanohub CLI';
 if(permissions.includes('contents:write')&&!permissions.includes('contents:read'))permissions.push('contents:read');
 if(permissions.some(s=>!availableScopes.includes(s))||!Number.isInteger(days)||days<1||days>30||!label.trim()||label.length>64||/[\x00-\x1f\x7f]/.test(label))throw Error('Choose valid --scopes, a --label up to 64 characters, and --days between 1 and 30');
 const request=(path,body)=>fetcher(target.origin+path,{method:'POST',redirect:'error',credentials:'omit',headers:{'Content-Type':'application/json','User-Agent':'nanohub-cli/0.4'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 let response,data;try{response=await request('/api/cli/device',{...(target.repository?{repository:target.repository}:{trunk:target.trunk}),scopes:permissions,days,label,client_origin:target.origin});data=await response.json();}catch{throw Error('Could not start CLI authorization. Check --host and network access.');}
 if(!response.ok)throw Error('CLI authorization could not start. Check the selected repository, permissions and server availability.');
 let uri,complete;try{uri=new URL(data.verification_uri);complete=new URL(data.verification_uri_complete);}catch{throw Error('Server returned an invalid CLI authorization URL');}
 if(uri.origin!==target.origin||uri.pathname!=='/cli/authorize'||uri.search||uri.hash||uri.username||uri.password||complete.origin!==target.origin||complete.pathname!=='/cli/authorize'||complete.username||complete.password||complete.hash||[...complete.searchParams.keys()].length!==1||complete.searchParams.get('code')!==data.user_code||!/^nhd_[a-f0-9]{64}$/.test(data.device_code??'')||!/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(data.user_code??'')||!Number.isFinite(data.expires_in)||data.expires_in<1||data.expires_in>600||!Number.isFinite(data.interval)||data.interval<5||data.interval>60)throw Error('Server returned invalid CLI authorization instructions');
 const deadline=now()+data.expires_in*1000;
 progress(`Open ${uri.href}\nEnter code: ${data.user_code}\nConfirm the repository and permissions match this terminal. This request expires in ${Math.ceil(data.expires_in/60)} minutes.`);
 if(!opts['no-browser']) {
  const program=platform==='darwin'?'open':platform==='win32'?'rundll32':'xdg-open',args=platform==='win32'?['url.dll,FileProtocolHandler',complete.href]:[complete.href];
  try{if((await execute(program,args,{cwd})).code!==0)progress('The browser could not open. Visit the URL above and enter the code.');}catch{progress('The browser could not open. Visit the URL above and enter the code.');}
 }
 let interval=data.interval;
 while(now()<deadline) {
  let remaining=interval*1000;
  while(remaining>0&&now()<deadline){const part=Math.min(remaining,60000,deadline-now());await wait(part);remaining-=part;}
  if(now()>=deadline)break;
  let poll,answer;
  try{poll=await request('/api/cli/token',{device_code:data.device_code});answer=await poll.json();}catch{interval=Math.max(5,Math.min(60,interval*2));continue;}
  if(poll.ok) {
   if(!/^nhc_[a-f0-9]{64}$/.test(answer.access_token??''))throw Error('Server returned an invalid CLI credential');
   try{return await nativeCommand({group:'auth',action:'login',pos:[],opts:{...opts,'with-api-token':true},target,git,readToken:async()=>answer.access_token,write,fetcher,environment});}
   catch(error) {
    // This is a newly issued browser grant, so failed local setup must not leave
    // a hidden active credential. Manually supplied tokens retain their behavior.
    try{await apiRequest(target.origin,'/api/cli/logout',answer.access_token,{method:'POST',body:target.repository?{repository:target.repository}:{trunk:target.trunk},fetcher});progress('The new CLI credential was revoked because local setup failed.');}catch{progress('Local setup failed. Revoke the new CLI credential in repository Git access.');}
    throw error;
   }
  }
  if(answer.error==='authorization_pending')continue;
  if(answer.error==='slow_down'){interval=Math.max(interval+5,Number.isFinite(answer.interval)?answer.interval:0);continue;}
  if(poll.status===429){const seconds=Number(poll.headers.get('retry-after'));interval=Math.max(interval,Number.isFinite(seconds)&&seconds>0?seconds:interval+5);continue;}
  if(poll.status>=500){interval=Math.min(60,interval*2);continue;}
  if(answer.error==='access_denied')throw Error('CLI authorization was denied or repository access changed. No credential was saved.');
  if(answer.error==='expired_token')break;
  throw Error('CLI authorization ended. Start a new login.');
 }
 throw Error('CLI authorization expired. Run auth login again.');
}
