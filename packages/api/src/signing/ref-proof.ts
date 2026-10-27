import {createHash} from "node:crypto";
import {commitAt} from "../review/graph";
import type {StoredObject} from "../objects";
import type {SignatureResult,SignatureProof} from "./types";
import type {RulesetPlan} from "../repository/ruleset-types";
import type {BranchPolicy} from "../repository/types";

export type GraphPlan = RulesetPlan & { signing?:{branches:{name:string;commit:string}[];policies:BranchPolicy[]} };
export const branchFingerprint=(refs:{name:string;commit:string}[])=>createHash("sha256").update(JSON.stringify(refs.filter(ref=>ref.name.startsWith("refs/heads/")).map(ref=>[ref.name,ref.commit]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0))).digest("hex");

/** Only target-old ancestry is exempt on updates. New ruleset branches also
 * exempt ancestry already reachable from a pre-push branch, as GitHub does. */
export async function signedHistory(get:(sha:string)=>Promise<StoredObject|null>,old:string|null,next:string,knownBranches:{name:string;commit:string}[]|undefined,verify:(sha:string,raw:Uint8Array)=>Promise<SignatureResult>):Promise<SignatureProof> {
  const known=new Set<string>(),before=old?[old]:knownBranches?.map(branch=>branch.commit)??[];
  let reads=0,bytes=0;
  const commit=async(sha:string)=>{const object=await get(sha);if(!object||object.type!=="commit")throw Error("Signature rule requires complete commit history");if(++reads>200000||(bytes+=object.body.length)>2**31)throw Error("Signature history exceeds graph limits");return {...await commitAt({body:async()=>object.body},sha),raw:object.body};};
  for(let at=0;at<before.length;at++){const sha=before[at];if(known.has(sha))continue;if(known.size>=100000)throw Error("Signature ancestry exceeds commit limit");known.add(sha);before.push(...(await commit(sha)).parents);}
  const seen=new Set<string>(),queue=[next];let checked=0;
  const context=knownBranches?{creationBranches:branchFingerprint(knownBranches)}:{};
  for(let at=0;at<queue.length;at++) {
    const sha=queue[at];if(known.has(sha)||seen.has(sha))continue;seen.add(sha);
    if(++checked>1000)throw Error("Signature verification exceeds 1000 introduced commits; split the update");
    const c=await commit(sha),result=await verify(sha,c.raw);
    if(!result.verified)return {verified:false,checked,reason:`commit ${sha.slice(0,12)}: ${result.reason??"signature verification failed"}`,...context};
    queue.push(...c.parents);
  }
  return {verified:true,checked,reason:null,...context};
}
