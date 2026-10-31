import {open,readFile,writeFile,rename,realpath} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {meldJobId,meldRepository} from './meld-pipeline-state.mjs';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const unconfirmed=()=>Object.assign(Error('Meld mirror cleanup is unconfirmed; inspect the private receipt without replaying deletion'),{code:'meld_cleanup_unconfirmed'});

/** Retire only the acknowledged checks attempt's ref. Expected-old Git leases
 * protect changed refs; an uncertain saved intent never permits a second push. */
export async function retireMeldMirror({binding,jobId,source,artifacts,git,observe,now=Date.now}) {
 if(!binding||binding.deploy!==false||!/^[a-z0-9][a-z0-9-]{0,79}$/.test(binding.runId??'')||!Number.isSafeInteger(binding.attempt)||binding.attempt<1||!/^[a-f0-9]{40}$/.test(binding.sha??'')||!/^[a-f0-9]{40}$/.test(binding.base??'')||binding.ref!==`nanohub-ci/${binding.runId}/${binding.attempt}`||!meldJobId(jobId)||!isAbsolute(source??'')||!isAbsolute(artifacts??''))throw Error('Only an acknowledged attempt-owned checks mirror can be retired');
 const checkout=await realpath(source),directory=await realpath(artifacts);
 if(directory===checkout||directory.startsWith(checkout+'/'))throw Error('Keep cleanup receipts outside candidate execution');
 if(await git(checkout,'rev-parse','HEAD')!==binding.sha)throw Error('Nanohub checkout changed before mirror cleanup');
 let dispatch;
 try{dispatch=JSON.parse(await readFile(join(directory,'meld-dispatch.json'),'utf8'));}catch{throw Error('Acknowledged Meld dispatch receipt is required for cleanup');}
 if(dispatch.format!==1||dispatch.state!=='acknowledged'||dispatch.jobId!==jobId||!same(dispatch.binding,binding))throw Error('Mirror cleanup does not match its acknowledged dispatch');
 const identity={binding,jobId},path=join(directory,'meld-mirror-cleanup.json'),ref='refs/heads/'+binding.ref;
 const save=async value=>{const temporary=path+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(temporary,path);};
 const remote=async()=>{
  const result=await git(checkout,'ls-remote','--refs',meldRepository,ref);
  if(result==='')return null;
  const match=/^([a-f0-9]{40})\t([^\r\n]+)$/.exec(result);
  if(!match||match[2]!==ref)throw Error('Meld mirror ref cannot be verified');
  return match[1];
 };
 let prior;
 try{prior=JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code!=='ENOENT')throw Error('Mirror cleanup receipt cannot be verified');}
 if(prior){
  if(prior.format!==1||!same(prior.identity,identity)||!['pending','removed'].includes(prior.state))throw Error('Mirror cleanup receipt belongs to another attempt or is invalid');
  let current;try{current=await remote();}catch{throw unconfirmed();}
  if(current!==null)throw unconfirmed();
  if(prior.state==='pending'){prior={...prior,state:'removed',reconciled:true,completedAt:now()};await save(prior);}
  return {ref:binding.ref,removed:true,reconciled:prior.reconciled===true};
 }
 const terminal=rows=>{
  const job=rows.find(row=>row.id===jobId);
  if(!job||job.sha!==binding.sha||job.ref!==binding.ref||job.deploy!==false||job.pending||!['passed','failed','superseded'].includes(job.phase)||rows.some(row=>row.ref===binding.ref&&row.pending))throw Error('Meld mirror is still in use or its terminal job cannot be verified');
 };
 terminal(await observe());
 const current=await remote();
 if(current!==null&&current!==binding.sha)throw Error('Meld mirror changed; refusing to delete another revision');
 const receipt={format:1,identity,state:current===null?'removed':'pending',startedAt:now(),deletionIntent:current!==null};
 let handle;
 try{handle=await open(path,'wx',0o600);await handle.writeFile(JSON.stringify(receipt,null,2)+'\n');await handle.sync();}
 catch{throw unconfirmed();}finally{await handle?.close();}
 if(current===null)return {ref:binding.ref,removed:true,reconciled:false};
 terminal(await observe());
 let acknowledged=true;
 try{await git(checkout,'push','--force-with-lease='+ref+':'+binding.sha,meldRepository,':'+ref);}catch{acknowledged=false;}
 let after;try{after=await remote();}catch{throw unconfirmed();}
 if(after!==null)throw unconfirmed();
 await save({...receipt,state:'removed',reconciled:!acknowledged,completedAt:now()});
 return {ref:binding.ref,removed:true,reconciled:!acknowledged};
}
