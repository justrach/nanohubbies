import type { Owner } from "./types";
import type { TokenInfo } from "./tokens";

const initialized = new WeakMap<D1Database, Promise<unknown>>();
async function db(env: Env) {
  const d = env.AUTH_DB;
  if (!initialized.has(d)) {
    const ready = d.batch([
      d.prepare("CREATE TABLE IF NOT EXISTS git_token (id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, ownerId TEXT NOT NULL, ownerName TEXT NOT NULL, label TEXT NOT NULL, trunk TEXT NOT NULL, createdAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL, usedAt INTEGER, revokedAt INTEGER)"),
      d.prepare("CREATE INDEX IF NOT EXISTS git_token_owner ON git_token(ownerId, trunk)"),
    ]);
    initialized.set(d, ready); ready.catch(() => initialized.delete(d));
  }
  await initialized.get(d); return d;
}
async function hash(token: string) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map(b => b.toString(16).padStart(2,"0")).join("");
}
/** A normal Git client needs no registered agent. Tokens grant Git transport
 * only, stay scoped to one repository, and recheck membership on every request. */
export async function makeGitToken(env: Env, owner: Owner, trunk: string, label: string) {
  if (typeof label !== "string" || !label.trim() || label.length > 64 || /[\0\r\n]/.test(label)) throw Error("Give this Git token a name (up to 64 characters)");
  const token = "nhg_" + [...crypto.getRandomValues(new Uint8Array(24))].map(b=>b.toString(16).padStart(2,"0")).join("");
  const info = {id:crypto.randomUUID(),label:label.trim(),trunk,kind:"git" as const,createdAt:Date.now(),expiresAt:Date.now()+30*86_400_000,usedAt:null};
  await (await db(env)).prepare("INSERT INTO git_token(id,hash,ownerId,ownerName,label,trunk,createdAt,expiresAt) VALUES(?,?,?,?,?,?,?,?)").bind(info.id,await hash(token),owner.id,owner.name,info.label,trunk,info.createdAt,info.expiresAt).run();
  return {...info,token};
}
export async function listGitTokens(env: Env, owner: Owner, trunk?: string): Promise<TokenInfo[]> {
  return (await (await db(env)).prepare(`SELECT id,label,trunk,createdAt,expiresAt,usedAt,'git' AS kind FROM git_token WHERE ownerId=? AND revokedAt IS NULL AND expiresAt>?${trunk===undefined?"":" AND trunk=?"} ORDER BY createdAt DESC LIMIT 100`).bind(owner.id,Date.now(),...(trunk===undefined?[]:[trunk])).all<TokenInfo>()).results;
}
export async function revokeGitToken(env: Env, owner: Owner, id: string) {
  const result=await (await db(env)).prepare("UPDATE git_token SET revokedAt=? WHERE id=? AND ownerId=? AND revokedAt IS NULL").bind(Date.now(),id,owner.id).run();
  return (result.meta.changes??0)>0;
}
export async function gitCredential(env: Env, token: string, trunk: string) {
  const d=await db(env), row=await d.prepare("SELECT id,ownerId,ownerName,trunk FROM git_token WHERE hash=? AND revokedAt IS NULL AND expiresAt>?").bind(await hash(token),Date.now()).first<{id:string;ownerId:string;ownerName:string;trunk:string}>();
  if(!row||row.trunk!==trunk)return null;
  await d.prepare("UPDATE git_token SET usedAt=? WHERE id=?").bind(Date.now(),row.id).run();
  return {owner:{id:row.ownerId,name:row.ownerName},agent:null,credentialId:row.id,gitOnly:true as const};
}
