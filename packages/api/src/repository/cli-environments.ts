import {creationBody} from '../abuse';
import type {User} from '../auth';
import {canAdmin,sameOrigin,type TeamAccess} from '../team/access';
import {TeamError} from '../team/provider';
const headers={'Cache-Control':'private, no-store'};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers});
const updating=()=>Response.json({error:'Environment administration is updating; inspect env list again shortly'},{status:503,headers:{...headers,'Retry-After':'5'}});
const missing=(error:unknown)=>error instanceof Error&&['environmentConfiguration','configureEnvironment','rulesetActor'].some(name=>error.message.includes(`does not implement the method "${name}"`));
export async function cliEnvironments(env:Env,request:Request,trunk:string,id:string|undefined,operation:string|undefined,user:User,access:TeamAccess|null){
 if(!user.cli?.scopes.includes('environments:write')||request.headers.has('authorization')||!access||!canAdmin(access))return json({error:'Current repository admin access and environments:write permission required'},403);
 if(id&&!/^[a-zA-Z0-9-]{8,80}$/.test(id)||operation&&(operation!=='configuration'||!id||request.method!=='GET'))return json({error:'Unknown environment operation'},404);
 const seq=env.SEQUENCER.get(env.SEQUENCER.idFromName(trunk));
 try{
  const data=await seq.environmentConfiguration();
  if(data.conditionalWrites!==true||data.cliAudit!==true||data.revisionTracking!=='storage')return updating();
  const current=id?data.environments.find(e=>e.id===id):undefined;
  if(request.method==='GET'){
   if(id&&!current)return json({error:'Environment not found'},404);
   const configuration=current?{name:current.name,...(current.runner?{runner:current.runner}:{}),reviewers:current.reviewers??[],preventSelfReview:current.preventSelfReview??false,waitTimerMinutes:current.waitTimerMinutes??0,deploymentBranchPolicy:current.deploymentBranchPolicy??{mode:'all' as const}}:undefined;
   return Response.json(operation==='configuration'?{revision:data.revision,configuration}:id?{...data,environment:current}:data,{headers:{...headers,ETag:`"environments-${data.revision}"`}});
  }
  if(!sameOrigin(env,request))return json({error:'Same-origin request required'},403);
  if(!(request.method==='POST'&&!id||['PUT','DELETE'].includes(request.method)&&id))return json({error:'Use env create, update or delete'},405);
  const condition=request.headers.get('If-Match');if(condition===null)return json({error:'Use If-Match with the revision from env list or env export'},428);
  const match=/^"environments-(0|[1-9]\d{0,15})"$/.exec(condition);if(!match||!Number.isSafeInteger(Number(match[1])))return json({error:'Use a valid environments revision in If-Match'},400);
  const body=await creationBody<Record<string,unknown>>(request,32768);
  if(request.method==='DELETE'&&Object.keys(body).length)return json({error:'Environment deletion accepts an empty object'},400);
  const result=await seq.configureEnvironment({revision:Number(match[1]),credentialId:user.cli.credentialId,origin:new URL(request.url).origin,...(id?{id}:{}),...(request.method==='DELETE'?{}:{configuration:body as unknown as import('../deployments/types').EnvironmentInput})},user.id);
  return 'conflict' in result?json({error:'Environment settings changed; inspect env list or env export before editing',...result},412):json(result,request.method==='POST'?201:200);
 }catch(error){if(error instanceof Response)return error;if(error instanceof TeamError)throw error;if(missing(error))return updating();const message=(error as Error).message;return json({error:message},/Current repository admin/.test(message)?403:400);}
}
