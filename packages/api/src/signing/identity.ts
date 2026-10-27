import {createHash} from "node:crypto";
import type {User} from "../auth";

export const accountSigningEmail=(id:string)=>`${createHash("sha256").update(id).digest("hex").slice(0,32)}@users.noreply.nanohub.sh`;
/** A signed legacy session must not keep an email verified after account data
 * changes. Noreply identity is stable; other addresses use current auth data. */
export async function currentSigningEmail(env:Env,account:string,email:string) {
  if(email.toLowerCase()===accountSigningEmail(account))return true;
  if(!account.startsWith("codegraff:"))return false;
  try {
    const user=await env.AUTH_DB.prepare('SELECT email,"emailVerified" FROM "user" WHERE id = ?').bind(account.slice(10)).first<{email:string;emailVerified:number}>();
    return !!user&&user.emailVerified===1&&user.email.toLowerCase()===email.toLowerCase();
  }catch{return false;}
}
export function signingEmails(user:User) {
  const signingEmail=accountSigningEmail(user.id);
  return {signingEmail,emails:[...new Set([signingEmail,...(user.emailVerified&&user.email?[user.email.toLowerCase()]:[])])]};
}
