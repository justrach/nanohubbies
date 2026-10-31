import type {User} from "../auth";

export const cliScopes=["read","contents:read","contents:write","pulls:write","reviews:write","pulls:merge","protections:write","rulesets:write","repository:archive","repository:default","repository:merge","environments:write","runners:write","collaborators:write","deployments:write","deployments:review","secrets:read","secrets:write","secrets:grant","branches:write"] as const;
export type CliScope=typeof cliScopes[number];
export const cliScopeWrites=(scope:CliScope)=>!["read","contents:read","secrets:read"].includes(scope);
export const cliScopeNeedsWriter=(scope:CliScope)=>cliScopeWrites(scope)&&scope!=="deployments:review"&&scope!=='reviews:write';
export const cliAdminScope=(scope:CliScope)=>["protections:write","rulesets:write","repository:archive","repository:default","repository:merge","environments:write","collaborators:write","secrets:read","secrets:write","secrets:grant"].includes(scope);
export const cliOwnerScope=(scope:CliScope)=>scope==='runners:write';
/** Lifecycle control remains delegable while archived, so an admin can reopen.
 * This exception grants neither content writes nor other settings access. */
export const cliScopeAllowed=(scope:CliScope,role:string,writable:boolean,independent=true)=>{
  if(scope==='collaborators:write'&&!independent||cliAdminScope(scope)&&!["owner","admin"].includes(role)||cliOwnerScope(scope)&&role!=='owner')return false;
  if(scope==='repository:archive'||scope==='secrets:grant')return true;
  return !cliScopeWrites(scope)||writable&&(['deployments:review','reviews:write'].includes(scope)?['owner','admin','writer','reader','member'].includes(role):role!=="reader");
};
export interface CliCredential {id:string;label:string;trunk:string;origin:string;scopes:CliScope[];createdAt:number;expiresAt:number;usedAt:number|null}
interface Stored extends Omit<CliCredential,"scopes"> {owner:string;scopes:string}
const ready=new WeakMap<D1Database,Promise<unknown>>();
export async function cliDatabase(env:Env) {
  const d=env.AUTH_DB;
  if(!ready.has(d)) {
    const p=d.batch([
      d.prepare("CREATE TABLE IF NOT EXISTS cli_credentials (id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, ownerId TEXT NOT NULL, owner TEXT NOT NULL, label TEXT NOT NULL, trunk TEXT NOT NULL, origin TEXT NOT NULL, scopes TEXT NOT NULL, createdAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL, usedAt INTEGER, revokedAt INTEGER)"),
      d.prepare("CREATE INDEX IF NOT EXISTS cli_credentials_owner ON cli_credentials(ownerId,trunk)"),
    ]);ready.set(d,p);p.catch(()=>ready.delete(d));
  }
  await ready.get(d);return d;
}
export async function cliHash(token:string) {return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,"0")).join("");}
const database=cliDatabase,hash=cliHash;
export const cliOwner=(user:User)=>JSON.stringify({id:user.id,name:user.name,email:null,provider:user.provider});
export function requestedScopes(value:unknown):CliScope[] {
  if(!Array.isArray(value)||!value.length||value.length>cliScopes.length||new Set(value).size!==value.length||value.some(s=>!cliScopes.includes(s))||!value.includes("read"))throw Error("Choose read access and valid CLI permissions");
  if(value.includes("contents:write")&&!value.includes("contents:read"))throw Error("Git push permission also requires clone/fetch permission");
  if(value.some(scope=>scope==='secrets:write'||scope==='secrets:grant')&&!value.includes('secrets:read'))throw Error('Secret reference and grant permissions also require secrets:read');
  return cliScopes.filter(s=>value.includes(s));
}
export async function makeCliCredential(env:Env,user:User,trunk:string,origin:string,label:unknown,scopes:unknown,days:unknown) {
  if(typeof label!=="string"||!label.trim()||label.length>64||/[\x00-\x1f\x7f]/.test(label))throw Error("Give this CLI credential a name of up to 64 characters");
  if(!Number.isInteger(days)||Number(days)<1||Number(days)>30)throw Error("Choose an expiry between 1 and 30 days");
  const permissions=requestedScopes(scopes),d=await database(env);
  const active=await d.prepare("SELECT COUNT(*) AS n FROM cli_credentials WHERE ownerId=? AND revokedAt IS NULL AND expiresAt>?").bind(user.id,Date.now()).first<{n:number}>();
  if((active?.n??0)>=100)throw Error("Revoke an existing CLI credential before creating another");
  const token="nhc_"+Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,"0")).join("");
  const info:CliCredential={id:crypto.randomUUID(),label:label.trim(),trunk,origin,scopes:permissions,createdAt:Date.now(),expiresAt:Date.now()+Number(days)*86400000,usedAt:null};
  // Store only the hash and minimal stable account identity, never a session.
  await d.prepare("INSERT INTO cli_credentials(id,hash,ownerId,owner,label,trunk,origin,scopes,createdAt,expiresAt) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(info.id,await hash(token),user.id,cliOwner(user),info.label,trunk,origin,JSON.stringify(permissions),info.createdAt,info.expiresAt).run();
  return {...info,token};
}
export async function listCliCredentials(env:Env,ownerId:string,trunk?:string) {
  const rows=await (await database(env)).prepare(`SELECT id,label,trunk,origin,scopes,createdAt,expiresAt,usedAt FROM cli_credentials WHERE ownerId=? AND revokedAt IS NULL AND expiresAt>?${trunk?" AND trunk=?":""} ORDER BY createdAt DESC LIMIT 100`).bind(ownerId,Date.now(),...(trunk?[trunk]:[])).all<Omit<CliCredential,"scopes">&{scopes:string}>();
  return rows.results.map(r=>({...r,scopes:JSON.parse(r.scopes) as CliScope[]}));
}
export async function revokeCliCredential(env:Env,ownerId:string,id:string) {
  const r=await (await database(env)).prepare("UPDATE cli_credentials SET revokedAt=? WHERE id=? AND ownerId=? AND revokedAt IS NULL").bind(Date.now(),id,ownerId).run();return (r.meta.changes??0)>0;
}
/** Final delegated writers re-read the current grant after membership lookups.
 * The ID is attribution, never an externally accepted bearer credential. */
