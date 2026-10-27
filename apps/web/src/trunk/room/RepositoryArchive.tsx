"use client";
import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {Archive} from 'lucide-react';
import type {ArchiveState} from '@swarm/api/review';
import {api,trunkPath} from '@/lib/api';
import {Button} from '@/components/controls';
import {Card} from '@/components/ui';
import {field} from '../review/shared';
import {useTrunk} from '../context';
type State=ArchiveState&{readOnly:boolean;canManage:boolean;confirmation:string};
export function RepositoryArchive({trunk}:{trunk:string}) {
  const [data,setData]=useState<State|null>(null),[confirming,setConfirming]=useState(false),[name,setName]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const router=useRouter(),context=useTrunk(),path=`${trunkPath(trunk)}/archive`,input=useRef<HTMLInputElement>(null),result=useRef<HTMLParagraphElement>(null),trigger=useRef<HTMLButtonElement>(null);
  useEffect(()=>{let active=true;void api<State>(path).then(value=>{if(active)setData(value);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[path,context.archive?.revision,context.archive?.transition?.id]);
  useEffect(()=>{if(confirming)input.current?.focus();},[confirming]);
  useEffect(()=>{if(error||notice)result.current?.focus();},[error,notice]);
  useEffect(()=>{if(data&&window.location.hash==='#repository-archive')document.getElementById('repository-archive')?.scrollIntoView({block:'start'});},[data]);
  if(!data&&!error)return <section id="repository-archive" aria-busy className="p-5 text-sm text-muted">Loading archive settings…</section>;
  const target=data?.transition?.archived??!data?.archived;
  async function save(){
    if(!data||busy||name!==data.confirmation)return;setBusy(true);setError('');setNotice('');
    try{const next=await api<State>(path,{body:{archived:target,revision:data.revision,confirmation:name}});setData(next);setConfirming(false);setName('');setNotice(next.archived?'Repository archived. Existing members can still read and clone.':'Repository unarchived. Branch protections remain in force.');context.refreshArchive?.();router.refresh();}
    catch(e){setError((e as Error).message);try{setData(await api<State>(path));context.refreshArchive?.();}catch{}}
    finally{setBusy(false);}
  }
  return <section id="repository-archive"><Card className="space-y-4 p-5">
    <h2 className="flex items-center gap-2 text-lg font-semibold"><Archive size={18} aria-hidden/>{data?.transition?data.transition.archived?'Archiving repository':'Unarchiving repository':data?.archived?'Archived repository':'Archive repository'}</h2>
    <p className="max-w-2xl text-sm leading-6 text-muted">{data?.archived?'This repository is read-only. Code, issues, pull requests, releases and repository permissions are preserved.':'Make the repository read-only for everyone, including owners, admins and agents. Existing members can still browse and clone.'}</p>
    {data?.transition&&<p className="max-w-2xl text-sm leading-6">{data.transition.committed?'Unarchiving is committed, but some write paths have not reactivated.':'The archive operation did not finish. New writes remain paused.'} Retry the same operation to complete it.</p>}
    {data&&!data.canManage&&<p className="text-xs text-muted">Only a repository owner or admin can change this state.</p>}
    {(error||notice)&&<p ref={result} tabIndex={-1} role={error?'alert':'status'} className={`break-words text-sm outline-none ${error?'text-critical':''}`}>{error||notice}</p>}
    {data?.canManage&&!confirming&&<Button ref={trigger} disabled={busy} onClick={()=>{setConfirming(true);setError('');setNotice('');}}>{data.transition?`Retry ${target?'archive':'unarchive'}`:target?'Archive repository':'Unarchive repository'}</Button>}
    {data?.canManage&&confirming&&<form className="max-w-2xl space-y-4 border-t border-line pt-4" onSubmit={event=>{event.preventDefault();void save();}}>
      <p className="text-sm leading-6">{target?'Archiving cancels queued, running and waiting Actions runs, and pauses workload secret reads. Deployments already sent to external services may still finish. Cloudflare keeps the saved secret values. You can unarchive later.':'Unarchiving enables repository writes again. Branch protection stays in force. Cancelled Actions runs require an explicit rerun.'}</p>
      <label className="block space-y-2 text-sm">Type <strong className="break-all">{data.confirmation}</strong> to {target?'archive':'unarchive'}<input ref={input} className={field} value={name} onChange={event=>setName(event.target.value)} autoComplete="off" spellCheck={false} disabled={busy} required/></label>
      <div className="flex flex-wrap gap-3"><Button type="submit" variant="primary" disabled={busy||name!==data.confirmation}>{busy?'Saving…':target?'Confirm archive repository':'Confirm unarchive repository'}</Button><Button disabled={busy} onClick={()=>{setConfirming(false);setName('');setError('');trigger.current?.focus();}}>Cancel</Button></div>
    </form>}
  </Card></section>;
}
