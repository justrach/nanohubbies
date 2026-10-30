import {RpcTarget} from 'cloudflare:workers';
import {ownerEvidence} from '../team/access';
import {currentCliGrant} from '../cli/credentials';
export async function authorizeWorkload(env:Env,trunk:string,actor:string,origin:string,credentialId:string|null){
  const hub=env.HUB.get(env.HUB.idFromName('hub')),binding=await hub.team(trunk);
  if(!binding||!await hub.find(trunk))throw Error('Repository unavailable');
  if(binding.kind==='owner'){
    if(!['owner','admin'].includes((await hub.collaboratorRole(trunk,actor))??''))throw Error('Issuer no longer authorized');
  }else{
    const evidence=await ownerEvidence(env,origin,actor,[binding.roomId]);
    if(evidence.issuer!==binding.issuer||!evidence.rooms.some(room=>room.id===binding.roomId&&room.role==='owner'))throw Error('Issuer no longer authorized');
  }
  await hub.assertRepositoryWritable(trunk);
  const parent=credentialId?await currentCliGrant(env,credentialId,actor,trunk,origin,'secrets:grant'):null;
  if(credentialId&&!parent)throw Error('Issuing CLI delegation is no longer active');
  return Math.min(Date.now()+5000,parent?.expiresAt??Infinity);
}
/** A one-call capability. Captured bindings and identities are JS-private,
 * and only the final scalar expiry is returned to the separate Vault. */
export class WorkloadAuthority extends RpcTarget {
  #used=false;#check:()=>Promise<number>;
  constructor(check:()=>Promise<number>){super();this.#check=check;}
  authorize(){if(this.#used)throw Error('Workload authorization has already been consumed');this.#used=true;return this.#check();}
}
