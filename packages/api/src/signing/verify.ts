import {createHash} from "node:crypto";
import type {SignatureResult} from "./types";
import {signedPayload} from "./commit";
import {sshSignatureAlias,verifySSH} from "./ssh";
import {pgpSignatureAliases,verifyPGP} from "./pgp";
import {SigningKeys} from "./store";

export async function verifyCommit(sql:SqlStorage,repository:string,sha:string,raw:Uint8Array,transaction:<T>(body:()=>T)=>T,currentEmail?:(account:string,email:string)=>Promise<boolean>):Promise<SignatureResult> {
  try {
    if(!/^[a-f0-9]{40}$/.test(sha)||raw.length>256*1024||createHash("sha1").update(`commit ${raw.length}\0`).update(raw).digest("hex")!==sha)throw Error("Invalid commit signature object");
    const objectDigest=createHash("sha256").update(raw).digest("hex"),store=new SigningKeys(sql),prior=store.receipt(repository,sha);if(prior){if(prior.objectDigest!==objectDigest)throw Error("Commit bytes differ from persisted signature verification");return {verified:true,reason:null,receipt:prior};}
    const signed=signedPayload(raw),aliases=signed.kind==="ssh"?[sshSignatureAlias(signed.signature)]:await pgpSignatureAliases(signed.signature);
    const key=store.candidate(aliases[0]);
    if(!key||key.kind!==signed.kind)throw Error("Signing key is not registered to a Nanohub account");
    if(key.revokedAt!==null)throw Error("Signing key was revoked before this commit was verified");
    if(!key.emails.includes(signed.email.toLowerCase()))throw Error("Committer email does not match the signing account");
    if(currentEmail&&!await currentEmail(key.owner.id,signed.email))throw Error("Committer email is no longer currently verified for the signing account");
    if(key.kind==="ssh")verifySSH(signed.payload,signed.signature,key.publicKey);
    else await verifyPGP(signed.payload,signed.signature,key.publicKey,signed.email);
    if(currentEmail&&!await currentEmail(key.owner.id,signed.email))throw Error("Committer email verification changed before verification completed");
    const receipt=transaction(()=>store.record(repository,sha,key,signed.email,objectDigest));
    return {verified:true,reason:null,receipt};
  }catch(error){return {verified:false,reason:(error as Error).message.replace(/[\r\n]/g," ").slice(0,256)};}
}
