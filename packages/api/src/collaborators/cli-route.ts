import type {User} from '../auth';
import type {TeamAccess} from '../team/access';
import {canAdmin,sameOrigin} from '../team/access';
import {creationBody} from '../abuse';
import {hashToken} from './store';
import type {CollaboratorEdit} from './administration';
const headers={'Cache-Control':'private, no-store'};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers});
const updating=()=>Response.json({error:'Collaborator administration is updating; inspect access list again shortly'},{status:503,headers:{...headers,'Retry-After':'5'}});
export async function cliCollaborators(env:Env,request:Request,trunk:string,id:string|undefined,user:User,access:TeamAccess|null) {
 if(!user.cli?.scopes.includes('collaborators:write')||request.headers.has('authorization')||!access||access.binding.kind!=='owner'||access.proof.agentId||!canAdmin(access))return json({error:'Current independently managed repository admin access and collaborators:write permission required'},403);
 if(id||!['GET','POST','PATCH','DELETE'].includes(request.method))return json({error:'Unknown collaborator administration operation'},404);
 const hub=env.HUB.get(env.HUB.idFromName('hub'));
 try {
  const configuration=await hub.collaboratorConfiguration(trunk,user.id);
  if(configuration.conditionalWrites!==true||configuration.clientInvitations!=='v1'||configuration.revisionTracking!=='storage')return updating();
  if(request.method==='GET')return Response.json(configuration,{headers:{...headers,ETag:`"collaborators-${configuration.revision}"`}});
  if(!sameOrigin(env,request))return json({error:'Same-origin request required'},403);
  const body=await creationBody<Record<string,unknown>>(request,4096);
  if(!body||Array.isArray(body)||typeof body!=='object'||!Number.isSafeInteger(body.revision)||Number(body.revision)<0)return json({error:'Provide the revision from access list'},400);
  const condition=request.headers.get('If-Match');
  if(condition===null)return json({error:'Use If-Match with the revision from access list'},428);
  if(condition!==`"collaborators-${body.revision}"`)return json({error:'If-Match must match the collaborator revision in the request'},400);
  const allowed=request.method==='POST'?['id','userId','role','token','revision']:request.method==='PATCH'?['userId','role','revision']:['id','revision'];
  if(Object.keys(body).some(key=>!allowed.includes(key)))return json({error:'Unknown collaborator administration field'},400);
  let edit:CollaboratorEdit;
  const common={revision:Number(body.revision),credentialId:user.cli.credentialId};
  if(request.method==='POST') {
   if(typeof body.token!=='string'||!/^nhi_[a-f0-9]{64}$/.test(body.token))return json({error:'Use a client-generated invitation saved in a private file'},400);
   edit={...common,op:'invite',id:body.id as string,userId:body.userId as string,role:body.role as 'reader'|'writer'|'admin',tokenHash:await hashToken(body.token)};
  }else if(request.method==='PATCH')edit={...common,op:'change',userId:body.userId as string,role:body.role as 'reader'|'writer'|'admin'|null};
  else edit={...common,op:'cancel',id:body.id as string};
  const result=await hub.configureCollaborators(trunk,user.id,edit);
  return 'conflict' in result?json({error:'Repository access changed; inspect access list before editing',...result},412):json(result,request.method==='POST'&&'created' in result&&result.created?201:200);
 }catch(error){
  if(error instanceof Response)return error;
  const message=(error as Error).message;
  if(['collaboratorConfiguration','configureCollaborators'].some(method=>message.includes(`does not implement the method "${method}"`)))return updating();
  return json({error:message},/Current repository|Only the owner|independently managed/.test(message)?403:/Conflicting|no longer available/.test(message)?409:400);
 }
}
