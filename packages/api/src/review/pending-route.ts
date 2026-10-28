import { creationBody } from "../abuse";
import type { User } from "../auth";
import type { TrunkObjects } from "../browse/objects";
import { sameOrigin } from "../team/access";
import { reviewSelection } from "./selection";
import type { Branch, Pull, Review } from "./types";

export async function pendingReviewRoute(env:Env,request:Request,trunk:string,pull:Pull,head:Branch,objects:TrunkObjects,user:User|null,accountWriter:boolean,submit:boolean) {
  if(!accountWriter||!user||user.cli&&!user.cli.scopes.includes("reviews:write"))return Response.json({error:"Pending review requires a signed-in repository writer with review permission"},{status:403});
  const via=user.cli?{kind:"cli" as const,credentialId:user.cli.credentialId}:undefined;
  const seq=env.SEQUENCER.get(env.SEQUENCER.idFromName(trunk)),actor={id:user.id,origin:new URL(request.url).origin,...(via?{via}:{})},identity={number:pull.number,actor};
  // Never send a delegated identity to an old browser-only draft receiver.
  const pending=(command:Parameters<typeof seq.pendingReview>[0])=>via?seq.cliPendingReview(command):seq.pendingReview(command);
  try {
    if(request.method==="GET"&&!submit)return Response.json(await pending({...identity,op:"get"}));
    if(!["POST","PATCH","DELETE"].includes(request.method)||submit&&request.method!=="POST")return Response.json({error:"Pending review method not supported"},{status:405});
    if(!sameOrigin(env,request))return Response.json({error:"Same-origin request required"},{status:403});
    const body=await creationBody<Record<string,unknown>>(request,32*1024);
    const allowed=submit?["reviewId","revision","commit","anchor","verdict","body"]:request.method==="POST"?["reviewId","revision","commit","anchor","comment"]:request.method==="PATCH"?["reviewId","revision","commentId","body"]:["reviewId","revision","commentId"];
    if(Object.keys(body).some(key=>!allowed.includes(key)))throw Error("Unknown pending review field");
    if(typeof body.reviewId!=="string"||!/^[a-zA-Z0-9-]{8,80}$/.test(body.reviewId)||!Number.isSafeInteger(body.revision)||(body.revision as number)<0)throw Error("Invalid pending review identity");
    const observed={...identity,reviewId:body.reviewId,revision:body.revision as number};
    if(submit) {
      if(typeof body.commit!=="string"||typeof body.anchor!=="string"||typeof body.body!=="string"||body.body.length>16000||!["COMMENT","APPROVE","REQUEST_CHANGES"].includes(body.verdict as string))throw Error("Invalid review");
      const command={...observed,commit:body.commit,anchor:body.anchor,verdict:body.verdict as Review["verdict"],body:body.body};
      return Response.json(await (via?seq.cliSubmitPendingReview(command):seq.submitPendingReview(command)));
    }
    if(request.method==="POST") {
      if(body.commit!==head.commit||body.anchor!==pull.anchor)return Response.json({error:"PR changed; refresh and review its latest diff"},{status:409});
      const comment=body.comment as Record<string,unknown>;
      if(!comment||typeof comment!=="object"||Array.isArray(comment)||Object.keys(comment).some(key=>!["id","path","side","startLine","line","body"].includes(key)))throw Error("Invalid pending comment fields");
      if(typeof comment.id!=="string"||!/^[a-zA-Z0-9-]{8,80}$/.test(comment.id)||typeof comment.body!=="string"||!comment.body.trim()||comment.body.length>16000)throw Error("Provide a comment of 1–16000 characters and a valid ID");
      const selection=await reviewSelection(objects,pull,head,comment),author={id:user.id,name:user.name};
      return Response.json(await pending({...observed,op:"add",commit:head.commit,anchor:pull.anchor,author,comment:{...selection,id:comment.id,pull:pull.number,commit:head.commit,anchor:pull.anchor,author,body:comment.body.trim(),replyTo:null,resolved:false,at:Date.now(),...(via?{via}:{})}}));
    }
    if(body.commentId!==undefined&&(typeof body.commentId!=="string"||!/^[a-zA-Z0-9-]{8,80}$/.test(body.commentId)))throw Error("Invalid pending comment ID");
    if(request.method==="PATCH") {
      if(typeof body.commentId!=="string"||typeof body.body!=="string")throw Error("Choose a pending comment and provide its body");
      return Response.json(await pending({...observed,op:"edit",commentId:body.commentId,body:body.body}));
    }
    return Response.json(await pending(typeof body.commentId==="string"?{...observed,op:"remove",commentId:body.commentId}:{...observed,op:"discard"}));
  }catch(error) {
    const message=(error as Error).message;
    if(via&&/cli(?:Submit)?PendingReview.*(?:not a function|not implemented|does not exist)|(?:does not implement|has no method).*cli(?:Submit)?PendingReview/i.test(message))return Response.json({error:"Private CLI reviews are not available on this receiver yet; retry after deployment completes"},{status:503});
    return Response.json({error:message},{status:/No pending|No such/.test(message)?404:/changed|earlier diff|no longer open|already used|was discarded/.test(message)?409:/signed-in repository writer/.test(message)?403:400});
  }
}
