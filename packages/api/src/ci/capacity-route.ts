import {creationBody} from '../abuse';
import {reservationId,sandboxId,validReservation,type ReserveSandbox} from './capacity';

/** Runner credentials are trusted control-plane credentials. A cleanup report
 * is their assertion of provider-confirmed destruction, not independent server
 * attestation. Cleanup remains available after archive/cancellation, using any
 * current runner credential for this repository; revoked keys stay denied. */
export async function capacityRoute(env:Env,request:Request,trunk:string,token:string,operation:string|undefined) {
  const headers={'Cache-Control':'private, no-store'};
  try {
    const seq=env.SEQUENCER.get(env.SEQUENCER.idFromName(trunk));await seq.ciAuthenticate(token);
    const hub=env.HUB.get(env.HUB.idFromName('hub'));
    const input=await creationBody<Record<string,unknown>>(request,2048);
    if(!input||Array.isArray(input)||typeof input!=='object')throw Error('Invalid sandbox capacity request');
    const fields=(allowed:string[])=>{if(Object.keys(input).some(key=>!allowed.includes(key)))throw Error('Unknown sandbox capacity field');};
    if(operation==='status'){fields([]);return Response.json(await hub.actionsCapacity(trunk),{headers});}
    if(operation==='reserve') {
      fields(['id','runId','attempt','job']);
      if(!validReservation(input as unknown as ReserveSandbox))throw Error('Invalid sandbox reservation');
      const body=input as unknown as ReserveSandbox;
      await seq.ciLogAccess(token,body.runId,body.attempt);
      return Response.json(await hub.reserveActionsSandbox(trunk,body),{headers});
    }
    if(!reservationId(input.id))throw Error('Invalid sandbox reservation ID');
    if(operation==='inspect'){fields(['id']);return Response.json(await hub.inspectActionsSandbox(trunk,input.id),{headers});}
    if(operation==='attach') {
      fields(['id','sandboxId']);if(!sandboxId(input.sandboxId))throw Error('Invalid sandbox ID');
      return Response.json(await hub.attachActionsSandbox(trunk,input.id,input.sandboxId),{headers});
    }
    if(operation==='release') {
      fields(['id','reason','sandboxId']);
      if(input.reason!=='not-created'&&input.reason!=='destroyed'||input.sandboxId!==undefined&&!sandboxId(input.sandboxId))throw Error('Invalid sandbox cleanup evidence');
      return Response.json(await hub.releaseActionsSandbox(trunk,input.id,{reason:input.reason,sandboxId:input.sandboxId as string|undefined}),{headers});
    }
    return Response.json({error:'Unknown sandbox capacity operation'},{status:404,headers});
  } catch(error) {return Response.json({error:(error as Error).message},{status:403,headers});}
}
