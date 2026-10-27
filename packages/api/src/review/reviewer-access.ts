import { ownerEvidence } from "../team/access";
import type { ReviewerMembership } from "./reviewer-types";

/** No positive cache: native roles are one Hub snapshot; external roles are fresh. */
export async function reviewerMembership(env:Env,trunk:string,origin:string,accounts:string[]):Promise<ReviewerMembership> {
  const ids=[...new Set(accounts)];
  if(ids.length>2000)throw Error("Reviewer membership lookup limit exceeded");
  const now=Date.now();
  if(!ids.length)return {accounts:{},checkedAt:now,expiresAt:now+30000};
  const hub=env.HUB.get(env.HUB.idFromName("hub")),snapshot=await hub.reviewerAccess(trunk,ids);
  if(!snapshot.binding||snapshot.binding.kind==="owner")return {accounts:snapshot.accounts,checkedAt:snapshot.checkedAt,expiresAt:snapshot.checkedAt+30000};
  if(!origin)throw Error("Reviewer membership verification requires the request origin");
  if(ids.length>128)throw Error("External reviewer membership lookup limit exceeded");
  const result:ReviewerMembership={accounts:{},checkedAt:Date.now(),expiresAt:Date.now()+30000};
  const binding=snapshot.binding;
  for(let i=0;i<ids.length;i+=8)await Promise.all(ids.slice(i,i+8).map(async id=>{
    try {
      const evidence=await ownerEvidence(env,origin,id,[binding.roomId]);
      result.expiresAt=Math.min(result.expiresAt,evidence.checkedAt+30000);
      result.accounts[id]=evidence.issuer===binding.issuer&&evidence.rooms.some(room=>room.id===binding.roomId&&["owner","member"].includes(room.role))?"writer":"no_write";
    }catch{result.accounts[id]="unavailable";}
  }));
  return result;
}
