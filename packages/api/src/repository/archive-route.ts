import {creationBody} from '../abuse';
import type {User} from '../auth';
import {canAdmin,sameOrigin,type TeamAccess} from '../team/access';
import {archiveLocked} from './archive';
export async function archiveRoute(env:Env,request:Request,trunk:string,user:User|null,access:TeamAccess|null) {
  const hub=env.HUB.get(env.HUB.idFromName('hub')),entry=await hub.find(trunk),headers={'Cache-Control':'private, no-store'};
  if(!entry)return Response.json({error:'Repository not found'},{status:404,headers});
  const delegated=!!user?.cli;
  const canManage=!!user&&!request.headers.has('authorization')&&(!user.cli||user.cli.scopes.includes('repository:archive'))&&(access?canAdmin(access):entry.owner===user.id);
  const confirmation=(await hub.repositoryAddress(trunk))?.name??trunk;
  const result=(state:import('./archive-types').ArchiveState,ready=delegated)=>Response.json({...state,readOnly:archiveLocked(state),canManage,confirmation,...(ready?{conditionalWrites:true,nameConfirmation:true}:{})},{headers:{...headers,ETag:`"archive-${state.revision}"`}});
  const updating=()=>Response.json({error:'Archive administration is updating; inspect repo archive-status again shortly'},{status:503,headers:{...headers,'Retry-After':'5'}});
  const missing=(error:unknown)=>error instanceof Error&&['archiveConfiguration','configureRepositoryArchive'].some(method=>error.message.includes(`does not implement the method "${method}"`));
  const configuration=async()=>{
    const [value,receiver]=await Promise.all([hub.archiveConfiguration(trunk),env.SEQUENCER.get(env.SEQUENCER.idFromName(trunk)).archiveConfiguration()]);
    return value.conditionalWrites===true&&value.nameConfirmation===true&&receiver.cliAudit===true?value:null;
  };
  if(request.method==='GET'){
    try{const state=await configuration();if(state)return result(state,true);if(delegated)return updating();}
    catch(error){if(!missing(error))throw error;if(delegated)return updating();}
    return result(await hub.repositoryArchive(trunk),false);
  }
  if(request.method!=='POST')return Response.json({error:'Method not supported'},{status:405,headers});
  if(!canManage||!sameOrigin(env,request))return Response.json({error:'A same-origin repository owner or admin session is required'},{status:403,headers});
  let body:{archived:boolean;revision:number;confirmation:string};
  try{body=await creationBody(request,2048);}catch(error){if(error instanceof Response)return error;return Response.json({error:'Use an archive state, current revision and repository name'},{status:400,headers});}
  if(!body||Array.isArray(body)||Object.keys(body).some(key=>!['archived','revision','confirmation'].includes(key))||typeof body.archived!=='boolean'||!Number.isSafeInteger(body.revision)||body.revision<0||body.confirmation!==confirmation)return Response.json({error:'Type the current repository name and use the current archive revision'},{status:400,headers});
  if(delegated){
    const condition=request.headers.get('If-Match');
    if(condition===null)return Response.json({error:'Use If-Match with the archive revision from repo archive-status'},{status:428,headers});
    const match=/^"archive-(0|[1-9]\d{0,15})"$/.exec(condition);
    if(!match||!Number.isSafeInteger(Number(match[1]))||Number(match[1])!==body.revision)return Response.json({error:'If-Match must match the archive revision in the request'},{status:400,headers});
  }
  try {
    if(delegated&&!await configuration())return updating();
    const state=delegated?await hub.configureRepositoryArchive(trunk,user!.id,body.archived,body.revision,user!.cli!.credentialId,access?.proof,body.confirmation):await hub.archiveRepository(trunk,user!.id,body.archived,body.revision,access?.proof);
    return result(state);
  } catch(error) {
    const message=(error as Error).message;
    if(missing(error))return updating();
    return Response.json({error:/Archive state changed|Repository name changed|Archive operation changed|Archive transition is pending/.test(message)?message:/required to archive/.test(message)?'A current repository owner or admin is required':'Archive transition did not finish. Inspect archive status and retry the same operation; some write paths may remain locked.'},{status:/Archive state changed|Repository name changed/.test(message)&&delegated?412:/changed|pending/.test(message)?409:/required to archive/.test(message)?403:503,headers});
  }
}
