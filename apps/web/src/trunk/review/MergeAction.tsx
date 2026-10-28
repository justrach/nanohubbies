"use client";
import {useId,useState} from "react";
import {GitMerge} from "lucide-react";
import type {MergeMethod} from "@swarm/api/review";
import {Button} from "@/components/controls";
import {field} from "./shared";
import {mergeChoices as choices} from './merge-choices';
import styles from './MergeControls.module.css';

const input=field+' '+styles.input;
export function MergeAction({methods,defaultMethod='fast-forward',disabled,busy,signedRequired,readOnly=false,permissionDenied=false,onMerge}:{methods:MergeMethod[];defaultMethod?:MergeMethod;disabled:boolean;busy:boolean;signedRequired:boolean;readOnly?:boolean;permissionDenied?:boolean;onMerge:(method:MergeMethod,message?:string)=>void}) {
  const available=methods.filter(method=>!signedRequired||method==='fast-forward'),preferred=available.includes(defaultMethod)?defaultMethod:available[0];
  const [selection,setMethod]=useState<MergeMethod|undefined>(preferred),[message,setMessage]=useState(''),id=useId();
  const method=selection&&available.includes(selection)?selection:preferred;
  if(!method)return <p role="status" className="max-w-[70ch] text-sm leading-6 text-muted">{signedRequired?'Signed commits are required, but no allowed merge method preserves the existing signatures.':'No merge method is available under the repository and branch rules.'} Ask a repository admin to review the merge settings and protections.</p>;
  const selected=choices[method],generated=method!=="fast-forward",canMessage=method==="merge"||method==="squash";
  return <div className={`w-full space-y-3 ${styles.controls}`}>
    <div className="max-w-xl space-y-2">
      {available.length>1?<><label htmlFor={id+'-method'} className="block text-sm font-medium text-ink">Merge method</label>
      <select id={id+'-method'} value={method} disabled={busy||readOnly} aria-describedby={id+'-description'} onChange={event=>setMethod(event.target.value as MergeMethod)} className={input}>{available.map(value=><option key={value} value={value}>{choices[value].name}{value===defaultMethod?' (default)':''}</option>)}</select></>:<p className="text-sm font-medium">{selected.name}</p>}
      <p id={id+'-description'} className="text-sm leading-6 text-muted">{selected.description}</p>
      {signedRequired&&<p className="text-sm leading-6 text-muted">Signed commits are required. Fast-forward preserves the existing signatures.</p>}
      {canMessage&&<details className="text-sm"><summary className="cursor-pointer text-series-1">Edit commit message</summary><label htmlFor={id+'-message'} className="mb-2 mt-3 block text-sm font-medium text-ink">Commit message (optional)</label><textarea id={id+'-message'} className={input} rows={4} maxLength={16000} value={message} disabled={busy||readOnly} onChange={event=>setMessage(event.target.value)} placeholder="Use the pull request’s default message" /></details>}
    </div>
    <Button className="h-auto min-h-11 max-w-full whitespace-normal py-2 text-base sm:min-h-8 sm:py-1.5 sm:text-sm" variant="primary" disabled={disabled||busy||readOnly||!methods.includes(method)||generated&&signedRequired} onClick={()=>onMerge(method,canMessage&&message.trim()?message:undefined)}><GitMerge size={14}/>{busy?"Working…":selected.button}</Button>
    {permissionDenied&&<p className="text-sm leading-6 text-muted">Your repository role does not allow merging.</p>}
  </div>;
}
