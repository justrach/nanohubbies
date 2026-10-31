"use client";
import { useState } from "react";
import type { PendingReview as Draft, PullComment } from "@swarm/api/review";
import { Button } from "@/components/controls";
import { field } from "./shared";
import styles from "./PullFiles.module.css";

export function PendingReview({draft,busy,stale,open,feedbackOnly,ownPull,onEdit,onRemove,onDiscard,onSubmit}:{
  draft:Draft;busy:boolean;stale:boolean;open:boolean;feedbackOnly:boolean;ownPull:boolean;
  onEdit:(id:string,body:string)=>Promise<boolean>;onRemove:(id:string)=>Promise<boolean>;
  onDiscard:()=>Promise<boolean>;onSubmit:(verdict:string,body:string)=>Promise<boolean>;
}) {
  const [summary,setSummary]=useState(""),[verdict,setVerdict]=useState("COMMENT"),[discard,setDiscard]=useState(false);
  return <section id="pending-review" className={styles.pendingReview} aria-label="Your pending review" tabIndex={-1}>
    <header><h3>Finish your review <span>{draft.comments.length} pending {draft.comments.length===1?"comment":"comments"}</span></h3><p>Only you can see these comments until you submit your review.</p></header>
    {stale&&<p role="status">The pull request changed since you started. Your comments remain private on {draft.commit.slice(0,7)}. Discard this review to start on the latest diff.</p>}
    {!open&&<p role="status">This pull request is no longer open. Your pending feedback remains private.</p>}
    <div className={styles.pendingList}>{draft.comments.map(comment=><PendingComment key={comment.id} comment={comment} busy={busy} onEdit={body=>onEdit(comment.id,body)} onRemove={()=>onRemove(comment.id)}/>)}</div>
    {ownPull?<p>You can comment on your own pull request. Another reviewer must approve it or request changes.</p>:feedbackOnly&&<p>Your review is feedback only. Required approvals need write access; unresolved conversations can still block merging.</p>}
    <form onSubmit={event=>{event.preventDefault();void onSubmit(verdict,summary);}}>
      <label className={styles.summaryLabel}>Review summary<textarea className={field} value={summary} onChange={e=>setSummary(e.target.value)} disabled={busy} rows={3} maxLength={16000} placeholder="Summarize your feedback"/></label>
      <div className={styles.pendingActions}><select className={field} aria-label="Pending review decision" value={verdict} disabled={busy||stale||!open} onChange={e=>setVerdict(e.target.value)}><option value="COMMENT">Comment</option><option value="APPROVE" disabled={ownPull}>{feedbackOnly?'Approve · feedback only':'Approve'}</option><option value="REQUEST_CHANGES" disabled={ownPull}>{feedbackOnly?'Request changes · feedback only':'Request changes'}</option></select><Button type="submit" variant="primary" disabled={busy||stale||!open||verdict==='COMMENT'&&!draft.comments.length&&!summary.trim()}>{busy?"Working…":"Submit pending review"}</Button><Button id="discard-review-trigger" disabled={busy} onClick={()=>setDiscard(true)}>Discard review</Button></div>
    </form>
    {discard&&<div className={styles.discard} role="group" aria-label="Confirm discard review"><p>Discard all {draft.comments.length} pending comments? Published reviews stay unchanged.</p><Button disabled={busy} onClick={()=>void onDiscard()}>Discard pending comments</Button><Button autoFocus disabled={busy} onClick={()=>{setDiscard(false);document.getElementById("discard-review-trigger")?.focus();}}>Keep reviewing</Button></div>}
  </section>;
}
function PendingComment({comment,busy,onEdit,onRemove}:{comment:PullComment;busy:boolean;onEdit:(body:string)=>Promise<boolean>;onRemove:()=>Promise<boolean>}) {
  const [editing,setEditing]=useState(false),[body,setBody]=useState(comment.body);
  return <article className={styles.pendingComment} id={`pending-comment-${comment.id}`} tabIndex={-1} aria-label={`Pending comment on ${comment.path} lines ${comment.startLine}–${comment.line}`}>
    <header><code>{comment.path}</code><span>{comment.side==="LEFT"?"Before":"After"} · L{comment.startLine}{comment.line!==comment.startLine?`–${comment.line}`:""} · Pending</span></header>
    {editing?<form onSubmit={async event=>{event.preventDefault();if(await onEdit(body))setEditing(false);}}><textarea className={field} aria-label="Edit pending comment" autoFocus rows={3} maxLength={16000} value={body} disabled={busy} onChange={e=>setBody(e.target.value)}/><footer><Button type="submit" size="sm" disabled={busy||!body.trim()}>Save pending comment</Button><Button size="sm" disabled={busy} onClick={()=>{setBody(comment.body);setEditing(false);}}>Cancel edit</Button></footer></form>:<><p>{comment.body}</p><footer><Button size="sm" disabled={busy} onClick={()=>{setBody(comment.body);setEditing(true);}}>Edit pending comment</Button><Button size="sm" disabled={busy} onClick={()=>void onRemove()}>Remove pending comment</Button></footer></>}
  </article>;
}
