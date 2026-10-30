import {creationBody} from '../abuse';
import type {User} from '../auth';
import {sameOrigin,canWrite,type TeamAccess} from '../team/access';
import {TeamError} from '../team/provider';
export type CliDeploymentMutation = {credentialId:string;origin:string} & (
  {operation:'request';runId:string;environment:string} |
  {operation:'review';id:string;decision:'approve'|'reject';comment:string;revision:number}
);
const headers={'Cache-Control':'private, no-store'},idPattern=/^[a-zA-Z0-9-]{8,80}$/;
const json=(data:unknown,status=200)=>Response.json(data,{status,headers});
const updating=()=>Response.json({error:'Deployment CLI is updating; inspect deployment list again shortly'},{status:503,headers:{...headers,'Retry-After':'5'}});
export async function cliDeploymentRoute(env:Env,request:Request,trunk:string,id:string|undefined,operation:string|undefined,user:User,access:TeamAccess|null){
 if(!user.cli||request.headers.has('authorization')||!access||access.proof.agentId)return json({error:'An authenticated repository CLI credential is required'},403);
 if(id&&!idPattern.test(id)||operation&&(operation!=='reviews'||!id)||!['GET','POST'].includes(request.method)||request.method==='GET'&&!!operation)return json({error:'Unknown deployment operation'},404);
 const scope=request.method==='GET'?'read':id?'deployments:review':'deployments:write';
 if(!user.cli.scopes.includes(scope)||scope==='deployments:write'&&!canWrite(access))return json({error:`Current repository access and ${scope} permission required`},403);
 const seq=env.SEQUENCER.get(env.SEQUENCER.idFromName(trunk)),origin=new URL(request.url).origin;
 try{
  const capabilities=await seq.deploymentCliCapabilities();
  if(capabilities?.version!==1||capabilities.conditionalReviews!==true||capabilities.cliAudit!==true||capabilities.finalGrantCheck!==true)return updating();
  if(request.method==='GET'){
   const mask=(value:import('./approval-types').DeploymentRequestStatus)=>({...value,canReview:value.canReview&&user.cli!.scopes.includes('deployments:review'),canApprove:value.canApprove&&user.cli!.scopes.includes('deployments:review')});
   const params=new URL(request.url).searchParams;
   if(id){if([...params.keys()].length)throw Error('Deployment view does not accept filters');const value=await seq.deploymentRequest(id,user.id,origin);return Response.json({request:mask(value)},{headers:{...headers,ETag:`"deployment-request-${value.revision}"`}});}
   if([...params.keys()].some(key=>!['before','limit'].includes(key)))throw Error('Unknown deployment request filter');
   const number=(key:string)=>{const value=params.get(key);if(value===null)return undefined;if(!/^[1-9]\d*$/.test(value)||!Number.isSafeInteger(Number(value)))throw Error('Invalid deployment request cursor');return Number(value);};
   const page=await seq.deploymentRequests(user.id,origin,number('before'),number('limit')??25);return json({...page,requests:page.requests.map(mask)});
  }
  if(!sameOrigin(env,request))return json({error:'Same-origin request required'},403);
  const body=await creationBody<Record<string,unknown>>(request,32768);
  let input:CliDeploymentMutation;
  if(!id){if(operation||Object.keys(body).some(key=>!['runId','environment'].includes(key))||typeof body.runId!=='string'||!idPattern.test(body.runId)||typeof body.environment!=='string')throw Error('Choose a run and deployment environment');input={operation:'request',runId:body.runId,environment:body.environment,credentialId:user.cli.credentialId,origin};}
  else{
   if(operation!=='reviews'||Object.keys(body).some(key=>!['decision','comment'].includes(key))||!['approve','reject'].includes(body.decision as string)||body.comment!==undefined&&typeof body.comment!=='string')throw Error('Choose approve or reject and an optional comment');
   const condition=request.headers.get('If-Match');if(condition===null)return json({error:'Use If-Match with the request revision from deployment view'},428);
   const match=/^"deployment-request-(0|[1-9]\d{0,15})"$/.exec(condition);if(!match||!Number.isSafeInteger(Number(match[1])))throw Error('Use a valid deployment request revision in If-Match');
   input={operation:'review',id,decision:body.decision as 'approve'|'reject',comment:body.comment as string??'',revision:Number(match[1]),credentialId:user.cli.credentialId,origin};
  }
  return json({request:await seq.mutateCliDeployment(input,user.id)},id?200:201);
 }catch(error){if(error instanceof TeamError)throw error;const message=(error as Error).message;if(['deploymentCliCapabilities','deploymentRequest','mutateCliDeployment'].some(name=>message.includes(`does not implement the method "${name}"`)))return updating();return json({error:message},/CLI credential|Current repository|cannot review|self-review/.test(message)?403:/changed; refresh before reviewing/.test(message)?412:/changed|already recorded/.test(message)?409:/not found/.test(message)?404:400);}
}
