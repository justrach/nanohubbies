import {settings,type User} from "../auth";
import {abuseLimits,clientKey,creationBody,limited} from "../abuse";
import {canWrite,requireTeam,sameOrigin} from "../team/access";
import {TeamError} from "../team/provider";
import {archiveLocked} from "../repository/archive";
import {cliDatabase,cliHash,cliOwner,requestedScopes,cliScopeAllowed,type CliScope} from "./credentials";

const ALPHABET="ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 symbols; 40-bit user code.
const LIFETIME=600_000,RECOVERY=120_000;
export function normalizeCliCode(value:unknown) {
  if(typeof value!=="string")return null;
  const code=value.trim().toUpperCase().replace(/-/g,"");
  return /^[A-HJ-NP-Z2-9]{8}$/.test(code)?`${code.slice(0,4)}-${code.slice(4)}`:null;
}
export function cliSignInReturn(code:unknown) {const normalized=normalizeCliCode(code);return normalized?`/cli/authorize?code=${normalized}`:"/dashboard";}
interface Device {
  hash:string;userHash:string;origin:string;repository:string|null;trunkRequest:string|null;label:string;requestedScopes:string;requestedDays:number;
  createdAt:number;expiresAt:number;nextPollAt:number;interval:number;status:"pending"|"approved"|"denied"|"consumed";grantId:string;
  ownerId:string|null;owner:string|null;trunk:string|null;scopes:string|null;days:number|null;approvedAt:number|null;consumedAt:number|null;
}
const initialized=new WeakMap<D1Database,Promise<unknown>>();
async function db(env:Env) {
  const d=await cliDatabase(env);
  if(!initialized.has(d)) {
    const p=d.batch([
      d.prepare("CREATE TABLE IF NOT EXISTS cli_devices (hash TEXT PRIMARY KEY, userHash TEXT NOT NULL UNIQUE, origin TEXT NOT NULL, repository TEXT, trunkRequest TEXT, label TEXT NOT NULL, requestedScopes TEXT NOT NULL, requestedDays INTEGER NOT NULL, createdAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL, nextPollAt INTEGER NOT NULL, interval INTEGER NOT NULL, status TEXT NOT NULL, grantId TEXT NOT NULL UNIQUE, ownerId TEXT, owner TEXT, trunk TEXT, scopes TEXT, days INTEGER, approvedAt INTEGER, consumedAt INTEGER)"),
      d.prepare("CREATE INDEX IF NOT EXISTS cli_devices_expiry ON cli_devices(expiresAt)"),
    ]);initialized.set(d,p);p.catch(()=>initialized.delete(d));
  }
  await initialized.get(d);return d;
}
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"no-store"}});
const failure=(error:string,description:string,status=400,extra:Record<string,unknown>={})=>json({error,error_description:description,...extra},status);
function validFields(body:Record<string,unknown>,fields:string[]) {if(!body||Array.isArray(body)||typeof body!=="object"||Object.keys(body).some(k=>!fields.includes(k)))throw Error("Unknown device authorization field");}
async function deviceLimit(env:Env,request:Request,kind:string,count:number) {
  if(!abuseLimits(env,new URL(request.url)))return null;
  const guard=env.HUB.get(env.HUB.idFromName(`rate:cli-device:${kind}:${await clientKey(request)}`)),r=await guard.takeRate("control",count,60_000);
  return r.ok?null:limited("Too many CLI authorization attempts; wait before trying again",r.retryAfter);
}
async function repository(env:Env,request:Request,user:User,row:Device) {
  const hub=env.HUB.get(env.HUB.idFromName("hub"));
  const requested=row.repository?.split("/");
  const id=row.trunk??(requested?(await hub.resolveRepository(requested[0],requested[1]))?.id:row.trunkRequest);
  const unavailable=()=>new TeamError("Repository not found or access unavailable",404,"not_found");
  if(!id)throw unavailable();
  const headers=new Headers(request.headers);headers.delete("authorization");headers.delete("cookie");
  let access;
  try{access=await requireTeam(env,new Request(request.url,{headers}),id,user);}catch(error){if(error instanceof TeamError&&[403,404].includes(error.status))throw unavailable();throw error;}
  if(!access)throw unavailable();
  const address=await hub.repositoryAddress(id),archived=archiveLocked(await hub.repositoryArchive(id));
  const allowed=requestedScopes(JSON.parse(row.requestedScopes)).filter(scope=>cliScopeAllowed(scope,access.proof.role,!archived,access.binding.kind==='owner'));
  return {id,name:address?`${address.namespace}/${address.name}`:id,allowed,archived};
}

