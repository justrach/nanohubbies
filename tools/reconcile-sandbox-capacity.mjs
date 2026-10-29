/** Trusted operator repair. A missing provider allocation ID is deliberately
 * not guessed from the account inventory. No timer frees an uncertain slot. */
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {Codegraff} from './codegraff-actions.mjs';
import {capacityReceipt} from './sandbox-capacity.mjs';
import {resolveFleetTargets} from './runner-pool.mjs';

export async function reconcileCapacity(record,{api,client,release=false,destroy=false,save=async()=>{}}) {
  if(!record||typeof record.id!=='string'||!/^[a-f0-9-]{36}$/.test(record.id))throw Error('Use a saved sandbox capacity receipt');
  const current=await api('/capacity/inspect',{id:record.id});
  if(current.id!==record.id||current.runId!==record.runId||current.attempt!==record.attempt||current.job!==record.job)throw Error('Capacity receipt does not match this repository reservation');
  if(current.state==='released'){await save({...record,state:'released',sandboxId:current.sandboxId});return {id:record.id,state:'released',alreadyReleased:true};}
  const sandboxId=current.sandboxId??record.sandboxId;
  if(!sandboxId)throw Error('Allocation outcome is unknown; retain this slot and reconcile with the provider. Automatic release is unsafe');
  if(typeof sandboxId!=='string'||!/^[a-zA-Z0-9_-]{1,160}$/.test(sandboxId)||record.sandboxId&&record.sandboxId!==sandboxId)throw Error('Conflicting sandbox ID in capacity receipt');
  let absent=false;
  if(destroy){await client.destroy(sandboxId);absent=true;}
  else {
    try {const response=await client.api('/sandboxes/'+sandboxId);absent=['destroyed','deleted','expired'].includes(response.status??response.state);}
    catch(error){if(error.status!==404)throw error;absent=true;}
  }
  if(release||destroy) {
    if(!absent)throw Error('Sandbox still exists; reservation retained. Inspect it or explicitly use --destroy');
    const result=await api('/capacity/release',{id:record.id,reason:'destroyed',sandboxId});
    if(result.state!=='released')throw Error('Sandbox capacity release was not confirmed');
    await save({...record,state:'released',sandboxId});
    return {id:record.id,sandboxId,state:'released',providerAbsenceConfirmed:true};
  }
  return {id:record.id,sandboxId,state:current.state,providerAbsenceConfirmed:absent};
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href) {
  const [configPath,receiptPath,...flags]=process.argv.slice(2);
  if(!configPath||!receiptPath||flags.some(flag=>!['--release','--destroy'].includes(flag)))throw Error('Usage: bun tools/reconcile-sandbox-capacity.mjs <trusted-config.json> <job.capacity.json> [--release | --destroy]');
  const config=JSON.parse(await readFile(configPath,'utf8')),targets=await resolveFleetTargets(config,process.env);
  if(targets.length!==1)throw Error('Use a trusted config for exactly one repository');
  const target=targets[0],origin=new URL(target.config.origin);
  if(origin.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(origin.hostname))throw Error('HTTPS required');
  const base=origin.origin+(target.config.repository?'/api/repos/'+target.config.repository:'/api/trunks/'+target.config.trunk)+'/ci';
  const api=async(path,body)=>{
    const response=await fetch(base+path,{method:'POST',headers:{Authorization:'Bearer '+target.token,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error('Capacity request failed ('+response.status+'); reservation may still be held');
    return response.json();
  };
  const record=JSON.parse(await readFile(receiptPath,'utf8'));
  console.log(JSON.stringify(await reconcileCapacity(record,{api,client:new Codegraff(process.env.CODEGRAFF_API_KEY),release:flags.includes('--release'),destroy:flags.includes('--destroy'),save:body=>capacityReceipt(receiptPath,body)}),null,2));
}
