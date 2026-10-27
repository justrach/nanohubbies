import {creationBody} from '../abuse';
import {sameOrigin,canWrite,type TeamAccess} from '../team/access';
import type {User} from '../auth';
export async function deploymentRequestRoute(env:Env,request:Request,trunk:string,id:string|undefined,operation:string|undefined,user:User|null,access:TeamAccess|null) {
 if(!user||request.headers.has('authorization'))return Response.json({error:'A signed-in repository member is required'},{status:403});
 const seq=env.SEQUENCER.get(env.SEQUENCER.idFromName(trunk)),url=new URL(request.url),headers={'Cache-Control':'private, no-store'};
 try {
  if(request.method==='GET'&&!id) {
   const params=url.searchParams,number=(name:string)=>{const v=params.get(name);if(v===null)return undefined;if(!/^[1-9]\d*$/.test(v)||!Number.isSafeInteger(Number(v)))throw Error('Invalid deployment request cursor');return Number(v);};
   if([...params.keys()].some(key=>!['before','limit'].includes(key)))throw Error('Unknown deployment request filter');
   return Response.json(await seq.deploymentRequests(user.id,url.origin,number('before'),number('limit')??25),{headers});
  }
  if(!sameOrigin(env,request))return Response.json({error:'Same-origin request required'},{status:403,headers});
  if(request.method==='POST'&&!id) {
   if(!canWrite(access))return Response.json({error:'A repository writer is required to request a deployment'},{status:403,headers});
   const body=await creationBody<{runId:string;environment:string}>(request,2048);if(Object.keys(body).some(key=>!['runId','environment'].includes(key))||typeof body.runId!=='string'||typeof body.environment!=='string')throw Error('Choose a run and deployment environment');
   return Response.json(await seq.requestDeployment(body.runId,body.environment,user.id),{status:201,headers});
  }
  if(request.method==='POST'&&id&&operation==='reviews') {
   const body=await creationBody<{decision:'approve'|'reject';comment?:string;revision:number}>(request,32*1024);if(Object.keys(body).some(key=>!['decision','comment','revision'].includes(key)))throw Error('Unknown deployment review field');
   return Response.json(await seq.reviewDeployment(id,user.id,body.decision,body.comment??'',body.revision,url.origin),{headers});
  }
  return Response.json({error:'Deployment request operation not found'},{status:404,headers});
 }catch(error){const message=(error as Error).message;return Response.json({error:message},{status:/cannot review|self-review/.test(message)?403:/changed|already recorded/.test(message)?409:400,headers});}
}