export async function currentCliGrant(env:Env,id:string,ownerId:string,trunk:string,origin:string,scope:CliScope) {
  const d=await database(env),row=await d.prepare('SELECT scopes,expiresAt FROM cli_credentials WHERE id=? AND ownerId=? AND trunk=? AND origin=? AND revokedAt IS NULL AND expiresAt>?').bind(id,ownerId,trunk,origin,Date.now()).first<{scopes:string;expiresAt:number}>();
  if(!row)return null;
  try{const scopes=JSON.parse(row.scopes);return Array.isArray(scopes)&&scopes.includes('read')&&scopes.includes(scope)?{expiresAt:row.expiresAt}:null;}catch{return null;}
}
export async function cliCredential(env:Env,request:Request) {
  const token=/^Bearer (nhc_[a-f0-9]{64})$/i.exec(request.headers.get("authorization")??"")?.[1];
  if(!token)return null;
  return lookupCliCredential(env,token,new URL(request.url).origin);
}
async function lookupCliCredential(env:Env,token:string,origin:string) {
  if(!/^nhc_[a-f0-9]{64}$/.test(token))return null;
  const d=await database(env),row=await d.prepare("SELECT id,owner,label,trunk,origin,scopes,createdAt,expiresAt,usedAt FROM cli_credentials WHERE hash=? AND origin=? AND revokedAt IS NULL AND expiresAt>?").bind(await hash(token),origin,Date.now()).first<Stored>();
  if(!row)return null;
  await d.prepare("UPDATE cli_credentials SET usedAt=? WHERE id=? AND revokedAt IS NULL").bind(Date.now(),row.id).run();
  const {owner,...info}=row,scopes=JSON.parse(row.scopes) as CliScope[];
  return {info:{...info,scopes},user:{...JSON.parse(owner),cli:{credentialId:row.id,scopes}} as User};
}
/** Explicit new content scopes only. Older CLI credentials gain no Git access.
 * Git authentication carries account identity but never browser bypass rights. */
export async function cliGitCredential(env:Env,request:Request,token:string,trunk:string) {
  const url=new URL(request.url);if(!url.pathname.startsWith("/git/"))return null;
  const credential=await lookupCliCredential(env,token,url.origin);
  if(!credential||credential.info.trunk!==trunk||!credential.info.scopes.includes("contents:read"))return null;
  return {owner:{id:credential.user.id,name:credential.user.name},agent:null,credentialId:credential.info.id,gitOnly:true as const,readOnly:!credential.info.scopes.includes("contents:write")};
}
