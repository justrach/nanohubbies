"use client";

import {useCallback,useEffect,useId,useState} from 'react';
import {Check,Clock3} from 'lucide-react';
import type {ReviewRequests} from '@swarm/api/review';
import {api,trunkPath} from '@/lib/api';
import {Button} from '@/components/controls';
import {Card} from '@/components/ui';
import {field} from './shared';

export function RequestedReviewers({trunk,pull,commit,anchor,open,readOnly}:{trunk:string;pull:number;commit:string;anchor:string;open:boolean;readOnly:boolean}){
  const path=`${trunkPath(trunk)}/pulls/${pull}/requested-reviewers`;
  const reviewerField=useId();
  const [data,setData]=useState<ReviewRequests|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[editing,setEditing]=useState(false),[reviewer,setReviewer]=useState('');
  const load=useCallback(async()=>{const result=await api<ReviewRequests>(path);setData(result);},[path]);
  useEffect(()=>{let live=true;setData(null);setError('');api<ReviewRequests>(path).then(result=>{if(live)setData(result);}).catch(error=>{if(live)setError(error.message);});return()=>{live=false;};},[path,commit,anchor]);
  const manage=!!data?.canManage&&open&&!readOnly;
  const pending=new Set(data?.requests.filter(request=>request.state==='requested').map(request=>request.reviewer)??[]);
  const choices=data?.candidates?.filter(candidate=>!pending.has(candidate.id))??[];
  async function change(id:string,remove=false){
    if(!data||busy||!manage)return;
    setBusy(true);setError('');
    try{
      const response=await fetch(path,{method:remove?'DELETE':'POST',headers:{'Content-Type':'application/json','If-Match':`"review-requests-${data.revision}"`},body:JSON.stringify({reviewers:[id],revision:data.revision,commit,anchor})});
      const next=await response.json();
      if(!response.ok){if(response.status===412){await load();throw Error('Reviewers changed. The list is refreshed; check it before saving again.');}throw Error(next.error??'Could not update reviewers. Refresh the list before trying again.');}
      setData({...data,...next});setEditing(false);setReviewer('');
      try{await load();}catch{setError('Your change was saved. Refresh reviewers to check current access.');}
    }catch(error){setError(error instanceof TypeError?'The response was lost. Refresh reviewers before trying again.':(error as Error).message);}
    finally{setBusy(false);}
  }
  return <Card className="min-w-0 space-y-4 p-5"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold text-ink">Reviewers</h2><Button size="sm" variant="ghost" disabled={busy} onClick={()=>{setError('');void load().catch(error=>setError(error.message));}}>Refresh reviewers</Button></div>
    {error&&<p role="alert" className="break-words text-sm text-ink">{error}</p>}
    {!data&&!error&&<p role="status" className="text-sm text-muted">Loading reviewers…</p>}
    {data&&<>
      {!data.requests.some(request=>request.state!=='removed')&&<p className="text-sm text-muted">No review requested.</p>}
      <ul aria-label="Review requests" className="max-h-72 space-y-4 overflow-y-auto">{data.requests.filter(request=>request.state!=='removed').map(request=><li key={request.reviewer} className="min-w-0 space-y-1 text-sm">
        <div className="flex items-start gap-2">{request.state==='reviewed'?<Check size={16} className="mt-0.5 shrink-0 text-good-text" aria-hidden/>:<Clock3 size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden/>}<span className="min-w-0 break-all font-medium">{request.reviewer}</span></div>
        <p className="text-xs text-muted">{request.state==='reviewed'?<a className="underline underline-offset-2" href={`#review-${request.reviewId}`}>Review submitted</a>:data.access?.[request.reviewer]==='no_write'?'No longer has repository access':data.access?.[request.reviewer]==='unavailable'?'Current access could not be checked':'Waiting for review'}</p>
        <p className="break-words text-xs text-muted">{data.access?.[request.reviewer]==='reader'?'Reader · feedback only. ':''}Requested by {request.requestedBy.name}{request.via?' via CLI':''}</p>
        {manage&&(request.state==='requested'?<Button size="sm" variant="ghost" disabled={busy} aria-label={`Remove review request for ${request.reviewer}`} onClick={()=>void change(request.reviewer,true)}>Remove request</Button>:(!data.directoryComplete||choices.some(candidate=>candidate.id===request.reviewer))&&<Button size="sm" variant="ghost" disabled={busy} onClick={()=>{setReviewer(request.reviewer);setEditing(true);}}>Request again</Button>)}
      </li>)}</ul>
      <p className="text-xs leading-5 text-muted">Requests ask for feedback. Branch protection decides which approvals are required.</p>
      {manage&&data.directoryComplete&&!choices.length&&<p className="text-xs leading-5 text-muted">{data.candidates?.length?'Every available reviewer already has a request.':<>No other repository members yet. <a className="underline underline-offset-2" href={`/t/${trunk}/people`}>Add collaborators</a> to request review.</>}</p>}
      {manage&&!editing&&<Button size="sm" disabled={busy||pending.size>=15||!!data.directoryComplete&&!choices.length} onClick={()=>setEditing(true)}>Request review</Button>}
      {manage&&editing&&<form className="space-y-3 border-t border-line pt-4" onSubmit={event=>{event.preventDefault();void change(reviewer);}}>
        <div className="space-y-1"><label htmlFor={reviewerField} className="block text-xs text-muted">Reviewer account ID</label>
          {data.candidates?.length?<select id={reviewerField} className={field} value={reviewer} onChange={event=>setReviewer(event.target.value)} required disabled={busy}><option value="">Choose a repository member</option>{choices.map(candidate=><option key={candidate.id} value={candidate.id}>{candidate.id} · {candidate.role==='reader'?'reader · feedback only':candidate.role}</option>)}</select>:<input id={reviewerField} className={field} value={reviewer} onChange={event=>setReviewer(event.target.value)} maxLength={256} required disabled={busy} placeholder="Account ID from repository access"/>}
        </div>
        <p className="text-xs leading-5 text-muted">Choose a repository member other than the PR author. Reader feedback does not count toward required approvals.</p>
        <div className="flex flex-wrap gap-2"><Button size="sm" type="submit" disabled={busy||!reviewer.trim()}>{busy?'Saving…':'Send request'}</Button><Button size="sm" variant="ghost" type="button" disabled={busy} onClick={()=>{setEditing(false);setReviewer('');}}>Cancel</Button></div>
      </form>}
    </>}
  </Card>;
}
