"use client";
import { useState } from "react";
import type { PullComment } from "@swarm/api/review";
import { suggestionText } from "@swarm/api/review";
import { Button } from "@/components/controls";
import { field } from "./shared";
import styles from "./PullFiles.module.css";

export function ApplySuggestions({comments,busy,onApply,onCancel}:{comments:PullComment[];busy:boolean;onApply:(message:string)=>Promise<boolean>;onCancel:()=>void}) {
  const [message,setMessage]=useState(comments.length===1?"Apply review suggestion":"Apply review suggestions");
  return <section className={styles.application} id="apply-suggestions" tabIndex={-1} aria-label="Commit selected suggestions">
    <h3>Commit {comments.length===1?"suggestion":`${comments.length} suggestions`}</h3>
    <p>Creates one commit on this pull request’s branch. Matching branch and repository rules still apply.</p>
    <ul>{comments.map(comment=>{const lines=suggestionText(comment.body)?.lines;return <li key={comment.id}><code>{comment.path}:L{comment.startLine}{comment.startLine!==comment.line?`–${comment.line}`:""}</code><pre>{lines?.length?lines.join("\n")||"Replace with one blank line":"Remove selected lines"}</pre></li>;})}</ul>
    <form onSubmit={event=>{event.preventDefault();void onApply(message);}}><label>Commit message<input autoFocus className={field} maxLength={200} value={message} onChange={event=>setMessage(event.target.value)} disabled={busy}/></label><footer><Button type="submit" variant="primary" disabled={busy||!message.trim()}>{busy?"Committing…":comments.length===1?"Commit suggestion":"Commit suggestions"}</Button><Button disabled={busy} onClick={onCancel}>Cancel application</Button></footer></form>
  </section>;
}
