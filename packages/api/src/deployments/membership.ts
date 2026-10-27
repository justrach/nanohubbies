import {ownerEvidence} from '../team/access';
import type {DeploymentMembership} from './approval-types';
/** Environment reviewers may be current readers; PR approvals retain their
 * separate writer-only policy. No positive membership cache is shared. */
export async function deploymentMembership(env:Env,trunk:string,origin:string,accounts:string[]):Promise<DeploymentMembership> {
 const ids=[...new Set(accounts)];if(ids.length>128)throw Error('Deployment reviewer lookup limit exceeded');
 const now=Date.now();if(!ids.length)return {accounts:{},checkedAt:now,expiresAt:now+30000};
 const hub=env.HUB.get(env.HUB.idFromName('hub')),snapshot=await hub.deploymentReviewerAccess(trunk,ids);
 if(!snapshot.binding||snapshot.binding.kind==='owner')return {accounts:snapshot.accounts,checkedAt:snapshot.checkedAt,expiresAt:snapshot.checkedAt+30000};
 if(!origin)throw Error('Deployment reviewer verification requires the request origin');
 const result:DeploymentMembership={accounts:{},checkedAt:Date.now(),expiresAt:Date.now()+30000},binding=snapshot.binding;
 for(let i=0;i<ids.length;i+=8)await Promise.all(ids.slice(i,i+8).map(async id=>{try{const evidence=await ownerEvidence(env,origin,id,[binding.roomId]);result.expiresAt=Math.min(result.expiresAt,evidence.checkedAt+30000);result.accounts[id]=evidence.issuer===binding.issuer&&evidence.rooms.some(room=>room.id===binding.roomId)?'member':'absent';}catch{result.accounts[id]='unavailable';}}));return result;
}
