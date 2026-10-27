import {ObjectReader} from "../objects";
import {signedHistory} from "./ref-proof";
import type {SignatureGate} from "./types";
import type {Branch} from "../review/types";

export async function signatureGate(env:Env,trunk:string,head:Branch,base:Branch,required:boolean):Promise<SignatureGate> {
  if(!required)return {required:false,verified:false,checked:0,error:null};
  try {
    const reader=new ObjectReader(env.OBJECTS,trunk,async()=>(await env.PACKER.get(env.PACKER.idFromName(trunk)).list()).packs),hub=env.HUB.get(env.HUB.idFromName("hub"));
    const result=await signedHistory(sha=>reader.get(sha),base.commit,head.commit,undefined,(sha,raw)=>hub.verifyCommitSignature(trunk,sha,raw));
    const refs=await env.SEQUENCER.get(env.SEQUENCER.idFromName(trunk)).repositoryRefs();
    if(refs.find(ref=>ref.name===`refs/heads/${head.name}`)?.commit!==head.commit||refs.find(ref=>ref.name===`refs/heads/${base.name}`)?.commit!==base.commit)throw Error("PR changed while verifying signatures; refresh and retry");
    return {required:true,verified:result.verified,checked:result.checked,error:result.reason};
  }catch(error){return {required:true,verified:false,checked:0,error:(error as Error).message.slice(0,256)};}
}
