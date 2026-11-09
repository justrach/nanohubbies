import {pusher} from '../tokens';
import {currentCliGrant} from '../cli/credentials';
import {reviewerMembership} from './reviewer-access';
import type {PullReadinessInput} from './readiness';

/** Identity fields are supplied by the authenticated route, never its JSON body.
 * Control credentials remain in this RPC call and are not stored or audited. */
export async function pullReadinessAccess(env:Env,trunk:string,actor:PullReadinessInput['actor']){
  if(!actor||typeof actor.id!=='string'||!actor.id||typeof actor.origin!=='string'||new URL(actor.origin).origin!==actor.origin||actor.authorization&&actor.via)throw Error('Current repository writer access is required');
  let expiresAt=Infinity;
  if(actor.authorization){
    const credential=await pusher(env,new Request(actor.origin+'/api/trunks/'+encodeURIComponent(trunk)+'/pulls',{headers:{authorization:actor.authorization}}),trunk);
    if(!credential||credential.owner.id!==actor.id||credential.gitOnly||credential.readOnly||!Number.isFinite(credential.expiresAt))throw Error('Agent credential expired or was revoked');
    expiresAt=credential.expiresAt!;
  }
  if(actor.via){
    if(actor.via.kind!=='cli')throw Error('Current CLI pull request permission is required');
    const grant=await currentCliGrant(env,actor.via.credentialId,actor.id,trunk,actor.origin,'pulls:write');
    if(!grant)throw Error('CLI pull request permission expired or was revoked');
    expiresAt=grant.expiresAt;
  }
  const membership=await reviewerMembership(env,trunk,actor.origin,[actor.id]);
  if(membership.accounts[actor.id]!=='writer')throw Error('Current repository writer access is required');
  return {checkedAt:membership.checkedAt,expiresAt:Math.min(expiresAt,membership.expiresAt)};
}
export function assertPullReadinessAccess(access:{checkedAt:number;expiresAt:number},now=Date.now()){
  if(!Number.isFinite(access.checkedAt)||!Number.isFinite(access.expiresAt)||access.checkedAt>now||now-access.checkedAt>30000||access.expiresAt<=now)throw Error('Pull request authorization expired; refresh');
}
