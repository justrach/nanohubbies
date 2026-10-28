const verdicts={comment:'COMMENT',approve:'APPROVE','request-changes':'REQUEST_CHANGES'};
function revision(value) {
 if(!/^(0|[1-9]\d{0,15})$/.test(value??'')||!Number.isSafeInteger(Number(value)))throw Error('Use --revision N from pr draft; use 0 to start a new draft');
 return Number(value);
}
export function inlineSelection(opts) {
 const side={left:'LEFT',right:'RIGHT'}[opts.side??'right'],line=Number(opts.line),startLine=Number(opts['start-line']??opts.line);
 if(!opts.path||!side||!Number.isSafeInteger(line)||!Number.isSafeInteger(startLine)||line<1||startLine<1||startLine>line||line-startLine>200)throw Error('Select --path FILE --line N [--start-line N] [--side left|right] within one hunk');
 return {path:opts.path,side,line,startLine};
}
/** Reads never select browser or another credential's private workspace. */
export async function pendingCommand({action,number,opts,get,post,output}) {
 const path=`/pulls/${number}/pending-review`,editing=action==='draft'&&(opts.edit!==undefined||opts.remove!==undefined||opts.discard);
 const mutating=action!=='draft'||editing;
 if(action==='draft') {
  if([opts.edit!==undefined,opts.remove!==undefined,!!opts.discard].filter(Boolean).length>1)throw Error('Choose --edit COMMENT, --remove COMMENT or --discard');
  if(opts.body!==undefined&&opts.edit===undefined)throw Error('--body on pr draft requires --edit COMMENT');
  if(!mutating&&opts.revision!==undefined)throw Error('--revision is only needed to change a draft');
 }
 let observed;
 if(mutating) {
  observed=revision(opts.revision);
  if((action==='comment'||opts.edit!==undefined)&&(!opts.body?.trim()||opts.body.length>16000))throw Error('Provide --body with 1–16000 characters');
  if(action==='comment')inlineSelection(opts);
  if(action==='review'&&(!verdicts[opts.verdict??'comment']||(opts.body??'').length>16000))throw Error('Choose --verdict comment, approve or request-changes and a body of at most 16000 characters');
 }
 const {pending}=await get(path);
 if(!mutating) {
  output({pending},pending?`Private CLI draft ${pending.id}\nRevision: ${pending.revision}\nHead: ${pending.commit}\nComparison: ${pending.anchor}\n`+pending.comments.map(c=>`${c.id}\t${c.path}:${c.startLine}–${c.line} (${c.side.toLowerCase()})\n${c.body}`).join('\n\n'):'No pending review for this CLI credential.');return;
 }
 if((pending?.revision??0)!==observed)throw Error('Pending review changed; inspect pr draft and use its current --revision');
 if(!pending&&action!=='comment')throw Error('No pending review for this CLI credential');
 const identity={reviewId:pending?.id??crypto.randomUUID(),revision:observed};
 if(action==='comment') {
  const view=await get(`/pulls/${number}`),comment={...inlineSelection(opts),id:crypto.randomUUID(),body:opts.body};
  const result=await post(path,{...identity,commit:view.head.commit,anchor:view.pull.anchor,comment});
  output(result,`Saved private comment ${comment.id} on #${number}. Draft revision: ${result.pending.revision}.`);return;
 }
 if(action==='review') {
  const result=await post(path+'/submit',{...identity,commit:pending.commit,anchor:pending.anchor,verdict:verdicts[opts.verdict??'comment'],body:opts.body??''});
  output(result,`Published pending review ${result.reviewId} and ${pending.comments.length} comments on #${number}.`);return;
 }
 const result=await post(path,{...identity,...(opts.edit!==undefined?{commentId:opts.edit,body:opts.body}:opts.remove!==undefined?{commentId:opts.remove}:{})},opts.edit!==undefined?'PATCH':'DELETE');
 output(result,result.pending?`Saved draft revision ${result.pending.revision}.`:'Discarded private CLI review.');
}
