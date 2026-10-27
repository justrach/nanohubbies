import {createHash,createPublicKey,verify,type KeyObject} from "node:crypto";
import type { ParsedSigningKey } from "./types";

class Wire {
  at=0;
  constructor(readonly data:Buffer){}
  uint(){if(this.at+4>this.data.length)throw Error("Truncated SSH encoding");const n=this.data.readUInt32BE(this.at);this.at+=4;return n;}
  bytes(){const n=this.uint();if(n>64*1024||this.at+n>this.data.length)throw Error("Invalid SSH string length");const b=this.data.subarray(this.at,this.at+n);this.at+=n;return b;}
  text(){const b=this.bytes();if(b.some(n=>n<32||n>126))throw Error("Invalid SSH identifier");return b.toString("ascii");}
  end(){if(this.at!==this.data.length)throw Error("Trailing SSH data");}
}
const packed=(value:Uint8Array|string)=>{const data=Buffer.from(value),size=Buffer.alloc(4);size.writeUInt32BE(data.length);return Buffer.concat([size,data]);};
const b64=(value:string)=>{if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)||!value.length)throw Error("Invalid SSH base64");return Buffer.from(value,"base64");};
const unsigned=(b:Buffer)=>{if(!b.length||(b[0]&128)||b.length>1&&b[0]===0&&!(b[1]&128))throw Error("Invalid SSH positive integer");return b[0]===0?b.subarray(1):b;};

function publicKey(blob:Buffer):{key:KeyObject;algorithm:string;size?:number} {
  const wire=new Wire(blob),algorithm=wire.text();let key:KeyObject,size:number|undefined;
  if(algorithm==="ssh-ed25519") {
    const x=wire.bytes();if(x.length!==32)throw Error("Invalid Ed25519 public key");
    key=createPublicKey({key:{kty:"OKP",crv:"Ed25519",x:x.toString("base64url")},format:"jwk"});
  }else if(algorithm==="ssh-rsa") {
    const e=unsigned(wire.bytes()),n=unsigned(wire.bytes());
    if(n.length<256||n.length>1024||e.length>8)throw Error("SSH RSA keys must use 2048–8192 bits");
    key=createPublicKey({key:{kty:"RSA",e:e.toString("base64url"),n:n.toString("base64url")},format:"jwk"});
    const bits=key.asymmetricKeyDetails?.modulusLength;if(!bits||bits<2048||bits>8192)throw Error("SSH RSA keys must use 2048–8192 bits");
  }else if(algorithm.startsWith("ecdsa-sha2-")) {
    const curve=wire.text(),curves:Record<string,[string,number]>={nistp256:["P-256",32],nistp384:["P-384",48],nistp521:["P-521",66]},got=curves[curve];
    if(!got||algorithm!==`ecdsa-sha2-${curve}`)throw Error("Unsupported SSH ECDSA curve");
    const point=wire.bytes();size=got[1];if(point.length!==1+2*size||point[0]!==4)throw Error("Invalid SSH ECDSA point");
    key=createPublicKey({key:{kty:"EC",crv:got[0],x:point.subarray(1,1+size).toString("base64url"),y:point.subarray(1+size).toString("base64url")},format:"jwk"});
  }else throw Error(`Unsupported SSH signing algorithm: ${algorithm}`);
  wire.end();return {key,algorithm,size};
}
export function sshKey(text:string):ParsedSigningKey {
  if(text.length>16*1024||/[\r\n\0]/.test(text.trim()))throw Error("Provide one OpenSSH public key line");
  const match=/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)) ([A-Za-z0-9+/=]+)(?: [^\r\n]*)?$/.exec(text.trim());
  if(!match)throw Error("Use an Ed25519, RSA or NIST ECDSA public signing key");
  const blob=b64(match[2]),parsed=publicKey(blob);if(parsed.algorithm!==match[1])throw Error("SSH key type does not match its contents");
  const digest=createHash("sha256").update(blob).digest();
  return {id:`ssh:${digest.toString("hex")}`,kind:"ssh",fingerprint:`SHA256:${digest.toString("base64").replace(/=+$/,"")}`,publicKey:`${parsed.algorithm} ${blob.toString("base64")}`,aliases:[`ssh:${digest.toString("hex")}`]};
}
function signature(armor:string) {
  const match=/^-----BEGIN SSH SIGNATURE-----\n([A-Za-z0-9+/=\n]+)\n-----END SSH SIGNATURE-----\n?$/.exec(armor);
  if(!match||armor.length>64*1024)throw Error("Malformed SSH signature armor");
  const blob=b64(match[1].replace(/\n/g,""));if(blob.subarray(0,6).toString("ascii")!=="SSHSIG")throw Error("Invalid SSH signature magic");
  const wire=new Wire(blob);wire.at=6;if(wire.uint()!==1)throw Error("Unsupported SSH signature version");
  const key=wire.bytes(),namespace=wire.text(),reserved=wire.bytes(),hash=wire.text(),sig=wire.bytes();wire.end();
  if(namespace!=="git")throw Error("SSH signature namespace must be git");
  if(!["sha256","sha512"].includes(hash))throw Error("Unsupported SSH signature hash");
  const parsed=publicKey(key),signed=new Wire(sig),algorithm=signed.text(),value=signed.bytes();signed.end();
  return {blob:key,namespace,reserved,hash,signatureAlgorithm:algorithm,value,key:parsed.key,keyAlgorithm:parsed.algorithm,size:parsed.size};
}
export function sshSignatureAlias(armor:string) {return `ssh:${createHash("sha256").update(signature(armor).blob).digest("hex")}`;}
export function verifySSH(payload:Uint8Array,armor:string,enrolled:string) {
  const sig=signature(armor),key=sshKey(enrolled);
  if(key.id!==`ssh:${createHash("sha256").update(sig.blob).digest("hex")}`)throw Error("SSH signature key does not match the enrolled key");
  const data=Buffer.concat([Buffer.from("SSHSIG"),packed(sig.namespace),packed(sig.reserved),packed(sig.hash),packed(createHash(sig.hash).update(payload).digest())]);
  let valid=false;
  if(sig.signatureAlgorithm==="ssh-ed25519"&&sig.keyAlgorithm==="ssh-ed25519")valid=sig.value.length===64&&verify(null,data,sig.key,sig.value);
  else if(["rsa-sha2-256","rsa-sha2-512"].includes(sig.signatureAlgorithm)&&sig.keyAlgorithm==="ssh-rsa")valid=verify(sig.signatureAlgorithm==="rsa-sha2-256"?"sha256":"sha512",data,sig.key,sig.value);
  else if(sig.signatureAlgorithm===sig.keyAlgorithm&&sig.size) {
    const pair=new Wire(sig.value),r=unsigned(pair.bytes()),s=unsigned(pair.bytes());pair.end();
    if(r.length>sig.size||s.length>sig.size)throw Error("Invalid SSH ECDSA signature length");
    const integer=(value:Buffer)=>{const bytes=value[0]&128?Buffer.concat([Buffer.from([0]),value]):value;return Buffer.concat([Buffer.from([2,bytes.length]),bytes]);};
    const pairBytes=Buffer.concat([integer(r),integer(s)]),der=Buffer.concat([Buffer.from(pairBytes.length<128?[48,pairBytes.length]:[48,129,pairBytes.length]),pairBytes]);
    const hash=sig.size===32?"sha256":sig.size===48?"sha384":"sha512";
    valid=verify(hash,data,sig.key,der);
  }
  if(!valid)throw Error("SSH signature does not verify");
}
