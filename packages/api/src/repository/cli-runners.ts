import {creationBody} from '../abuse';
import type {User} from '../auth';
import {sameOrigin,type TeamAccess} from '../team/access';
import {TeamError} from '../team/provider';
const headers={'Cache-Control':'private, no-store'};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers});
const missing=(error:unknown)=>error instanceof Error&&['cliRunnerConfiguration','configureCliRunner','rulesetActor'].some(method=>error.message.includes(`does not implement the method "${method}"`));
const updating=()=>Response.json({error:'Runner administration is updating; inspect runner list again shortly'},{status:503,headers:{...headers,'Retry-After':'5'}});
export async function cliRunners(env:Env,request:Request,trunk:string,id:string|undefined,operation:string|undefined,user:User,access:TeamAccess|null){
 if(!user.cli?.scopes.includes('runners:write')||request.headers.has('authorization')||!access||access.proof.role!=='owner'||access.proof.agentId)return json({error:'Current repository owner access and runners:write permission required'},403);
 if(operation||!(id==='runners'&&['GET','POST'].includes(request.method)||request.method==='DELETE'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id??'')))return json({error:'Unknown runner administration operation'},404);
 const seq=env.SEQUENCER.get(env.SEQUENCER.idFromName(trunk));
 try{
  const data=await seq.cliRunnerConfiguration();if(data.clientCredentials!=='v1'||data.cliAudit!==true||data.ownerOnly!==true)return updating();
  if(request.method==='GET')return json(data);
  if(!sameOrigin(env,request))return json({error:'Same-origin request required'},403);
  const body=await creationBody<Record<string,unknown>>(request,2048);
  if(request.method==='DELETE'&&Object.keys(body).length)return json({error:'Runner revocation accepts an empty object'},400);
  const result=await seq.configureCliRunner({credentialId:user.cli.credentialId,origin:new URL(request.url).origin,...(request.method==='DELETE'?{revoke:id!}:{registration:body as unknown as {id:string;name:string;token:string}})},user.id);
  return json(result,request.method==='POST'&&'created' in result.registration&&result.registration.created?201:200);
 }catch(error){if(error instanceof Response)return error;if(error instanceof TeamError)throw error;if(missing(error))return updating();const message=(error as Error).message;return json({error:message},message.includes('Current repository owner')?403:message.includes('not found')?404:/revoked|already/.test(message)?409:400);}
}
