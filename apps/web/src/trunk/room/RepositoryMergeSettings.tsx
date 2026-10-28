"use client";
import {useEffect,useId,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import type {MergeMethod,MergeSettings} from '@swarm/api/review';
import {api,trunkPath} from '@/lib/api';
import {useSession} from '@/lib/session';
import {Button} from '@/components/controls';
import {Card} from '@/components/ui';
import {useTrunk} from '../context';
import {field} from '../review/shared';
import {mergeChoices,mergeChoiceOrder} from '../review/merge-choices';
import styles from '../review/MergeControls.module.css';
type Configuration=MergeSettings&{mode:'git'|'snapshot';canManage:boolean;readOnly:boolean};
export function RepositoryMergeSettings({trunk,canEdit}:{trunk:string;canEdit:boolean}) {
 const {readOnly}=useTrunk(),{user}=useSession(),router=useRouter(),id=useId();
 const path=trunkPath(trunk)+'/merge-settings',scope=`${trunk}/${user?.id??''}`;
 const [loaded,setLoaded]=useState<{scope:string;value:Configuration}|null>(null),[allowed,setAllowed]=useState<MergeMethod[]>([]),[defaultMethod,setDefault]=useState<MergeMethod|''>('fast-forward');
 const [busy,setBusy]=useState<'load'|'save'|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const generation=useRef(0),current=useRef(scope),lock=useRef(false),failure=useRef<HTMLParagraphElement>(null);current.current=scope;
 const data=loaded?.scope===scope?loaded.value:null,locked=readOnly||!!data?.readOnly;
 async function load(){
  const requested=scope,g=++generation.current;setBusy('load');setError('');setNotice('');
  try{const value=await api<Configuration>(path);if(current.current===requested&&g===generation.current){setLoaded({scope:requested,value});setAllowed(value.allowedMethods);setDefault(value.defaultMethod);}}
  catch(e){if(current.current===requested&&g===generation.current)setError((e as Error).message);}
  finally{if(current.current===requested&&g===generation.current)setBusy(null);}
 }
 useEffect(()=>{setLoaded(null);setError('');setNotice('');void load();return()=>{generation.current++;};},[scope,path]);
 useEffect(()=>{if(error)failure.current?.focus();},[error]);
 function toggle(method:MergeMethod,checked:boolean){
  const next=mergeChoiceOrder.filter(value=>value===method?checked:allowed.includes(value));
  setAllowed(next);setDefault(previous=>next.includes(previous as MergeMethod)?previous:next[0]??'');setNotice('');
 }
 const valid=allowed.length>0&&allowed.includes(defaultMethod as MergeMethod);
 const changed=!!data&&(JSON.stringify(allowed)!==JSON.stringify(data.allowedMethods)||defaultMethod!==data.defaultMethod);
 async function save(){
  if(!data||!canEdit||!data.canManage||locked||!valid||lock.current)return;
  lock.current=true;const requested=scope,g=++generation.current;setBusy('save');setError('');setNotice('');
  try{
   const result=await api<MergeSettings>(path,{method:'PUT',body:{allowedMethods:allowed,defaultMethod,revision:data.revision}});
   if(current.current===requested&&g===generation.current){setLoaded({scope:requested,value:{...data,...result}});setAllowed(result.allowedMethods);setDefault(result.defaultMethod);setNotice('Merge settings saved. Branch protections still apply.');router.refresh();}
  }catch(e){if(current.current===requested&&g===generation.current)setError((e as Error).message);}
  finally{lock.current=false;if(current.current===requested&&g===generation.current)setBusy(null);}
 }
 if(data?.mode==='snapshot')return null;
 return <Card className={`min-w-0 space-y-4 p-5 ${styles.controls}`}>
  <header className="space-y-2"><h2 className="text-lg font-semibold">Pull request merges</h2><p className="max-w-[70ch] text-sm leading-6 text-muted">Choose how contributors can merge pull requests. Branch protections, required reviews and checks still apply to every method.</p></header>
  {data?<>
   {canEdit&&data.canManage?<form className="space-y-5" onSubmit={event=>{event.preventDefault();void save();}}>
    <fieldset disabled={locked||!!busy} className="min-w-0 space-y-1">
     <legend className="mb-2 text-sm font-medium">Allowed merge methods</legend>
     {mergeChoiceOrder.map(method=><label key={method} className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm">
      <input type="checkbox" className="mt-1 size-4 shrink-0 accent-[var(--action)]" checked={allowed.includes(method)} onChange={event=>toggle(method,event.target.checked)} />
      <span className="min-w-0 space-y-1"><span className="block font-medium">{mergeChoices[method].name}</span><span className="block max-w-[70ch] leading-6 text-muted">{mergeChoices[method].description}</span></span>
     </label>)}
    </fieldset>
    <div className="max-w-xl space-y-2"><label htmlFor={id+'-default'} className="block text-sm font-medium">Default merge method</label>
     <select id={id+'-default'} className={`${field} ${styles.input}`} value={defaultMethod} disabled={locked||!!busy||!allowed.length} onChange={event=>{setDefault(event.target.value as MergeMethod);setNotice('');}} aria-describedby={id+'-help'}>
      {!allowed.length&&<option value="">Enable a merge method first</option>}{allowed.map(method=><option key={method} value={method}>{mergeChoices[method].name}</option>)}
     </select><p id={id+'-help'} className="text-sm leading-6 text-muted">Selected by default in pull request merge controls. Contributors can choose another allowed method.</p>
    </div>
    {!valid&&<p role="status" className="text-sm text-critical">Enable at least one merge method before saving.</p>}
    <div className="flex flex-wrap items-center gap-3"><Button type="submit" variant="primary" className="h-auto min-h-11 whitespace-normal py-2 sm:min-h-8" disabled={locked||!!busy||!valid||!changed}>{busy==='save'?'Saving…':'Save merge settings'}</Button><span className="text-sm text-muted">Saved default: {mergeChoices[data.defaultMethod].name}</span></div>
   </form>:<div className="space-y-2 text-sm"><p>Allowed methods: {data.allowedMethods.map(method=>mergeChoices[method].name).join(', ')}</p><p>Default: <strong>{mergeChoices[data.defaultMethod].name}</strong></p></div>}
  </>:!error&&<p role="status" className="text-sm text-muted">Loading merge settings…</p>}
  {error&&<p ref={failure} tabIndex={-1} role="alert" className="text-sm text-critical">{error}</p>}{notice&&<p role="status" className="text-sm leading-6">{notice}</p>}
  <Button size="sm" variant="ghost" disabled={!!busy} onClick={()=>void load()}>{busy==='load'?'Reloading…':'Reload merge settings'}</Button>
 </Card>;
}
