/** Reader exceptions are limited to PR feedback, never refs or settings. */
export function feedbackRequest(method:string,action:string|undefined,id:string|undefined,operation:string|undefined,tail:string[]=[]){
 if(action!=='pulls'||!id||!/^[1-9]\d{0,8}$/.test(id))return false;
 if(!tail.length&&operation==='reviews')return method==='POST';
 if(!tail.length&&operation==='comments')return ['POST','PATCH'].includes(method);
 return operation==='pending-review'&&(!tail.length&&['GET','POST','PATCH','DELETE'].includes(method)||method==='POST'&&tail.length===1&&tail[0]==='submit');
}

export function feedbackUnavailable(error:unknown){return /reader feedback.*updating|(?:does not implement|not a function|not implemented|has no method).*(?:submitHumanReview|pendingReviewWithFeedback|submitPendingReviewWithFeedback|pullCommentsWithFeedback|reviewFeedbackAccess|requestedReviews|editRequestedReviewsWithFeedback)|(?:submitHumanReview|pendingReviewWithFeedback|submitPendingReviewWithFeedback|pullCommentsWithFeedback|reviewFeedbackAccess|requestedReviews|editRequestedReviewsWithFeedback).*(?:not a function|not implemented|does not exist)/i.test(error instanceof Error?error.message:String(error));}

export function feedbackError(error:unknown){
 const message=error instanceof Error?error.message:String(error),updating=feedbackUnavailable(error);
 const status=updating?503:/No such|No pending/.test(message)?404:/changed|earlier diff|no longer open|open pull|already used|was discarded|ambiguous/.test(message)?409:/access|permission|authorization|signed-in|authors can comment|archiv|thread author/.test(message)?403:400;
 return Response.json({error:updating?'Reader-aware reviews are updating; retry after deployment completes':message},{status,headers:{'Cache-Control':'private, no-store',...(updating?{'Retry-After':'5'}:{})}});
}
