import type {User} from "../auth";
import {creationBody} from "../abuse";
import {canAdmin,canWrite,requireTeam,sameOrigin,type TeamAccess} from "../team/access";
import {cliCredential,listCliCredentials,makeCliCredential,requestedScopes,revokeCliCredential,type CliScope} from "./credentials";
import {cliDeviceRoute} from "./device";
import {cliScopes,cliScopeWrites,cliScopeAllowed,cliAdminScope,cliOwnerScope} from "./credentials";
import {archiveLocked} from "../repository/archive";

const json=(body:unknown,status=200)=>Response.json(body,{status});
export async function cliCredentialRoute(env:Env,request:Request,trunk:string,user:User|null,access:TeamAccess|null) {
  if(!user||user.cli||request.headers.has("authorization"))return json({error:"Sign in to manage CLI credentials"},403);
  if(!access)return json({error:"CLI credentials require a repository access policy"},403);
  if(request.method==="GET") {
    const writable=canWrite(access)&&!archiveLocked(await env.HUB.get(env.HUB.idFromName("hub")).repositoryArchive(trunk));
    return json({credentials:await listCliCredentials(env,user.id,trunk),allowedScopes:cliScopes.filter(scope=>cliScopeAllowed(scope,access.proof.role,writable))});
  }
  if(request.method!=="POST")return json({error:"Use GET or POST"},405);
  if(!sameOrigin(env,request))return json({error:"Same-origin request required"},403);
  const body=await creationBody<Record<string,unknown>>(request,4096);
  if(Object.keys(body).some(k=>!["label","scopes","days"].includes(k)))return json({error:"Unknown CLI credential field"},400);
  const scopes=requestedScopes(body.scopes);
  if(!canWrite(access)&&scopes.some(cliScopeWrites))return json({error:"Repository write access is required for these permissions"},403);
  if(scopes.some(cliAdminScope)&&!canAdmin(access))return json({error:"Current repository admin access is required for these permissions"},403);
  if(scopes.some(cliOwnerScope)&&access.proof.role!=='owner')return json({error:'Current repository owner access is required for runner administration'},403);
  if(scopes.some(scope=>cliScopeWrites(scope)&&scope!=="repository:archive"))await env.HUB.get(env.HUB.idFromName("hub")).assertRepositoryWritable(trunk);
  return json(await makeCliCredential(env,user,trunk,new URL(request.url).origin,body.label,scopes,body.days),201);
}

/** A deliberately bounded gateway. Never converts tokens into browser cookies.
 * The trusted delegated user exists only inside this call, after bearer/scope,
 * immutable repository and fresh membership checks. */
