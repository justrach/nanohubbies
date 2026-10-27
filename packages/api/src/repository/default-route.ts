import {creationBody} from '../abuse';
import type {User} from '../auth';
import {canAdmin,sameOrigin,type TeamAccess} from '../team/access';
import {TeamError} from '../team/provider';
import {archiveLocked} from './archive';
const headers={'Cache-Control':'private, no-store'};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers});
const updating=()=>Response.json({error:'Default branch administration is updating; inspect repo default-branch again shortly'},{status:503,headers:{...headers,'Retry-After':'5'}});
const missing=(error:unknown)=>error instanceof Error&&['defaultBranchConfiguration','configureRepositoryDefault','repositoryConfiguration','selectRepositoryDefault','rulesetActor'].some(method=>error.message.includes(`does not implement the method "${method}"`));
export async function defaultBranchRoute(env:Env,request:Request,trunk:string,user:User|null,access:TeamAccess|null,id?:string,operation?:string) {
 const seq=env.SEQUENCER.get(env.SEQUENCER.idFromName(trunk)),hub=env.HUB.get(env.HUB.idFromName('hub')),delegated=!!user?.cli;
 if(id||operation)return json({error:'Unknown default branch operation'},404);
 if(!['GET','PUT'].includes(request.method))return json({error:'Use GET or PUT'},405);
 const entry=await hub.find(trunk),admin=!!user&&!request.headers.has('authorization')&&(access?canAdmin(access):entry?.owner===user.id),editor=admin&&(!delegated||user!.cli!.scopes.includes('repository:default'));
 if(request.method==='PUT'&&(!editor||!sameOrigin(env,request)))return json({error:'Current repository admin access and default branch permission are required'},403);
 const configuration=async()=>{
  try{const data=await seq.defaultBranchConfiguration();return delegated&&(data.conditionalWrites!==true||data.cliAudit!==true||data.revisionTracking!=='storage')?null:data;}
  catch(error){if(!missing(error))throw error;return delegated?null:await seq.repositoryConfiguration();}
 };
 try{
  if(request.method==='GET'){
   const data=await configuration();if(!data)return updating();
   const readOnly=archiveLocked(await hub.repositoryArchive(trunk));
   return Response.json({...data,readOnly,canManage:editor&&!readOnly&&data.mode==='git'},{headers:{...headers,ETag:`"default-${data.revision}"`}});
  }
  const body=await creationBody<{branch:string;commit:string;revision:number}>(request,2048);
  if(!body||Array.isArray(body)||Object.keys(body).some(key=>!['branch','commit','revision'].includes(key))||typeof body.branch!=='string'||typeof body.commit!=='string'||!/^[a-f0-9]{40}$/.test(body.commit)||!Number.isSafeInteger(body.revision)||body.revision<0)return json({error:'Choose a branch, its observed commit and settings revision'},400);
  if(delegated){
   const condition=request.headers.get('If-Match');if(condition===null)return json({error:'Use If-Match with the revision from repo default-branch'},428);
   if(condition!==`"default-${body.revision}"`)return json({error:'If-Match must match the default branch revision in the request'},400);
   if(!await configuration())return updating();
  }
  await hub.assertRepositoryWritable(trunk);
  const result=delegated?await seq.configureRepositoryDefault({...body,credentialId:user!.cli!.credentialId,origin:new URL(request.url).origin},user!.id):await seq.selectRepositoryDefault(body,user!.id);
  return 'conflict' in result?json({error:'Repository settings changed; inspect repo default-branch before editing',...result},delegated?412:409):json(result);
 }catch(error){
  if(error instanceof Response)return error;
  if(error instanceof TeamError)throw error;
  if(missing(error))return updating();
  const message=(error as Error).message;
  return json({error:message},/Current repository admin/.test(message)?403:400);
 }
}
