"use client";
import {useState} from "react";
import {GitMerge} from "lucide-react";
import type {MergeMethod} from "@swarm/api/review";
import {Button} from "@/components/controls";
import {field} from "./shared";

const choices:Record<MergeMethod,{name:string;description:string;button:string}>={
  "fast-forward":{name:"Fast-forward",description:"Move the target to the reviewed head without creating a commit.",button:"Merge pull request"},
  merge:{name:"Merge commit",description:"Keep the feature history and add a merge commit.",button:"Merge pull request"},
  squash:{name:"Squash and merge",description:"Combine the changes into one new commit.",button:"Squash and merge"},
  rebase:{name:"Rebase and merge",description:"Rewrite a linear feature history as new commits on the target.",button:"Rebase and merge"},
};
const input=field.replace("text-sm","text-base sm:text-sm");
export function MergeAction({methods,disabled,busy,signedRequired,readOnly=false,onMerge}:{methods:MergeMethod[];disabled:boolean;busy:boolean;signedRequired:boolean;readOnly?:boolean;onMerge:(method:MergeMethod,message?:string)=>void}) {
  const [method,setMethod]=useState<MergeMethod>("fast-forward"),[message,setMessage]=useState("");
  const selected=choices[method],generated=method!=="fast-forward",canMessage=method==="merge"||method==="squash";
  return <div className="w-full space-y-3">
    {methods.length>1&&<div className="max-w-xl space-y-2">
      <label htmlFor="pull-merge-method" className="block text-sm font-medium text-ink">Merge method</label>
      <select id="pull-merge-method" value={method} disabled={busy||readOnly} aria-describedby="pull-merge-description" onChange={event=>setMethod(event.target.value as MergeMethod)} className={input}>{methods.map(value=><option key={value} value={value} disabled={signedRequired&&value!=="fast-forward"}>{choices[value].name}</option>)}</select>
      <p id="pull-merge-description" className="text-sm leading-6 text-muted">{selected.description}</p>
      {signedRequired&&<p className="text-sm leading-6 text-muted">Signed commits are required. Fast-forward preserves the existing signatures.</p>}
      {canMessage&&<details className="text-sm"><summary className="cursor-pointer text-series-1">Edit commit message</summary><label htmlFor="pull-merge-message" className="mb-2 mt-3 block text-sm font-medium text-ink">Commit message (optional)</label><textarea id="pull-merge-message" className={input} rows={4} maxLength={16000} value={message} disabled={busy||readOnly} onChange={event=>setMessage(event.target.value)} placeholder="Use the pull request’s default message" /></details>}
    </div>}
    <Button className="h-auto min-h-11 max-w-full whitespace-normal py-2 text-base sm:min-h-8 sm:py-1.5 sm:text-sm" variant="primary" disabled={disabled||busy||readOnly||!methods.includes(method)||generated&&signedRequired} onClick={()=>onMerge(method,canMessage&&message.trim()?message:undefined)}><GitMerge size={14}/>{busy?"Working…":selected.button}</Button>
  </div>;
}