/** Native JSON device protocol, following RFC 8628 polling/consent semantics;
 * it is not a general OAuth authorization server or third-party client registry. */
export async function cliDeviceRoute(env:Env,request:Request,user:User|null,operation:string|undefined) {
  const url=new URL(request.url),method=request.method;
  if(url.protocol!=="https:"&&!(url.protocol==="http:"&&["localhost","127.0.0.1","[::1]"].includes(url.hostname)))return failure("invalid_request","Use HTTPS for CLI authorization");
  if(operation==="device"&&method==="POST") {
    const blocked=await deviceLimit(env,request,"create",6);if(blocked)return blocked;
    const body=await creationBody<Record<string,unknown>>(request,4096);validFields(body,["repository","trunk","label","scopes","days","client_origin"]);
    let verificationOrigin=url.origin;
    if(body.client_origin!==undefined&&body.client_origin!==url.origin) {
      // Next's local API proxy targets :8787 while the browser/CLI use :3000.
      // Only the explicitly configured loopback development frontend may differ;
      // public hosts cannot nominate another verification origin.
      let frontend:URL|null=null;try{frontend=new URL((env as Env&{APP_ORIGIN?:string}).APP_ORIGIN??"");}catch{/* No configured frontend. */}
      if(typeof body.client_origin!=="string"||!frontend||frontend.origin!==body.client_origin||frontend.protocol!=="http:"||!["localhost","127.0.0.1","[::1]"].includes(frontend.hostname)||!["localhost","127.0.0.1","[::1]"].includes(url.hostname)||!settings(env,url).dev)return failure("invalid_request","CLI verification must stay on the selected host");
      verificationOrigin=frontend.origin;
    }
    if(!!body.repository===!!body.trunk||body.repository!==undefined&&(typeof body.repository!=="string"||!/^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9][a-z0-9._-]{0,99}$/.test(body.repository))||body.trunk!==undefined&&(typeof body.trunk!=="string"||!/^[a-z0-9][a-z0-9-]{0,62}$/.test(body.trunk)))return failure("invalid_request","Choose one owner/repository or workspace ID");
    const scopes=requestedScopes(body.scopes??["read"]),label=body.label??"Nanohub CLI",days=body.days??7;
    if(typeof label!=="string"||!label.trim()||label.length>64||/[\x00-\x1f\x7f]/.test(label)||!Number.isInteger(days)||Number(days)<1||Number(days)>30)return failure("invalid_request","Choose a CLI name and 1–30 day expiry");
    const d=await db(env),now=Date.now();
    await d.prepare("DELETE FROM cli_devices WHERE hash IN (SELECT hash FROM cli_devices WHERE expiresAt<? LIMIT 100)").bind(now-RECOVERY).run();
    // Syntax only: anonymous creation must not disclose private repo existence.
    for(let attempt=0;attempt<3;attempt++) {
      const deviceCode="nhd_"+Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,"0")).join("");
      const letters=Array.from(crypto.getRandomValues(new Uint8Array(8)),b=>ALPHABET[b%32]).join(""),userCode=`${letters.slice(0,4)}-${letters.slice(4)}`;
      try {
        await d.prepare("INSERT INTO cli_devices(hash,userHash,origin,repository,trunkRequest,label,requestedScopes,requestedDays,createdAt,expiresAt,nextPollAt,interval,status,grantId) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(await cliHash(deviceCode),await cliHash(userCode),url.origin,body.repository??null,body.trunk??null,label.trim(),JSON.stringify(scopes),days,now,now+LIFETIME,now,5,"pending",crypto.randomUUID()).run();
      }catch(error){if(attempt<2&&/unique|constraint/i.test(String(error)))continue;throw error;}
      return json({device_code:deviceCode,user_code:userCode,verification_uri:`${verificationOrigin}/cli/authorize`,verification_uri_complete:`${verificationOrigin}/cli/authorize?code=${userCode}`,expires_in:LIFETIME/1000,interval:5});
    }
  }
  if(operation==="token"&&method==="POST") {
    const body=await creationBody<Record<string,unknown>>(request,1024);validFields(body,["device_code"]);
    if(typeof body.device_code!=="string"||!/^nhd_[a-f0-9]{64}$/.test(body.device_code))return failure("invalid_grant","Invalid device code");
    const d=await db(env),hash=await cliHash(body.device_code),now=Date.now();
    let row=await d.prepare("SELECT * FROM cli_devices WHERE hash=? AND origin=?").bind(hash,url.origin).first<Device>();
    if(!row)return failure("invalid_grant","Invalid device code");
    if(row.expiresAt<=now)return failure("expired_token","CLI authorization expired; start a new login");
    if(row.status==="denied")return failure("access_denied","CLI authorization was denied");
    if(row.status!=="consumed") {
      const claim=await d.prepare("UPDATE cli_devices SET nextPollAt=?+interval*1000 WHERE hash=? AND nextPollAt<=? AND status IN ('pending','approved') RETURNING *").bind(now,hash,now).first<Device>();
      if(!claim) {
        row=await d.prepare("SELECT * FROM cli_devices WHERE hash=?").bind(hash).first<Device>();
        if(row?.status!=="consumed"&&row?.status!=="denied") {
          const next=await d.prepare("UPDATE cli_devices SET interval=interval+5,nextPollAt=?+(interval+5)*1000 WHERE hash=? AND status IN ('pending','approved') RETURNING interval").bind(now,hash).first<{interval:number}>();
          if(next)return failure("slow_down","Wait longer before polling again",400,{interval:next.interval});
          row=await d.prepare("SELECT * FROM cli_devices WHERE hash=?").bind(hash).first<Device>();
        }
      }else row=claim;
    }
    if(!row||row.status==="denied")return failure("access_denied","CLI authorization was denied");
    if(row.status==="pending")return failure("authorization_pending","Confirm this request in your browser",400,{interval:row.interval});
    if(row.status==="consumed"&&(!row.consumedAt||now-row.consumedAt>RECOVERY))return failure("invalid_grant","This device code has already been used");
    if(!row.owner||!row.ownerId||!row.trunk||!row.scopes||!row.days)return failure("invalid_grant","Invalid authorization state");
    const owner=JSON.parse(row.owner) as User,scopes=requestedScopes(JSON.parse(row.scopes));
    const deny=async(message:string)=>{await d.prepare("UPDATE cli_devices SET status='denied' WHERE hash=? AND status='approved'").bind(hash).run();return failure("access_denied",message);};
    let target;
    try{target=await repository(env,request,owner,row);}catch(error){if(error instanceof TeamError&&[403,404].includes(error.status))return deny("Repository access changed; start a new login");throw error;}
    if(scopes.some(s=>!target.allowed.includes(s)))return deny("Repository permissions changed; start a new login");
    // Stable derivation recovers a lost token response without plaintext at rest.
    // The 256-bit device secret never appears in browser URLs or DB records.
    const token="nhc_"+await cliHash(`nanohub-cli-device-v1\0${body.device_code}\0${row.grantId}`),tokenHash=await cliHash(token);
    await d.batch([
      d.prepare("INSERT INTO cli_credentials(id,hash,ownerId,owner,label,trunk,origin,scopes,createdAt,expiresAt) SELECT grantId,?,ownerId,owner,label,trunk,origin,scopes,approvedAt,approvedAt+days*86400000 FROM cli_devices WHERE hash=? AND status='approved' AND expiresAt>? AND (SELECT COUNT(*) FROM cli_credentials WHERE ownerId=? AND revokedAt IS NULL AND expiresAt>?)<100 ON CONFLICT(id) DO NOTHING").bind(tokenHash,hash,now,row.ownerId,now),
      d.prepare("UPDATE cli_devices SET status='consumed',consumedAt=? WHERE hash=? AND status='approved' AND EXISTS (SELECT 1 FROM cli_credentials WHERE id=cli_devices.grantId)").bind(now,hash),
    ]);
    const credential=await d.prepare("SELECT id,scopes,expiresAt FROM cli_credentials WHERE id=? AND hash=? AND revokedAt IS NULL AND expiresAt>?").bind(row.grantId,tokenHash,now).first<{id:string;scopes:string;expiresAt:number}>();
    if(!credential)return deny("CLI credential is revoked, expired or the active credential limit was reached");
    return json({access_token:token,token_type:"Bearer",scope:JSON.parse(credential.scopes).join(" "),expires_in:Math.max(0,Math.floor((credential.expiresAt-now)/1000)),credential_id:credential.id});
  }
  if(operation==="authorize") {
    if(!user||user.cli||request.headers.has("authorization"))return failure("sign_in_required","Sign in to confirm a CLI request",401);
    const blocked=await deviceLimit(env,request,"user-code",10);if(blocked)return blocked;
    const body=method==="POST"?await creationBody<Record<string,unknown>>(request,2048):null;
    if(body)validFields(body,["userCode","decision","scopes","days","codeConfirmed"]);
    const code=normalizeCliCode(body?.userCode??url.searchParams.get("code"));
    if(!code)return failure("invalid_request","Enter the eight-character code shown in your terminal");
    const d=await db(env),row=await d.prepare("SELECT * FROM cli_devices WHERE userHash=? AND origin=?").bind(await cliHash(code),url.origin).first<Device>();
    if(!row||row.expiresAt<=Date.now())return failure("expired_token","Code not found or expired; start a new CLI login",404);
    if(row.status!=="pending"&&row.ownerId!==user.id)return failure("invalid_request","Code not found or no longer available",404);
    const target=await repository(env,request,user,row);
    if(method==="GET")return json({userCode:code,label:row.label,repository:target.name,trunk:target.id,requestedScopes:JSON.parse(row.requestedScopes),allowedScopes:target.allowed,maxDays:row.requestedDays,expiresAt:row.expiresAt,status:row.status,archived:target.archived,account:{id:user.id,name:user.name}});
    if(method!=="POST")return failure("invalid_request","Use GET or POST",405);
    if(!sameOrigin(env,request))return failure("invalid_request","Same-origin request required",403);
    if(body?.decision!=="approve"&&body?.decision!=="deny")return failure("invalid_request","Approve or deny this request");
    if(row.status!=="pending") {
      if(body.decision==="deny"&&row.status==="denied")return json({status:"denied"});
      if(body.decision==="approve"&&["approved","consumed"].includes(row.status)&&JSON.stringify(requestedScopes(body.scopes))===row.scopes&&body.days===row.days&&body.codeConfirmed===true)return json({status:row.status});
      return failure("invalid_request","This authorization has already been decided",409);
    }
    if(body.decision==="deny") {
      const changed=await d.prepare("UPDATE cli_devices SET status='denied',ownerId=? WHERE hash=? AND status='pending'").bind(user.id,row.hash).run();
      return changed.meta.changes?json({status:"denied"}):failure("invalid_request","This request changed; reload before deciding",409);
    }
    const scopes=requestedScopes(body.scopes),days=body.days;
    if(body.codeConfirmed!==true)return failure("invalid_request","Confirm the code matches your terminal");
    if(scopes.some(s=>!target.allowed.includes(s))||!Number.isInteger(days)||Number(days)<1||Number(days)>row.requestedDays)return failure("invalid_request","Permissions or expiry exceed the request or your current access",403);
    const changed=await d.prepare("UPDATE cli_devices SET status='approved',ownerId=?,owner=?,trunk=?,scopes=?,days=?,approvedAt=? WHERE hash=? AND status='pending' AND expiresAt>?").bind(user.id,cliOwner(user),target.id,JSON.stringify(scopes),days,Date.now(),row.hash,Date.now()).run();
    return changed.meta.changes?json({status:"approved"}):failure("invalid_request","This request changed; reload before deciding",409);
  }
  return failure("invalid_request","Device operation not found",404);
}
