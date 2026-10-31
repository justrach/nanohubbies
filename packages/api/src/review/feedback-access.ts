import {ownerEvidence} from '../team/access';
import {currentCliGrant} from '../cli/credentials';
import type {ReviewerMembership} from './reviewer-types';
import type {Review} from './types';
import type {Pull} from './types';

export interface ReviewActor {id:string;origin:string;via?:Review['via']}
export interface ReviewAccess {role:'writer'|'reader';checkedAt:number;expiresAt:number}

/** Separate from approval discovery: read membership is not write eligibility. */
export async function feedbackMembership(env:Env,trunk:string,origin:string,accounts:string[]):Promise<ReviewerMembership>{
 const ids=[...new Set(accounts)];if(ids.length>2000)throw Error('Reviewer membership lookup limit exceeded');
 const hub=env.HUB.get(env.HUB.idFromName('hub')),snapshot=await hub.reviewFeedbackAccess(trunk,ids);
 if(snapshot.readerFeedback!=='v1')throw Error('Reader feedback access is updating');
 if(!snapshot.binding||snapshot.binding.kind==='owner')return {accounts:snapshot.accounts,checkedAt:snapshot.checkedAt,expiresAt:snapshot.checkedAt+30000};
 if(!origin||ids.length>128)throw Error('Reader feedback membership verification is unavailable');
 const result:ReviewerMembership={accounts:{},checkedAt:Date.now(),expiresAt:Date.now()+30000},binding=snapshot.binding;
 for(let i=0;i<ids.length;i+=8)await Promise.all(ids.slice(i,i+8).map(async id=>{
  try{const evidence=await ownerEvidence(env,origin,id,[binding.roomId]);result.expiresAt=Math.min(result.expiresAt,evidence.checkedAt+30000);result.accounts[id]=evidence.issuer===binding.issuer&&evidence.rooms.some(room=>room.id===binding.roomId&&['owner','member'].includes(room.role))?'writer':'no_write';}
  catch{result.accounts[id]='unavailable';}
 }));
 return result;
}

export async function currentReviewAccess(env:Env,trunk:string,actor:ReviewActor):Promise<ReviewAccess>{
 if(!actor||typeof actor.id!=='string'||!actor.id||typeof actor.origin!=='string'||!actor.origin||actor.via&&(actor.via.kind!=='cli'||typeof actor.via.credentialId!=='string'||!actor.via.credentialId))throw Error('Review feedback requires a signed-in account');
 const membership=await feedbackMembership(env,trunk,actor.origin,[actor.id]),role=membership.accounts[actor.id];
 if(role!=='writer'&&role!=='reader')throw Error('Review feedback requires current repository read access');
 const grant=actor.via?await currentCliGrant(env,actor.via.credentialId,actor.id,trunk,actor.origin,'reviews:write'):null;
 if(actor.via&&(actor.via.kind!=='cli'||!grant))throw Error('CLI review permission expired or was revoked');
 return {role,checkedAt:membership.checkedAt,expiresAt:Math.min(membership.expiresAt,grant?.expiresAt??Infinity)};
}

export function reviewDecisionAllowed(pull:Pull,actor:string,verdict:Review['verdict'],body:string,inline=0){
 if(!['COMMENT','APPROVE','REQUEST_CHANGES'].includes(verdict)||typeof body!=='string'||body.length>16000)throw Error('Invalid review');
 if(pull.author.id===actor&&verdict!=='COMMENT')throw Error('Pull request authors can comment but cannot approve or request changes on their own work');
 if(verdict==='COMMENT'&&!body.trim()&&!inline)throw Error('Write feedback or add an inline comment before submitting a comment review');
}

export function assertReviewAccess(access:ReviewAccess,now=Date.now()){
 if(!Number.isFinite(access.checkedAt)||!Number.isFinite(access.expiresAt)||access.checkedAt>now||now-access.checkedAt>30000||access.expiresAt<=now)throw Error('Review authorization expired; refresh');
}
