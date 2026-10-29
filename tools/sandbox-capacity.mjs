import {randomUUID} from 'node:crypto';
import {writeFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';

export async function capacityReceipt(path,body) {
  const temporary=path+'.'+randomUUID()+'.tmp';
  try {await writeFile(temporary,JSON.stringify(body,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(temporary,path);}
  finally {await rm(temporary,{force:true});}
}
/** No mutation retry after a lost response. Only an explicit capacity denial
 * can be polled, since it is known not to have reserved or allocated anything. */
export function sandboxCapacity(api,run,artifacts,{active=async()=>true,now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),receipt=capacityReceipt}={}) {
  return {async acquire(job) {
    const input={id:randomUUID(),runId:run.id,attempt:run.attempt,job:job.name};
    const path=join(artifacts,job.name.replaceAll('/','-')+'.capacity.json');
    let record={...input,state:'reserve-pending',sandboxId:null};
    const save=async patch=>{record={...record,...patch};await receipt(path,record);};
    for(;;) {
      if(now()>=run.leaseUntil-30000||!await active())throw Error('CI lease exhausted while waiting for shared sandbox capacity');
      await save({state:'reserve-pending'});
      const response=await api('/capacity/reserve',input);
      if(response.admitted===false&&Number.isSafeInteger(response.retryAfter)&&response.retryAfter>=1&&response.retryAfter<=60) {
        await save({state:'waiting'});
        await sleep(Math.min(response.retryAfter*1000,Math.max(0,run.leaseUntil-30000-now())));
        continue;
      }
      if(response.admitted!==true||response.reservation?.id!==input.id||response.reservation?.runId!==input.runId||response.reservation?.attempt!==input.attempt||response.reservation?.job!==input.job||response.reservation?.state!=='reserved'||response.reservation.sandboxId!==null)throw Error('Shared sandbox reservation is unavailable; reconcile the saved capacity receipt');
      await save({state:'reserved'});
      return {
        async allocating(){await save({state:'allocation-pending'});},
        async attached(sandboxId){
          // Save the provider ID before the attach RPC, so a lost response can
          // still be reconciled without issuing a second provider allocation.
          await save({state:'allocated',sandboxId});
          const result=await api('/capacity/attach',{id:input.id,sandboxId});
          if(result.id!==input.id||result.state!=='allocated'||result.sandboxId!==sandboxId)throw Error('Sandbox attachment was not confirmed; reservation retained');
        },
        async released(sandboxId){
          await save({state:'release-pending',sandboxId:sandboxId??null});
          const result=await api('/capacity/release',{id:input.id,reason:sandboxId?'destroyed':'not-created',...(sandboxId?{sandboxId}:{})});
          if(result.id!==input.id||result.state!=='released'||result.sandboxId!==(sandboxId??null))throw Error('Sandbox capacity release was not confirmed; reconcile the saved capacity receipt');
          await save({state:'released'});
        },
      };
    }
  }};
}
