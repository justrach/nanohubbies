import {resolve} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {outsideCheckout,readPrivateJson,createPrivateJson} from './private-file.mjs';
const validId=value=>/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value??'');
const validName=value=>typeof value==='string'&&/^[\w.-]{1,80}$/.test(value);
function document(record,target){
 if(!record||typeof record!=='object'||Array.isArray(record)||Object.keys(record).some(key=>!['format','origin','repository','trunk','id','name','token'].includes(key))||record.format!==1||record.origin!==target.origin||record.repository!==target.repository||record.trunk!==target.trunk||!validId(record.id)||!validName(record.name)||typeof record.token!=='string'||!/^nhci_[a-f0-9]{64}$/.test(record.token))throw Error('Use a private runner credential file for this exact host and repository');
 return record;
}
export async function readRunnerCredentialFile(path,target){
 return readPrivateJson(path,'runner credential',value=>document(value,target));
}
export async function runnerCommand({action,pos,opts,target,base,token,request,output,cwd=process.cwd()}){
 const path=base+'/ci/runners';
 if(action==='list'&&(pos.length||opts['token-file']!==undefined||opts.confirm!==undefined))throw Error('Use runner list');
 if(action==='create'&&(pos.length!==1||!validName(pos[0])||!opts['token-file']||opts.confirm!==undefined))throw Error('Use runner create NAME --token-file FILE');
 if(action==='recover'&&(pos.length||!opts['token-file']||opts.confirm!==undefined))throw Error('Use runner recover --token-file FILE');
 if(action==='revoke'&&(pos.length!==1||!validId(pos[0])||opts.confirm!==pos[0]||opts['token-file']!==undefined))throw Error('Use runner revoke ID --confirm ID');
 const file=opts['token-file']?resolve(cwd,opts['token-file']):undefined;
 if(file)await outsideCheckout(file);
 const record=action==='recover'?await readRunnerCredentialFile(file,target):undefined;
 const configuration=await request(path,token);
 if(configuration.clientCredentials!=='v1'||configuration.cliAudit!==true||configuration.ownerOnly!==true)throw Error('Runner administration is updating; inspect runner list again shortly');
 if(action==='list'){
  const registrations=configuration.registrations.map(r=>({id:r.id,name:r.name,revoked:r.revoked,active:r.active}));
  output({registrations},registrations.map(r=>`${r.id}\t${r.revoked?'revoked':'active'}\t${r.name}\t${r.active} running`).join('\n')||'No runner registrations.');return;
 }
 if(action==='revoke'){
  const result=await request(base+'/ci/'+pos[0],token,{method:'DELETE',body:{}}),r=result.registration;
  if(r?.id!==pos[0]||r.revoked!==true)throw Error('Runner revocation was not confirmed; inspect runner list');
  output({registration:{id:r.id,name:r.name,revoked:true}},`Revoked runner ${r.name} (${r.id}). Active leases are invalidated.`);return;
 }
 const selected=record??{format:1,origin:target.origin,repository:target.repository,trunk:target.trunk,id:randomUUID(),name:pos[0],token:'nhci_'+randomBytes(32).toString('hex')};
 if(action==='create')await createPrivateJson(file,selected,'runner credential','registration');
 let result;
 try{result=await request(path,token,{method:'POST',body:{id:selected.id,name:selected.name,token:selected.token}});}
 catch(error){throw Error(`${error.message}. The private credential file is retained; use runner recover --token-file FILE to retry this same registration, or inspect runner list.`);}
 const r=result.registration;if(r?.id!==selected.id||r.name!==selected.name||r.revoked!==false)throw Error('Registration was not confirmed; keep the private credential file and inspect runner list');
 output({registration:{id:r.id,name:r.name,revoked:false},tokenFile:file},`Registered runner ${r.name} (${r.id}). Its credential is saved only in ${file}; keep this file in the trusted dispatcher.`);
}
