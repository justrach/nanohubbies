import { ownerEvidence } from "../team/access";
import type { CodeOwnerEvidence } from "./codeowner-types";

/** Called again by the sequencer immediately before its final merge transaction.
 * Namespaces are immutable identities; current repository authority is separate. */
export async function codeOwnerAccounts(env: Env, trunk: string, origin: string, evidence: CodeOwnerEvidence) {
  const tokens=[...new Set(evidence.groups.flatMap(g=>g.owners))];
  if(tokens.length>1000)throw Error("CODEOWNERS account lookup limit exceeded");
  const hub=env.HUB.get(env.HUB.idFromName("hub"));
  const {binding,accounts}=await hub.codeOwnerAccounts(trunk,tokens);
  if(binding?.kind==="owner")return accounts;
  if(!binding)throw Error("Code owner review requires a repository membership boundary");
  const ids=[...new Set(Object.values(accounts).filter((id):id is string=>!!id))];
  const allowed=new Set<string>();
  for(let start=0;start<ids.length;start+=8)await Promise.all(ids.slice(start,start+8).map(async id=>{
    const proof=await ownerEvidence(env,origin,id,[binding.roomId]);
    if(proof.issuer===binding.issuer&&proof.rooms.some(r=>r.id===binding.roomId&&["owner","member"].includes(r.role)))allowed.add(id);
  }));
  return Object.fromEntries(Object.entries(accounts).map(([owner,id])=>[owner,id&&allowed.has(id)?id:null]));
}
