import {ownerEvidence} from '../team/access';
import type {RulesetActor} from './bypass';
/** Called by the final writer, never populated from a request body or a
 * positive membership cache. Unavailable external evidence fails closed. */
export async function rulesetActor(env:Env,trunk:string,actor:string,origin:string):Promise<RulesetActor> {
 const snapshot=await env.HUB.get(env.HUB.idFromName('hub')).rulesetActor(trunk,actor);
 if(!snapshot.binding||snapshot.binding.kind==='owner')return {actor,role:snapshot.role,checkedAt:snapshot.checkedAt,expiresAt:snapshot.checkedAt+30000};
 if(!origin)throw Error('Current ruleset bypass membership needs the request origin');
 const evidence=await ownerEvidence(env,origin,actor,[snapshot.binding.roomId]);
 const member=evidence.issuer===snapshot.binding.issuer?evidence.rooms.find(room=>room.id===snapshot.binding!.roomId):undefined;
 return {actor,role:member?.role==='owner'?'owner':member?.role==='member'?'writer':null,checkedAt:evidence.checkedAt,expiresAt:evidence.checkedAt+30000};
}
