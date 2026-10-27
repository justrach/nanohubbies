import type { SignedPayload } from "./types";

/** Remove only the folded gpgsig header. The signed bytes stay byte-for-byte
 * intact, including message encoding, mergetag folds and final newlines. */
export function signedPayload(raw:Uint8Array):SignedPayload {
  if(raw.length>256*1024)throw Error("Signed commit exceeds 256 KiB verification limit");
  const bytes=Buffer.from(raw),split=bytes.indexOf(Buffer.from("\n\n"));
  if(split<0)throw Error("Commit header is incomplete");
  const lines=bytes.subarray(0,split+1).toString("latin1").split("\n");lines.pop();
  const kept:string[]=[],signature:string[]=[],committers:string[]=[];let folded="",count=0;
  for(const line of lines) {
    if(line.startsWith(" ")) {
      if(!folded)throw Error("Invalid folded commit header");
      if(folded==="gpgsig")signature.push(line.slice(1));else kept.push(line);
      continue;
    }
    const space=line.indexOf(" ");if(space<1)throw Error("Malformed commit header");
    folded=line.slice(0,space);
    if(folded==="gpgsig") {if(++count>1)throw Error("Multiple commit signatures are not supported");signature.push(line.slice(space+1));}
    else {kept.push(line);if(folded==="committer")committers.push(line.slice(space+1));}
  }
  if(!count)throw Error("Commit is unsigned");
  const email=committers.length===1?/^[^<>\r\n]* <([^<>\s\r\n]+)> -?\d+ [+-]\d{4}$/.exec(committers[0])?.[1]:null;
  if(!email)throw Error("Committer email cannot be verified");
  const armor=signature.join("\n");
  if(armor.length>64*1024)throw Error("Commit signature exceeds 64 KiB");
  const kind=armor.startsWith("-----BEGIN SSH SIGNATURE-----\n")?"ssh":armor.startsWith("-----BEGIN PGP SIGNATURE-----\n")?"pgp":null;
  if(!kind)throw Error("Unsupported commit signature format");
  return {payload:Buffer.concat([Buffer.from(kept.join("\n")+"\n\n","latin1"),bytes.subarray(split+2)]),signature:armor,email,kind};
}
