"use client";
import { useEffect, useId, useRef } from "react";
import type { MetadataRule } from "@swarm/api/review";
import { Button } from "@/components/controls";
import { field } from "./shared";

export interface MetadataDraft { id:number; rule:MetadataRule }
export const metadataFields = [
  ["commit_message_pattern","Commit message"],
  ["commit_author_email_pattern","Author email"],
  ["committer_email_pattern","Committer email"],
  ["branch_name_pattern","Branch name"],
  ["tag_name_pattern","Tag name"],
] as const;

export function MetadataRules({target,rows,onChange,onAdd,disabled,limit}:{target:"branch"|"tag";rows:MetadataDraft[];onChange:(rows:MetadataDraft[])=>void;onAdd:()=>void;disabled:boolean;limit:number}) {
  const uid=useId(),fields=metadataFields.filter(([type])=>type!== (target==="branch"?"tag_name_pattern":"branch_name_pattern"));
  const count=useRef(rows.length);
  useEffect(()=>{if(rows.length>count.current)document.getElementById(`${uid}-${rows.at(-1)!.id}-field`)?.focus();count.current=rows.length;},[rows,uid]);
  const update=(id:number,rule:MetadataRule)=>onChange(rows.map(row=>row.id===id?{...row,rule}:row));
  return <section className="space-y-4" aria-labelledby={`${uid}-title`}>
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 id={`${uid}-title`} className="text-sm font-semibold">Metadata restrictions</h3><Button disabled={disabled||rows.length>=limit} onClick={onAdd}>Add metadata restriction</Button></div>
    <p className="max-w-[70ch] text-xs leading-5 text-muted">Name patterns check the branch or tag name. Commit patterns check every introduced commit, including intermediate and merge-side commits. Multiple restrictions must all pass.</p>
    {rows.map((row,index)=>{
      const {rule}=row,p=rule.parameters,title=metadataFields.find(([type])=>type===rule.type)?.[1]??"Metadata";
      return <fieldset key={row.id} className="space-y-3 border-t border-line pt-4" disabled={disabled}>
        <legend className="sr-only">{title} restriction {index+1}</legend>
        <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{p.name||title}</strong><Button size="sm" variant="ghost" aria-label={`Remove metadata restriction ${index+1}`} onClick={()=>onChange(rows.filter(item=>item.id!==row.id))}>Remove restriction</Button></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1 text-xs text-muted">Field<select id={`${uid}-${row.id}-field`} className={field} value={rule.type} onChange={e=>update(row.id,{...rule,type:e.target.value as MetadataRule["type"]})}>{fields.map(([type,label])=><option key={type} value={type}>{label}</option>)}</select></label>
          <label className="block space-y-1 text-xs text-muted">Requirement<select className={field} value={p.operator} onChange={e=>update(row.id,{...rule,parameters:{...p,operator:e.target.value as typeof p.operator}})}><option value="starts_with">Starts with</option><option value="ends_with">Ends with</option><option value="contains">Contains</option><option value="regex">Matches regular expression</option></select></label>
        </div>
        <label className="block space-y-1 text-xs text-muted">Pattern<textarea className={`${field} font-mono`} required maxLength={512} rows={2} value={p.pattern} onChange={e=>update(row.id,{...rule,parameters:{...p,pattern:e.target.value}})}/></label>
        <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={p.negate??false} onChange={e=>update(row.id,{...rule,parameters:{...p,negate:e.target.checked}})}/>Must not match this requirement</label>
        <label className="block space-y-1 text-xs text-muted">Description (optional)<input className={field} maxLength={100} value={p.name??""} onChange={e=>{const {name:_,...rest}=p;update(row.id,{...rule,parameters:e.target.value?{...rest,name:e.target.value}:rest});}}/></label>
      </fieldset>;
    })}
    {rows.length>0&&<p className="max-w-[70ch] text-xs leading-5 text-muted">Patterns are case-sensitive. Regex uses RE2 syntax; anchor with ^ and $ for a full match. Commit messages retain their trailing newline, so use {"\\n?$"} when needed. Literal requirements treat wildcards as text. Names exclude the refs/heads/ or refs/tags/ prefix.</p>}
  </section>;
}
