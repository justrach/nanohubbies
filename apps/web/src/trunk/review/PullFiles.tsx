"use client";

import {useTrunk} from "../context";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import type { PullComment, PullDiscussion, PendingReview as Draft, PendingResult,SuggestionApplication } from "@swarm/api/review";
import { api, trunkPath } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/controls";
import { HunkReview } from "@/components/issues/review/HunkReview";
import { ReviewThread } from "@/components/issues/review/ReviewThread";
import type { CodeAnchor } from "@/components/issues/review/types";
import type { ChangedFile } from "../types";
import { Notice } from "./shared";
import styles from "./PullFiles.module.css";
import { PendingReview } from "./PendingReview";
import { ApplySuggestions } from "./ApplySuggestions";

/** One bounded file at a time; discussions always retain their original diff. */
export function PullFiles({ trunk, pull, commit, anchor, files, initial, initialPending, open,git }: {
  trunk:string; pull:number; commit:string; anchor:string; files:ChangedFile[]; initial:PullDiscussion; initialPending:Draft|null; open:boolean;git:boolean;
}) {
  const router = useRouter(), { user } = useSession();
  const [path, setPath] = useState(files[0]?.path ?? "");
  const [discussion, setDiscussion] = useState(initial);
  const [draft,setDraft]=useState(initialPending);
  const draftId=useRef(crypto.randomUUID());
  const pendingRetry=useRef<{key:string;id:string}|null>(null);
  const submitRetry=useRef<{reviewId:string;revision:number;commit:string;anchor:string;verdict:string;body:string}|null>(null);
  const [status,setStatus]=useState("");
  const [selectedSuggestions,setSelectedSuggestions]=useState<Set<string>>(new Set()),[showApplication,setShowApplication]=useState(false);
  const applicationRetry=useRef<{key:string;id:string}|null>(null);
  const [viewed, setViewed] = useState<Set<string>>(new Set());
  const [showEarlier, setShowEarlier] = useState(initial.comments.some(c=>!c.replyTo&&!c.resolved&&(c.commit!==commit||c.anchor!==anchor)));
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [focusThread, setFocusThread] = useState<string|null>(null);
  const lock = useRef(false), retry = useRef<{key:string;id:string}|null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const failure = useRef<HTMLDivElement>(null);
  useEffect(() => setDiscussion(initial), [initial]);
  useEffect(()=>setDraft(initialPending),[initialPending]);
  useEffect(() => {
    if (focusThread) { const element=document.getElementById(focusThread);if(element){element.focus();setFocusThread(null);} }
  }, [discussion, focusThread]);
  useEffect(() => { setViewed(new Set()); }, [commit, anchor]);
  useEffect(()=>{setSelectedSuggestions(new Set());setShowApplication(false);},[commit,anchor]);
  useEffect(() => { if (initial.comments.some(c=>!c.replyTo&&!c.resolved&&(c.commit!==commit||c.anchor!==anchor))) setShowEarlier(true); }, [commit, anchor, initial]);
  useEffect(() => { if (error) { failure.current?.focus(); failure.current?.scrollIntoView({block:"nearest"}); } }, [error]);
  const file = files.find(f => f.path === path) ?? files[0];
  const at = file ? files.indexOf(file) : -1;
  const {readOnly}=useTrunk();
  const canComment = !readOnly && !!user && !!discussion.canComment && open;
  const current = (c:PullComment) => c.commit === commit && c.anchor === anchor;
  const outdated = discussion.comments.filter(c => !c.replyTo && !current(c));
  const unresolved = discussion.comments.filter(c => !c.replyTo && !c.resolved).length;
  async function mutate(body:Record<string,unknown>, method="POST") {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError("");
    try {
      setDiscussion(await api<PullDiscussion>(`${trunkPath(trunk)}/pulls/${pull}/comments`,{method,body:{commit,anchor,...body}}));
      router.refresh(); return true;
    } catch(e) { setError((e as Error).message); return false; }
    finally { lock.current = false; setBusy(false); }
  }
  async function post(selection:CodeAnchor, body:string, replyTo?:string) {
    const key = JSON.stringify([commit,anchor,selection,body,replyTo]);
    if (retry.current?.key !== key) retry.current = {key,id:crypto.randomUUID()};
    const ok = await mutate(replyTo ? {id:retry.current.id,body,replyTo} : {path:selection.path,side:selection.side,startLine:selection.startLine,line:selection.line,id:retry.current.id,body});
    if (ok) { setFocusThread(`code-thread-${replyTo??retry.current!.id}`); retry.current = null; }
    return ok;
  }
  async function resolve(root:PullComment) { if (await mutate({id:root.id,resolved:!root.resolved},"PATCH")) setFocusThread(`code-thread-${root.id}`); }
  async function changeDraft(body:Record<string,unknown>,method="POST") {
    if(lock.current)return false;
    lock.current=true;setBusy(true);setError("");setStatus("");
    try {
      const result=await api<PendingResult>(`${trunkPath(trunk)}/pulls/${pull}/pending-review`,{method,body:{reviewId:draft?.id??draftId.current,revision:draft?.revision??0,...body}});
      setDraft(result.pending);router.refresh();return true;
    }catch(e){setError((e as Error).message);return false;}finally{lock.current=false;setBusy(false);}
  }
  async function addPending(selection:CodeAnchor,body:string) {
    const key=JSON.stringify([commit,anchor,selection,body]);
    if(pendingRetry.current?.key!==key)pendingRetry.current={key,id:crypto.randomUUID()};
    const id=pendingRetry.current.id,ok=await changeDraft({commit,anchor,comment:{id,path:selection.path,side:selection.side,startLine:selection.startLine,line:selection.line,body}});
    if(ok){pendingRetry.current=null;setFocusThread(`pending-comment-${id}`);setStatus("Comment added to your private pending review.");}
    return ok;
  }
  async function submitDraft(verdict:string,body:string) {
    if(!draft||lock.current)return false;
    const next={reviewId:draft.id,revision:draft.revision,commit,anchor,verdict,body};
    if(JSON.stringify(submitRetry.current)!==JSON.stringify(next))submitRetry.current=next;
    lock.current=true;setBusy(true);setError("");
    try {
      const result=await api<{reviewId:number}>(`${trunkPath(trunk)}/pulls/${pull}/pending-review/submit`,{body:submitRetry.current});
      setDraft(null);draftId.current=crypto.randomUUID();submitRetry.current=null;router.refresh();setStatus("Review submitted. Your inline comments are now visible to collaborators.");
      setFocusThread(`review-${result.reviewId}`);return true;
    }catch(e){setError((e as Error).message);return false;}finally{lock.current=false;setBusy(false);}
  }
  function pick(next:string) { setPath(next); panel.current?.scrollTo({top:0}); }
  function chooseSuggestion(comment:import("@/components/issues/review/types").CodeComment,single:boolean) {
    if(single){setSelectedSuggestions(new Set([comment.id]));setShowApplication(true);setFocusThread("apply-suggestions");return;}
    setSelectedSuggestions(previous=>{const next=new Set(previous);if(next.has(comment.id))next.delete(comment.id);else if(next.size<50)next.add(comment.id);return next;});setShowApplication(false);
  }
  async function applySelected(message:string) {
    if(lock.current||!selectedSuggestions.size)return false;
    const commentIds=[...selectedSuggestions].sort(),key=JSON.stringify([commit,anchor,commentIds,message]);
    if(applicationRetry.current?.key!==key)applicationRetry.current={key,id:crypto.randomUUID()};
    lock.current=true;setBusy(true);setError("");
    try {
      const result=await api<{application:SuggestionApplication}>(`${trunkPath(trunk)}/pulls/${pull}/suggestions/apply`,{body:{id:applicationRetry.current.id,commit,anchor,commentIds,message}});
      applicationRetry.current=null;setSelectedSuggestions(new Set());setShowApplication(false);setStatus(`Applied ${commentIds.length} ${commentIds.length===1?"suggestion":"suggestions"} in commit ${result.application.commit.slice(0,7)}.`);router.refresh();setFocusThread("pull-files");return true;
    }catch(e){setError((e as Error).message);return false;}finally{lock.current=false;setBusy(false);}
  }
  const counts = new Map<string,number>();
  const pendingCounts=new Map<string,number>();
  for(const c of draft?.comments??[])pendingCounts.set(c.path,(pendingCounts.get(c.path)??0)+1);
  for (const c of discussion.comments) if (!c.replyTo && !c.resolved) counts.set(c.path,(counts.get(c.path)??0)+1);
  return <section id="pull-files" aria-label="Pull request code review" className={styles.review} tabIndex={-1}>
    <header className={styles.heading}>
      <div><h2>Files changed <span>{files.length}</span></h2><p>{viewed.size} of {files.length} viewed · {unresolved} open {unresolved===1?"thread":"threads"}</p></div>
      <a href={draft?"#pending-review":"#pull-review-decision"}>{draft?`Finish review (${draft.comments.length})`:"Finish review"}</a>
    </header>
    {status&&<p role="status" className={styles.feedback}>{status}</p>}
    {draft&&<p className={styles.privateNotice}>{draft.comments.length} pending {draft.comments.length===1?"comment":"comments"} · Only visible to you until you submit.</p>}
    {!!selectedSuggestions.size&&!showApplication&&<div className={styles.batch}><span>{selectedSuggestions.size} suggestions selected</span><Button size="sm" disabled={busy} onClick={()=>{setShowApplication(true);setFocusThread("apply-suggestions");}}>Review selected suggestions</Button><Button size="sm" disabled={busy} onClick={()=>setSelectedSuggestions(new Set())}>Clear selection</Button></div>}
    {showApplication&&selectedSuggestions.size>0&&<ApplySuggestions key={[...selectedSuggestions].sort().join(",")} comments={discussion.comments.filter(comment=>selectedSuggestions.has(comment.id))} busy={busy} onApply={applySelected} onCancel={()=>{setShowApplication(false);setFocusThread("pull-files");}}/>}
    {error&&<div ref={failure} tabIndex={-1}><Notice error={error}/><Button size="sm" onClick={()=>router.refresh()}>Refresh diff</Button></div>}
    {!files.length ? <p className={styles.empty}>No file changes to review.</p> : <div className={styles.frame}>
      <div className={styles.toolbar}>
        <label>Changed file<select aria-label="Select changed file" value={file.path} disabled={busy} onChange={e=>pick(e.target.value)}>
          {files.map(f=><option key={f.path} value={f.path}>{viewed.has(f.path)?"Viewed · ":""}{f.path}{counts.has(f.path)?` · ${counts.get(f.path)} open`:""}{pendingCounts.has(f.path)?` · ${pendingCounts.get(f.path)} pending`:""}</option>)}
        </select></label>
        <div className={styles.navigation}>
          <span>{at+1} / {files.length}</span>
          <Button size="sm" aria-label="Previous file" disabled={busy||at<=0} onClick={()=>pick(files[at-1].path)}><ChevronLeft size={14}/></Button>
          <Button size="sm" aria-label="Next file" disabled={busy||at>=files.length-1} onClick={()=>pick(files[at+1].path)}><ChevronRight size={14}/></Button>
        </div>
      </div>
      <div className={styles.fileHeader}>
        <code>{file.previous ? `${file.previous} → `:""}{file.path}</code>
        <span>{file.status} · +{file.additions} −{file.deletions}</span>
        <label><input type="checkbox" checked={viewed.has(file.path)} onChange={()=>setViewed(previous=>{const next=new Set(previous);if(next.has(file.path))next.delete(file.path);else next.add(file.path);return next;})}/>Viewed</label>
        <a href={`/t/${trunk}/pulls/${pull}/file?${new URLSearchParams({path:file.path,side:file.status==="removed"?"base":"head"})}`} aria-label="Open full file"><ExternalLink size={14}/></a>
      </div>
      <div ref={panel} className={styles.panel} tabIndex={0} aria-label={`Diff for ${file.path}`}>
        <HunkReview key={`${user?.id}:${commit}:${anchor}:${file.path}`} file={file} draftKey={`${user?.id??"guest"}:${trunk}:pull:${pull}:${commit}:${anchor}:${file.path}`} comments={discussion.comments.filter(c=>c.path===file.path&&current(c))} canComment={canComment} pending={busy} onComment={post} onPendingComment={addPending} pendingLabel={draft?"Add to review":"Start a review"} onResolve={root=>resolve(root as PullComment)} onChooseSuggestion={git&&canComment?chooseSuggestion:undefined} selectedSuggestions={selectedSuggestions}/>
      </div>
    </div>}
    {draft&&<fieldset disabled={readOnly} className="min-w-0"><PendingReview key={draft.id} draft={draft} busy={busy} stale={draft.commit!==commit||draft.anchor!==anchor} open={open} onEdit={async(id,body)=>{const ok=await changeDraft({commentId:id,body},"PATCH");if(ok)setFocusThread(`pending-comment-${id}`);return ok;}} onRemove={async id=>{const ok=await changeDraft({commentId:id},"DELETE");if(ok)setFocusThread("pending-review");return ok;}} onDiscard={async()=>{const ok=await changeDraft({},"DELETE");if(ok){draftId.current=crypto.randomUUID();setStatus("Pending review discarded.");setFocusThread("pull-files");}return ok;}} onSubmit={submitDraft}/></fieldset>}
    {outdated.length>0 && <details className={styles.outdated} open={showEarlier} onToggle={event=>setShowEarlier(event.currentTarget.open)}>
      <summary>Earlier revisions · {outdated.length} {outdated.length===1?"thread":"threads"}</summary>
      <p>These comments refer to their original code. Unresolved threads still count toward conversation protection.</p>
      {outdated.map(root=><section key={root.id} className={styles.oldThread} aria-label={`Earlier thread on ${root.path}`}>
        <header><code>{root.path}</code><span>{root.commit.slice(0,7)} · base {root.anchor.slice(0,7)}</span></header>
        {root.excerpt && <details><summary>Show original hunk</summary><pre>{root.excerpt}</pre></details>}
        <ReviewThread root={root} replies={discussion.comments.filter(c=>c.replyTo===root.id)} canComment={canComment} pending={busy} onReply={body=>post(root,body,root.id)} onResolve={()=>resolve(root)}/>
      </section>)}
    </details>}
    {discussion.truncated&&<p role="status">More comments exist than this page can display. Conversation protection checks every thread.</p>}
  </section>;
}
