import {createMessage,readKey,readSignature,verify} from "openpgp";
import type {ParsedSigningKey} from "./types";

async function matchingUser(key:Awaited<ReturnType<typeof readKey>>,email:string,date:Date) {
  for(const user of key.users){const actual=user.userID?.email;if(actual?.toLowerCase()===email.toLowerCase())try{await key.getPrimaryUser(date,{email:actual});return actual;}catch{/* Another certified user ID may match. */}}
  throw Error("OpenPGP key has no valid user ID matching the signing email");
}

export async function pgpKey(text:string,emails:string[],date=new Date()):Promise<ParsedSigningKey> {
  if(text.length>64*1024||!text.trim().startsWith("-----BEGIN PGP PUBLIC KEY BLOCK-----"))throw Error("Provide an armored OpenPGP public key");
  const key=await readKey({armoredKey:text});if(key.isPrivate())throw Error("Private signing keys must stay on your computer");
  if(key.getKeys().some(part=>(part.getAlgorithmInfo().bits??0)>8192))throw Error("OpenPGP keys larger than 8192 bits exceed the verification limit");
  await key.getSigningKey(undefined,date);
  let matched=false;
  for(const email of emails)try{await matchingUser(key,email,date);matched=true;break;}catch{/* Another verified account email may match. */}
  if(!matched)throw Error("OpenPGP key needs a valid user ID matching a verified account or Nanohub signing email");
  const fingerprint=key.getFingerprint().toLowerCase();
  return {id:`pgp:${fingerprint}`,kind:"pgp",fingerprint: key.getFingerprint().toUpperCase(),publicKey:key.armor(),aliases:[...new Set(key.getKeys().map(k=>`pgp:${k.getKeyID().toHex().toLowerCase()}`))]};
}
export async function pgpSignatureAliases(armor:string) {
  if(armor.length>64*1024)throw Error("OpenPGP signature exceeds 64 KiB");
  const signature=await readSignature({armoredSignature:armor}),ids=signature.getSigningKeyIDs();
  if(ids.length!==1)throw Error("Exactly one OpenPGP commit signature is required");
  return [`pgp:${ids[0].toHex().toLowerCase()}`];
}
export async function verifyPGP(payload:Uint8Array,armor:string,enrolled:string,email:string,date=new Date()) {
  const key=await readKey({armoredKey:enrolled}),certifiedEmail=await matchingUser(key,email,date);
  const signature=await readSignature({armoredSignature:armor});
  const issuers=signature.getSigningKeyIDs();if(issuers.length!==1)throw Error("Exactly one OpenPGP commit signature is required");
  // Do not let a backdated signature revive an expired/revoked signing subkey.
  await key.getSigningKey(issuers[0],date,{email:certifiedEmail});
  const result=await verify({message:await createMessage({binary:payload}),signature,verificationKeys:key,date,format:"binary"});
  if(result.signatures.length!==1)throw Error("Exactly one OpenPGP commit signature is required");
  await result.signatures[0].verified;
}
