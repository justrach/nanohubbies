import {creationBody} from '../abuse';
import type {User} from '../auth';
import type {Owner} from '../types';
import type {Pull,Branch,ReviewSnapshot} from './types';
import type {PullReadinessInput} from './readiness';
const headers={'Cache-Control':'private, no-store'};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers});
export const readinessUpdating=()=>json({error:'Pull request draft tracking is updating; retry after deployment completes'},503);
export const missingReadiness=(error:unknown)=>error instanceof Error&&['pullReadinessConfiguration','openDraftPull','editPullReadiness'].some(name=>error.message.includes(`does not implement the method "${name}"`)||error.message.includes(name)&&/not a function|not implemented/.test(error.message));
export const readinessActor=(request:Request,user:User|null,owner:Owner):PullReadinessInput['actor']=>({...owner,origin:new URL(request.url).origin,...(user?.cli?{via:{kind:'cli' as const,credentialId:user.cli.credentialId}}:{}),...(request.headers.has('authorization')?{authorization:request.headers.get('authorization')!}:{})});
export async function editReadinessRoute(env:Env,request:Request,trunk:string,pull:Pull,head:Branch,user:User|null,owner:Owner){
  if(request.method!=='POST')return json({error:'Use POST to change pull request draft status'},405);
  try{
    const body=await creationBody<Record<string,unknown>>(request,2048);
    if(!body||Array.isArray(body)||Object.keys(body).some(key=>!['draft','revision','commit','anchor'].includes(key))||typeof body.draft!=='boolean'||!Number.isSafeInteger(body.revision)||Number(body.revision)<0||typeof body.commit!=='string'||typeof body.anchor!=='string')return json({error:'Use a draft status, current revision and observed PR head/comparison'},400);
    if(!request.headers.has('If-Match'))return json({error:'Use If-Match with the pull request draft revision'},428);
    if(request.headers.get('If-Match')!==`"pull-readiness-${body.revision}"`)return json({error:'If-Match must match the draft revision'},400);
    const seq=env.SEQUENCER.get(env.SEQUENCER.idFromName(trunk));
    if((await seq.pullReadinessConfiguration()).pullReadiness!=='storage-v1')return readinessUpdating();
    if(body.commit!==head.commit||body.anchor!==pull.anchor)return json({error:'Pull request changed; inspect its latest diff'},409);
    const result=await seq.editPullReadiness({number:pull.number,draft:body.draft,revision:Number(body.revision),commit:body.commit,anchor:body.anchor,actor:readinessActor(request,user,owner)});
    if('conflict'in result)return json({error:'Pull request draft status changed; inspect it before editing',...result},412);
    const current=result.pulls.find(p=>p.number===pull.number);
    return Response.json(result satisfies ReviewSnapshot,{headers:{...headers,ETag:`"pull-readiness-${current?.draftRevision}"`}});
  }catch(error){
    if(error instanceof Response)return error;
    if(missingReadiness(error))return readinessUpdating();
    const message=error instanceof Error?error.message:String(error);
    return json({error:message},/changed|Only open|no longer open/.test(message)?409:/access|permission|authorization|credential|archiv/i.test(message)?403:/authority.*unavailable|tracking is updating/.test(message)?503:400);
  }
}
