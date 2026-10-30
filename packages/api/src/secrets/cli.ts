import {RpcTarget} from 'cloudflare:workers';
import {creationBody} from '../abuse';
import type {User} from '../auth';
import {currentCliGrant,type CliScope} from '../cli/credentials';
import {canAdmin,requireTeam,sameOrigin,type TeamAccess} from '../team/access';
import type {VaultService,Scope} from '../../../vault/src/index';
import type {VaultEdit} from '../../../vault/src/administration';
import {digest,validName} from '../../../vault/src/provider';
import {archiveLocked} from '../repository/archive';
const headers={'Cache-Control':'private, no-store'};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers});
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);

/** Only this short-lived private RPC object, never request JSON, can authorize
 * the final Vault mutation. It rechecks role and the original D1 delegation
 * after the gateway and any queued service calls. No bearer crosses into Vault. */
class CliVaultAuthority extends RpcTarget {
  #used=false;
  #env:Env;#user:User;#trunk:string;#origin:string;#permission:CliScope;#writable:boolean;#grantExpiry?:number;#delegationExpiresAt=0;
  constructor(env:Env,user:User,trunk:string,origin:string,permission:CliScope,writable:boolean,grantExpiry?:number){super();this.#env=env;this.#user=user;this.#trunk=trunk;this.#origin=origin;this.#permission=permission;this.#writable=writable;this.#grantExpiry=grantExpiry;}
  get delegationExpiresAt(){return this.#delegationExpiresAt;}
  async authorize(){
    if(this.#used)throw Error('Vault authorization has already been consumed');this.#used=true;
    let access:TeamAccess|null;
    try{access=await requireTeam(this.#env,new Request(this.#origin+'/api/trunks/'+this.#trunk),this.#trunk,this.#user);}catch{throw Error('Current repository admin access required');}
    if(!access||!canAdmin(access)||access.proof.agentId)throw Error('Current repository admin access required');
    if(this.#writable)await this.#env.HUB.get(this.#env.HUB.idFromName('hub')).assertRepositoryWritable(this.#trunk);
    const grant=await currentCliGrant(this.#env,this.#user.cli!.credentialId,this.#user.id,this.#trunk,this.#origin,this.#permission);
    if(!grant)throw Error('CLI secret delegation expired or was revoked');
    if(this.#grantExpiry!==undefined&&this.#grantExpiry>grant.expiresAt)throw Error('Workload grant cannot outlive the issuing CLI delegation');
    this.#delegationExpiresAt=grant.expiresAt;
    return Math.min(Date.now()+5000,grant.expiresAt);
  }
}

export async function cliSecrets(env:Env,request:Request,trunk:string,user:User,access:TeamAccess|null){
  if(!user.cli||request.headers.has('authorization')||!access||!canAdmin(access)||access.proof.agentId)return json({error:'Current repository admin access and explicit secret permissions required'},403);
  const url=new URL(request.url),parts=url.pathname.split('/').slice(5),method=request.method,environment=url.searchParams.get('environment')??'staging';
  if([...url.searchParams.keys()].some(key=>key!=='environment')||url.searchParams.getAll('environment').length>1||!/^[a-z][a-z0-9-]{0,31}$/.test(environment))return json({error:'Use one valid secret environment'},400);
  const listing=method==='GET'&&!parts.length,connect=method==='PUT'&&parts.length===1&&validName(parts[0]),disconnect=method==='DELETE'&&parts.length===1&&validName(parts[0]),grant=method==='POST'&&parts.length===1&&parts[0]==='grants',revoke=method==='DELETE'&&parts.length===2&&parts[0]==='grants'&&uuid(parts[1]);
  if(!listing&&!connect&&!disconnect&&!grant&&!revoke)return json({error:'Unknown secret administration operation'},404);
  const permission:CliScope=listing?'secrets:read':grant||revoke?'secrets:grant':'secrets:write';
  if(!user.cli.scopes.includes(permission)||!user.cli.scopes.includes('secrets:read'))return json({error:`CLI credential requires secrets:read and ${permission}`},403);
  if(!listing&&!sameOrigin(env,request))return json({error:'Same-origin request required'},403);
  const vault=(env as unknown as {VAULT?:Pick<VaultService,'list'|'administer'>}).VAULT;if(!vault)return json({error:'The separate vault service is not configured'},503);
  const scope:Scope={repository:trunk,environment,actor:user.id},authority=new CliVaultAuthority(env,user,trunk,url.origin,permission,!listing&&!revoke);
  try{
    if(listing){
      const data=await vault.list(scope);
      try{const readOnly=archiveLocked(await env.HUB.get(env.HUB.idFromName('hub')).repositoryArchive(trunk));await authority.authorize();if(data.conditionalWrites!==true||data.clientGrants!=='v1'||data.revisionTracking!=='storage')return json({error:'Secret administration is updating; inspect secret list again shortly'},503);return Response.json({...data,serverTime:Date.now(),readOnly,repositoryId:trunk,delegationId:user.cli.credentialId,delegationExpiresAt:authority.delegationExpiresAt},{headers:{...headers,ETag:`"secrets-${data.revision}"`}});}
      finally{(data as unknown as {[Symbol.dispose]?:()=>void})[Symbol.dispose]?.();}
    }
    const body=await creationBody<Record<string,unknown>>(request,32768),common={credentialId:user.cli.credentialId};
    if(!body||typeof body!=='object'||Array.isArray(body))return json({error:'Use secret reference or workload grant metadata'},400);
    const allowed=revoke?[]:connect?['binding']:disconnect?[]:['id','token','names','expires'];
    if(Object.keys(body).some(key=>!allowed.includes(key)))return json({error:'Secret values and unknown fields are not accepted; manage values in Cloudflare'},400);
    let input:VaultEdit;
    if(revoke)input={...common,operation:'revoke',id:parts[1]};
    else{
      const condition=request.headers.get('If-Match');if(condition===null)return json({error:'Use the revision from secret list in If-Match'},428);
      const match=/^"secrets-(0|[1-9]\d{0,15})"$/.exec(condition);if(!match||!Number.isSafeInteger(Number(match[1])))return json({error:'Use a valid secret reference revision'},400);
      const revision=Number(match[1]);
      if(connect){if(typeof body.binding!=='string')return json({error:'Choose a Cloudflare binding reference'},400);input={...common,operation:'connect',revision,name:parts[0],binding:body.binding};}
      else if(disconnect)input={...common,operation:'disconnect',revision,name:parts[0]};
      else{
        if(!uuid(body.id)||typeof body.token!=='string'||!/^nhw_[a-f0-9]{64}$/.test(body.token)||!Array.isArray(body.names)||!body.names.length||body.names.length>100||!body.names.every(validName)||new Set(body.names).size!==body.names.length||!Number.isSafeInteger(body.expires))return json({error:'Use a client-generated workload grant saved in a private file'},400);
        input={...common,operation:'grant',revision,id:body.id,hash:await digest(body.token),names:body.names as string[],expires:Number(body.expires)};
      }
    }
    const writeAuthority=grant?new CliVaultAuthority(env,user,trunk,url.origin,permission,true,Number(body.expires)):authority;
    const result=await vault.administer(scope,input,writeAuthority);
    try{return 'conflict'in result?json({error:'Secret references changed; inspect secret list before editing',...result},412):json(result,'grant'in result&&result.grant.created?201:200);}
    finally{(result as unknown as {[Symbol.dispose]?:()=>void})[Symbol.dispose]?.();}
  }catch(error){
    if(error instanceof Response)return error;
    const message=(error as Error).message;
    if(message.includes('does not implement the method'))return json({error:'Secret administration is updating; no legacy fallback is permitted'},503);
    return json({error:message},/Current repository|delegation expired|authorization expired|authorization.*consumed/.test(message)?403:/Conflicting|no longer available/.test(message)?409:400);
  }
}
