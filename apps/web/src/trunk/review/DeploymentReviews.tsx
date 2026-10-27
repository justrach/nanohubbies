"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {Clock} from 'lucide-react';
import type {DeploymentRequestStatus} from '@swarm/api/review';
import {api,trunkPath} from '@/lib/api';
import {Button} from '@/components/controls';
import {field} from './shared';
type Page={requests:DeploymentRequestStatus[];nextCursor:number|null};
export function DeploymentReviews({trunk,onChange}:{trunk:string;onChange:()=>void}) {
 const [page,setPage]=useState<Page|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const noticeRef=useRef<HTMLParagraphElement>(null),path=`${trunkPath(trunk)}/deployment-requests`,epoch=useRef(0);
 const load=useCallback(async()=>{const version=++epoch.current;try{const value=await api<Page>(path);if(version===epoch.current){setPage(value);setError('');}}catch(e){if(version===epoch.current)setError((e as Error).message);}},[path]);
 useEffect(()=>{void load();const timer=setInterval(()=>{if(!document.hidden)void load();},10000);return()=>{clearInterval(timer);epoch.current++;};},[load]);
 useEffect(()=>{if(notice)noticeRef.current?.focus();},[notice]);
 async function review(request:DeploymentRequestStatus,form:HTMLFormElement,decision:'approve'|'reject') {
  if(busy)return;setBusy(true);setError('');setNotice('');
  try{await api(`${path}/${request.id}/reviews`,{body:{decision,comment:String(new FormData(form).get('comment')??''),revision:request.revision}});setNotice(`Deployment to ${request.environment} ${decision==='approve'?'approved':'rejected'}.`);await load();onChange();}
  catch(e){await load();setError((e as Error).message);}finally{setBusy(false);}
 }
 if(page&&!page.requests.length&&!error)return null;
 return <section aria-labelledby="deployment-reviews-title" className="space-y-3 border-y border-line py-5">
  <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="deployment-reviews-title" className="flex items-center gap-2 text-base font-semibold"><Clock size={17} aria-hidden/>Deployment reviews</h2><Button size="sm" disabled={busy} onClick={()=>void load()}>Refresh deployments</Button></div>
  {error&&<p role="alert" className="break-words text-sm text-critical">{error}</p>}
  {notice&&<p ref={noticeRef} tabIndex={-1} role="status" className="text-sm outline-none">{notice}</p>}
  {!page&&!error&&<p role="status" className="text-sm text-muted">Loading deployment requests…</p>}
  <ol className="divide-y divide-line">{page?.requests.map(request=><li key={request.id} className="min-w-0 space-y-3 py-4">
   <div className="flex flex-wrap justify-between gap-2 text-sm"><strong className="break-words">{request.environment}</strong><span className="text-muted">{request.state==='waiting'?'Waiting for deployment':request.state==='ready'?'Ready for runner':request.state==='running'?'Deployment authorized':request.state==='complete'?'Run completed':request.state==='rejected'?'Rejected':'Request expired'}</span></div>
   <p className="break-all text-xs leading-5 text-muted">{request.ref?.startsWith('refs/tags/')?'Tag':'Branch'} <code>{request.branch}</code> · commit <code>{request.head.slice(0,12)}</code> · base <code>{request.base.slice(0,12)}</code> · environment revision {request.environmentRevision}</p>
   {request.reason&&<p className="text-sm">{request.reason}.</p>}
   {request.waitUntil>request.createdAt&&<p className="text-xs text-muted">Timer ends <time dateTime={new Date(request.waitUntil).toISOString()}>{new Date(request.waitUntil).toLocaleString()}</time>. No sandbox runs during the wait.</p>}
   {!!request.reviews.length&&<ul className="space-y-2">{request.reviews.map(vote=><li key={vote.actor} className="break-words text-xs leading-5"><span className="break-all">{vote.actor}</span> {vote.decision==='approve'?'approved':'rejected'}{vote.comment&&<p className="whitespace-pre-wrap text-sm text-muted">{vote.comment}</p>}</li>)}</ul>}
   {request.canReview&&<form className="max-w-2xl space-y-3" onSubmit={event=>{event.preventDefault();const decision=(event.nativeEvent as SubmitEvent).submitter?.getAttribute('value');if(decision==='approve'||decision==='reject')void review(request,event.currentTarget,decision);}}>
    <label className="block space-y-1 text-sm">Review comment (optional)<textarea className={`${field} min-h-20`} name="comment" maxLength={16000} disabled={busy}/></label>
    {!request.canApprove&&<p className="text-xs text-muted">Self-approval is blocked. Another required reviewer must approve.</p>}
    <div className="flex flex-wrap gap-3"><Button type="submit" name="decision" value="approve" variant="primary" disabled={busy||!request.canApprove}>Approve deployment</Button><Button type="submit" name="decision" value="reject" disabled={busy}>Reject deployment</Button></div>
   </form>}
  </li>)}</ol>
  {page?.nextCursor&&<Button disabled={busy} onClick={async()=>{setBusy(true);try{const older=await api<Page>(`${path}?before=${page.nextCursor}`);setPage(value=>value?{requests:[...value.requests,...older.requests],nextCursor:older.nextCursor}:older);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>Load older deployments</Button>}
 </section>;
}
