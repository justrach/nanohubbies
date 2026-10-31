import {creationBody} from '../abuse';
import type {User} from '../auth';
import {sameOrigin} from '../team/access';
import {archiveLocked} from '../repository/archive';
import type {Pull,Branch} from './types';
import {reviewerId} from './requests';
import {feedbackError} from './feedback-http';
const headers={'Cache-Control':'private, no-store'};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers});
const tracked=(data:{protocol?:number;revisionTracking?:string;answerTracking?:string;readerFeedback?:string})=>data.protocol===1&&data.revisionTracking==='storage'&&data.answerTracking==='storage-v2'&&data.readerFeedback==='v1';
const updating=()=>json({error:'Stored review request tracking is updating; retry after deployment completes'},503);
export async function reviewRequestRoute(env:Env,request:Request,trunk:string,pull:Pull,head:Branch,user:User|null,accountWriter:boolean){
  const seq=env.SEQUENCER.get(env.SEQUENCER.idFromName(trunk)),origin=new URL(request.url).origin;
  const canManage=!!user&&accountWriter&&(!user.cli||user.cli.scopes.includes('pulls:write'));
  try{
    if(request.method==='GET'){
      const data=await seq.requestedReviews(pull.number,origin),hub=env.HUB.get(env.HUB.idFromName('hub'));
      if(!tracked(data))return updating();
      const binding=canManage?await hub.team(trunk):null;
      const candidates=binding?.kind==='owner'?(await hub.collaborators(trunk)).members.filter(member=>member.userId!==pull.author.id).map(member=>({id:member.userId,role:member.role})):[];
      const readOnly=archiveLocked(await hub.repositoryArchive(trunk));
      return Response.json({...data,readOnly,canManage:canManage&&pull.state==='open'&&!readOnly,candidates,directoryComplete:canManage&&(!binding||binding.kind==='owner')},{headers:{...headers,ETag:`"review-requests-${data.revision}"`}});
    }
    if(!['POST','DELETE'].includes(request.method))return json({error:'Use GET, POST or DELETE for review requests'},405);
    if(!canManage)return json({error:'Current repository writer access and pull request permission required'},403);
    if(!sameOrigin(env,request))return json({error:'Same-origin request required'},403);
    const body=await creationBody<Record<string,unknown>>(request,8192);
    if(!body||Array.isArray(body)||Object.keys(body).some(key=>!['reviewers','revision','commit','anchor'].includes(key))||!Array.isArray(body.reviewers)||!body.reviewers.length||body.reviewers.length>15||!body.reviewers.every(reviewerId)||new Set(body.reviewers).size!==body.reviewers.length||!Number.isSafeInteger(body.revision)||Number(body.revision)<0||typeof body.commit!=='string'||typeof body.anchor!=='string')return json({error:'Choose 1–15 distinct reviewer account IDs and the observed PR/revision'},400);
    if(!request.headers.has('If-Match'))return json({error:'Use If-Match with the review request revision'},428);
    if(request.headers.get('If-Match')!==`"review-requests-${body.revision}"`)return json({error:'If-Match must match the review request revision'},400);
    if(!tracked(await seq.requestedReviews(pull.number,origin)))return updating();
    const data=await seq.editRequestedReviewsWithFeedback({number:pull.number,operation:request.method==='POST'?'request':'remove',reviewers:body.reviewers as string[],revision:Number(body.revision),commit:body.commit,anchor:body.anchor,actor:{id:user!.id,name:user!.name},origin,...(user!.cli?{credentialId:user!.cli.credentialId}:{})});
    return 'conflict'in data?json({error:'Review requests changed; inspect reviewers before editing',...data},412):json(data);
  }catch(error){
    return feedbackError(error);
  }
}
