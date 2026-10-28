import {creationBody} from '../abuse';
import type {User} from '../auth';
import {canAdmin,sameOrigin,type TeamAccess} from '../team/access';
import {TeamError} from '../team/provider';
import {archiveLocked} from './archive';
import {normalizeMergeSettings,type MergeSettingsInput} from './merge-settings';
const headers={'Cache-Control':'private, no-store'};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers});
const missing=(error:unknown)=>error instanceof Error&&['mergeSettingsConfiguration','configureMergeSettings'].some(name=>error.message.includes(`does not implement the method "${name}"`));
const updating=()=>Response.json({error:'Merge settings administration is updating; inspect repo merge-settings again shortly'},{status:503,headers:{...headers,'Retry-After':'5'}});
export async function mergeSettingsRoute(env:Env,request:Request,trunk:string,user:User|null,access:TeamAccess|null,id?:string,operation?:string) {
 if(id||operation)return json({error:'Unknown merge settings operation'},404);
 if(!['GET','PUT'].includes(request.method))return json({error:'Use GET or PUT'},405);
 const seq=env.SEQUENCER.get(env.SEQUENCER.idFromName(trunk)),hub=env.HUB.get(env.HUB.idFromName('hub'));
 const delegated=!!user?.cli,entry=await hub.find(trunk);
 const admin=!!user&&!request.headers.has('authorization')&&(access?canAdmin(access):entry?.owner===user.id);
 const editor=admin&&(!delegated||user!.cli!.scopes.includes('repository:merge'));
 if(request.method==='PUT'&&(!editor||!sameOrigin(env,request)))return json({error:'Current repository admin access and merge settings permission are required'},403);
 try {
  const data=await seq.mergeSettingsConfiguration();
  if(data.conditionalWrites!==true||data.cliAudit!==true||data.revisionTracking!=='storage')return updating();
  if(request.method==='GET'){
   const readOnly=archiveLocked(await hub.repositoryArchive(trunk));
   return Response.json({...data,readOnly,canManage:editor&&!readOnly&&data.mode==='git'},
    {headers:{...headers,ETag:`"merge-settings-${data.revision}"`}});
  }
  const body=await creationBody<MergeSettingsInput&{revision:number}>(request,2048);
  if(!body||Array.isArray(body)||Object.keys(body).some(key=>!['allowedMethods','defaultMethod','revision'].includes(key))||!Number.isSafeInteger(body.revision)||body.revision<0)
   return json({error:'Provide allowedMethods, defaultMethod and the observed merge settings revision'},400);
  const input=normalizeMergeSettings(body);
  if(delegated) {
   const condition=request.headers.get('If-Match');
   if(condition===null)return json({error:'Use If-Match with the revision from repo merge-settings'},428);
   if(condition!==`"merge-settings-${body.revision}"`)return json({error:'If-Match must match the merge settings revision in the request'},400);
  }
  await hub.assertRepositoryWritable(trunk);
  const result=await seq.configureMergeSettings({...input,revision:body.revision,origin:new URL(request.url).origin,...(delegated?{credentialId:user!.cli!.credentialId}:{})},user!.id);
  return 'conflict' in result?json({error:delegated?'Merge settings changed; inspect repo merge-settings before editing':'Merge settings changed. Reload merge settings before saving again.',...result},delegated?412:409):json(result);
 } catch(error) {
  if(error instanceof Response)return error;
  if(error instanceof TeamError)throw error;
  if(missing(error))return updating();
  const message=(error as Error).message;
  return json({error:message},message.includes('Current repository admin')?403:400);
 }
}