export async function cliRoute(env:Env,request:Request,user:User|null,dispatch:(request:Request,url:URL,user:User)=>Promise<Response>) {
  const url=new URL(request.url),parts=url.pathname.split("/").slice(3);
  if(parts.length===1&&["device","token","authorize"].includes(parts[0]))return cliDeviceRoute(env,request,user,parts[0]);
  if(parts[0]==="credentials") {
    if(!user||user.cli||request.headers.has("authorization"))return json({error:"Signed-in account session required"},403);
    if(parts.length===1&&request.method==="GET")return json(await listCliCredentials(env,user.id,url.searchParams.get("trunk")??undefined));
    if(parts.length===2&&request.method==="DELETE") {
      if(!sameOrigin(env,request))return json({error:"Same-origin request required"},403);
      return json({revoked:await revokeCliCredential(env,user.id,parts[1])});
    }
    return json({error:"Method not supported"},405);
  }
  const credential=await cliCredential(env,request);
  if(!credential)return new Response(JSON.stringify({error:"Invalid or expired CLI credential"}),{status:401,headers:{"Content-Type":"application/json","WWW-Authenticate":'Bearer realm="nanohub-cli", error="invalid_token"'}});
  const {info,user:delegate}=credential;
  if(parts.length===1&&parts[0]==="logout"&&request.method==="POST") {
    const body=await creationBody<Record<string,unknown>>(request,1024);
    if(Object.keys(body).some(k=>!["repository","trunk"].includes(k))||!!body.repository===!!body.trunk)return json({error:"Choose one credential repository"},400);
    let target=typeof body.trunk==="string"?body.trunk:undefined;
    if(typeof body.repository==="string") {
      const match=/^([a-z0-9][a-z0-9-]{0,38})\/([a-z0-9][a-z0-9._-]{0,99})$/.exec(body.repository);
      if(match)target=(await env.HUB.get(env.HUB.idFromName("hub")).resolveRepository(match[1],match[2]))?.id;
    }
    if(target!==info.trunk)return json({error:"Credential scope does not match this repository"},404);
    return json({revoked:await revokeCliCredential(env,delegate.id,info.id)});
  }
  const headers=new Headers(request.headers);headers.delete("authorization");headers.delete("cookie");headers.set("origin",url.origin);
  const internal=new Request(request.url,{method:request.method,headers,body:["GET","HEAD"].includes(request.method)?undefined:request.body,redirect:"manual"});
  // Verify current access even for status; self-revocation above remains possible
  // after removal. No external positive membership cache is trusted here.
  const access=await requireTeam(env,internal,info.trunk,delegate);
  if(!access)return json({error:"CLI credentials require a repository access policy"},403);
  if(parts.length===1&&parts[0]==="whoami"&&request.method==="GET")return json({credential:info,user:{id:delegate.id,name:delegate.name}});
  let trunk:string|undefined,rest:string[]=[];
  if(parts[0]==="repos"&&parts.length>=3) {
    const repo=await env.HUB.get(env.HUB.idFromName("hub")).resolveRepository(parts[1],parts[2]);trunk=repo?.id;rest=parts.slice(3);
  }else if(parts[0]==="trunks"&&parts.length>=2){trunk=parts[1];rest=parts.slice(2);}
  if(!trunk||trunk!==info.trunk)return json({error:"Repository not found or credential scope does not match"},404);
  const method=request.method,resource=rest.join("/");let scope:CliScope|undefined;
  if(method==="GET"&&["branches","pulls"].includes(resource))scope="read";
  if(method==="GET"&&/^rulesets(?:\/[1-9]\d{0,8})?$/.test(resource))scope="read";
  if(method==="GET"&&/^rulesets\/[1-9]\d{0,8}\/configuration$/.test(resource))scope="rulesets:write";
  if(method==="POST"&&resource==="rulesets"||["PUT","DELETE"].includes(method)&&/^rulesets\/[1-9]\d{0,8}$/.test(resource))scope="rulesets:write";
  if(method==="GET"&&resource==="protection")scope="read";
  if(method==="GET"&&resource==="archive")scope="read";
  if(method==="GET"&&resource==="default-branch")scope="read";
  if(['GET','POST'].includes(method)&&resource==='ci/runners'||method==='DELETE'&&/^ci\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(resource))scope='runners:write';
  if(method==="GET"&&/^environments(?:\/[a-zA-Z0-9-]{8,80}(?:\/configuration)?)?$/.test(resource)||method==="POST"&&resource==="environments"||["PUT","DELETE"].includes(method)&&/^environments\/[a-zA-Z0-9-]{8,80}$/.test(resource))scope="environments:write";
  if(method==="PUT"&&resource==="default-branch")scope="repository:default";
  if(method==="POST"&&resource==="archive")scope="repository:archive";
  if(["PUT","DELETE"].includes(method)&&resource==="protection")scope="protections:write";
  if(method==="GET"&&/^pulls\/[1-9]\d{0,8}(\/comments)?$/.test(resource))scope="read";
  if(method==="POST"&&resource==="pulls")scope="pulls:write";
  if(method==="POST"&&/^pulls\/[1-9]\d{0,8}\/close$/.test(resource))scope="pulls:write";
  if(method==="POST"&&/^pulls\/[1-9]\d{0,8}\/merge$/.test(resource))scope="pulls:merge";
  if(method==="POST"&&/^pulls\/[1-9]\d{0,8}\/(reviews|comments)$/.test(resource))scope="reviews:write";
  if(method==="PATCH"&&/^pulls\/[1-9]\d{0,8}\/comments$/.test(resource))scope="reviews:write";
  if(!scope)return json({error:"CLI operation not supported"},404);
  if(!info.scopes.includes(scope))return new Response(JSON.stringify({error:`CLI credential requires ${scope}`}),{status:403,headers:{"Content-Type":"application/json","WWW-Authenticate":`Bearer error="insufficient_scope", scope="${scope}"`}});
  if(method!=="GET"&&!canWrite(access))return json({error:"Current repository write access required"},403);
  if(cliAdminScope(scope)&&!canAdmin(access))return json({error:"Current repository admin access required"},403);
  if(cliOwnerScope(scope)&&access.proof.role!=='owner')return json({error:'Current repository owner access required'},403);
  const target=new URL(url);target.pathname=`/api/trunks/${trunk}/${resource}`;
  return dispatch(new Request(target,internal),target,delegate);
}
