import {resolve} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {outsideCheckout,readPrivateJson,createPrivateJson} from './private-file.mjs';
const uuid=value=>/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value??'');
const name=value=>typeof value==='string'&&/^[A-Z_][A-Z0-9_]{0,127}$/.test(value);
const revision=value=>/^(0|[1-9]\d{0,15})$/.test(value??'')&&Number.isSafeInteger(Number(value));
function grantDocument(value,target,environment){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['format','origin','repository','trunk','repositoryId','readUrl','environment','id','credentialId','token','names','expires','revision'].includes(key))||value.format!==1||value.origin!==target.origin||value.repository!==target.repository||value.trunk!==target.trunk||value.environment!==environment||!/^([a-z0-9][a-z0-9-]{0,62})$/.test(value.repositoryId??'')||value.readUrl!==new URL('/api/trunks/'+value.repositoryId+'/secrets/read?'+new URLSearchParams({environment}),target.origin).href||!uuid(value.id)||!uuid(value.credentialId)||!/^nhw_[a-f0-9]{64}$/.test(value.token??'')||!Array.isArray(value.names)||!value.names.length||value.names.length>100||!value.names.every(name)||new Set(value.names).size!==value.names.length||!Number.isSafeInteger(value.expires)||value.expires<1||!Number.isSafeInteger(value.revision)||value.revision<0)throw Error('Use a private workload grant file for this exact host, repository and environment');
 return value;
}
export async function secretCommand({action,pos,opts,target,base,token,request,output,cwd=process.cwd()}){
 if(!['list','connect','disconnect','grant','recover','revoke'].includes(action))throw Error('Unknown secret command');
 const environment=opts.environment??'staging',common=['repo','trunk','host','json','helper','positionals','environment'],specific=action==='connect'?['binding','revision']:action==='disconnect'?['revision','confirm']:action==='grant'?['revision','ttl','token-file']:action==='recover'?['token-file']:action==='revoke'?['confirm']:[];
 if(!/^[a-z][a-z0-9-]{0,31}$/.test(environment)||Object.keys(opts).some(key=>![...common,...specific].includes(key)))throw Error('Use secret list, connect, disconnect, grant, recover or revoke with documented options');
 if(action==='list'&&pos.length||action==='connect'&&(pos.length!==1||!name(pos[0])||!name(opts.binding)||!revision(opts.revision))||action==='disconnect'&&(pos.length!==1||!name(pos[0])||opts.confirm!==pos[0]||!revision(opts.revision))||action==='grant'&&(!pos.length||pos.length>100||!pos.every(name)||new Set(pos).size!==pos.length||!revision(opts.revision)||!opts['token-file'])||action==='recover'&&(pos.length||!opts['token-file'])||action==='revoke'&&(pos.length!==1||!uuid(pos[0])||opts.confirm!==pos[0]))throw Error('Use secret connect NAME --binding BINDING --revision N; disconnect NAME --revision N --confirm NAME; grant NAMES --revision N --token-file FILE; recover --token-file FILE; or revoke ID --confirm ID');
 const ttl=Number(opts.ttl??900);if(action==='grant'&&(!/^[1-9]\d{0,3}$/.test(String(opts.ttl??900))||!Number.isInteger(ttl)||ttl<60||ttl>3600))throw Error('Use --ttl between 60 and 3600 seconds');
 const file=opts['token-file']?resolve(cwd,opts['token-file']):undefined;if(file)await outsideCheckout(file,'workload grant');
 const saved=action==='recover'?await readPrivateJson(file,'workload grant',value=>grantDocument(value,target,environment),{maxBytes:32768}):undefined;
 const query='?'+new URLSearchParams({environment}),path=base+'/secrets',data=await request(path+query,token);
 if(data.conditionalWrites!==true||data.clientGrants!=='v1'||data.revisionTracking!=='storage')throw Error('Secret administration is updating; inspect secret list again shortly');
 if(action==='list'){output(data,`Secret reference revision: ${data.revision}\n`+(data.secrets.map(s=>`${s.name}\t${s.binding}\tversion ${s.version}`).join('\n')||'No Cloudflare secret references.')+`\n${data.grants.length} active workload grants. Saved values remain in Cloudflare.`);return;}
 if(data.readOnly&&action!=='revoke')throw Error('The repository is archived; secret reference edits and grant issuance are paused. Existing grants can be revoked.');
 if(action==='connect'||action==='disconnect'){
  const result=await request(path+'/'+pos[0]+query,token,{method:action==='connect'?'PUT':'DELETE',body:action==='connect'?{binding:opts.binding}:{},revision:Number(opts.revision),revisionType:'secrets'});
  if(action==='connect'&&(result.secret?.name!==pos[0]||result.secret?.binding!==opts.binding)||action==='disconnect'&&(result.disconnected!==true||result.valueRetainedByCloudflare!==true))throw Error('Reference update was not confirmed; inspect secret list before repeating it');
  output(result,`${action==='connect'?'Connected':'Disconnected'} ${pos[0]}. Revision: ${result.revision}. Cloudflare retains the saved value.`);return;
 }
 if(action==='revoke'){
  const result=await request(path+'/grants/'+pos[0]+query,token,{method:'DELETE',body:{}});if(result.revoked!==true||result.id!==pos[0])throw Error('Grant revocation was not confirmed; inspect secret list');output({id:result.id,revoked:true},`Revoked workload grant ${result.id}. Cloudflare retains saved values.`);return;
 }
 if(!/^[a-z0-9][a-z0-9-]{0,62}$/.test(data.repositoryId??'')||!Number.isSafeInteger(data.serverTime)||!uuid(data.delegationId)||!Number.isSafeInteger(data.delegationExpiresAt))throw Error('The server did not provide a bounded CLI grant lifetime');
 if(saved&&(saved.credentialId!==data.delegationId||saved.repositoryId!==data.repositoryId))throw Error('This grant belongs to a different CLI credential; recovery cannot transfer or revive its delegation');
 const selected=saved??{format:1,origin:target.origin,repository:target.repository,trunk:target.trunk,repositoryId:data.repositoryId,readUrl:new URL('/api/trunks/'+data.repositoryId+'/secrets/read?'+new URLSearchParams({environment}),target.origin).href,environment,id:randomUUID(),credentialId:data.delegationId,token:'nhw_'+randomBytes(32).toString('hex'),names:[...pos].sort(),expires:Math.min(data.serverTime+ttl*1000,data.delegationExpiresAt),revision:Number(opts.revision)};
 if(!saved&&selected.expires<data.serverTime+60000)throw Error('This CLI credential expires too soon to issue a workload grant; sign in again');
 if(action==='grant')await createPrivateJson(file,selected,'workload grant','grant issuance');
 let result;try{result=await request(path+'/grants'+query,token,{method:'POST',body:{id:selected.id,token:selected.token,names:selected.names,expires:selected.expires},revision:selected.revision,revisionType:'secrets'});}catch(error){throw Error(`${error.message}. The private grant file is retained; inspect secret list or recover this same grant with secret recover --token-file FILE. Recovery never extends expiry or restores a revoked grant.`);}
 if(result.grant?.id!==selected.id||result.grant?.expires!==selected.expires||typeof result.grant?.created!=='boolean'||!Array.isArray(result.grant?.names)||JSON.stringify([...result.grant.names].sort())!==JSON.stringify(selected.names))throw Error('Grant issuance was not confirmed; retain the private grant file and inspect secret list');
 const grant={id:selected.id,names:selected.names,expires:selected.expires,created:result.grant.created===true};
 output({grant,tokenFile:file},`${grant.created?'Issued':'Recovered'} workload grant ${grant.id}, expiring ${new Date(grant.expires).toISOString()}. Its credential is saved only in ${file}. It also stops if the issuing CLI credential expires or is revoked.`);
}
