"use client";
import { useEffect, useRef, useState } from "react";
import { ShieldCheck, Tag, GitBranch, Upload } from "lucide-react";
import type { ReviewSnapshot } from "@swarm/api/review";
import {patternLines} from "@swarm/api/review";
import { api, trunkPath } from "@/lib/api";
import { Button } from "@/components/controls";
import { Card } from "@/components/ui";
import { field, Notice } from "./shared";
import {RequiredEnvironments} from "./DeploymentEnvironments";
import { RulesetImport } from "./RulesetImport";
import { MetadataRules, metadataFields, type MetadataDraft } from "./MetadataRules";
type Ruleset = NonNullable<ReviewSnapshot["rulesets"]>[number];
type Input = Omit<Ruleset,"id">;
type RuleType = Input["rules"][number]["type"];
const refOptions = [
  ["creation","Restrict creations","Prevent creation of matching refs."],
  ["update","Restrict updates","Prevent updates, including pull request merges."],
  ["deletion","Restrict deletions","Prevent deletion of matching refs."],
  ["non_fast_forward","Block force pushes","Prevent history rewrites and tag replacements."],
  ["required_linear_history","Require linear history","Reject introduced merge commits throughout the history."],
  ["required_signatures","Require signed commits","Verify introduced commits using account-bound SSH or OpenPGP signing keys."],
] as const;
const pushOptions = [
  ["file_path_restriction","Restrict file paths","Path patterns, one per line","restricted_file_paths"],
  ["file_extension_restriction","Restrict file extensions","Extensions beginning with a dot, one per line","restricted_file_extensions"],
  ["max_file_path_length","Limit file path length","Maximum characters","max_file_path_length"],
  ["max_file_size","Limit file size","Maximum MiB per file","max_file_size"],
] as const;
export function Rulesets({trunk,rules,canEdit,onChange,environments=[]}:{trunk:string;rules:Ruleset[];canEdit:boolean;onChange:(r:Ruleset[])=>void;environments?:NonNullable<ReviewSnapshot["environments"]>}) {
  const [selected,setSelected]=useState<number|null>(null);
  const [importing,setImporting]=useState(false),[notice,setNotice]=useState("");
  const noticeRef=useRef<HTMLParagraphElement>(null);
  const importTrigger=useRef<HTMLButtonElement>(null);
  const editTrigger=useRef<HTMLButtonElement>(null);
  useEffect(()=>{if(notice)noticeRef.current?.focus();},[notice]);
  return <Card className="repository-protections">
    <header><div><h2><ShieldCheck size={16} aria-hidden/>Repository rulesets</h2><p>Protect branches and tags, or restrict files across every ref. All matching rulesets apply alongside branch protections.</p></div>
      {canEdit&&<div className="flex flex-wrap gap-2"><Button ref={importTrigger} onClick={()=>{setSelected(null);setNotice("");setImporting(true);}}>Import JSON</Button><Button onClick={event=>{editTrigger.current=event.currentTarget;setImporting(false);setSelected(0);}}>New ruleset</Button></div>}</header>
    {notice&&<p ref={noticeRef} tabIndex={-1} role="status" className="px-4 py-3 text-sm outline-none">{notice}</p>}
    <ul className="divide-y divide-line">{rules.map(r=><li className="repository-rule" key={r.id}>
      {r.target==="tag"?<Tag size={18}/>:r.target==="push"?<Upload size={18}/>:<GitBranch size={18}/>}
      <div className="min-w-0 flex-1"><strong className="text-sm">{r.name}</strong><p>{r.target} · {r.enforcement} · {r.rules.length} {r.rules.length===1?"rule":"rules"}</p><a className="text-xs text-series-1 underline underline-offset-2" href={`${trunkPath(trunk)}/rulesets/${r.id}/export`} download>Download JSON</a></div>
      {canEdit&&<Button onClick={event=>{editTrigger.current=event.currentTarget;setImporting(false);setSelected(r.id);}}>Edit ruleset</Button>}</li>)}</ul>
    {!rules.length&&<p className="px-4 py-6 text-sm text-muted">No repository rulesets configured.</p>}
    {selected!==null&&canEdit&&<RulesetForm environments={environments} key={selected} trunk={trunk} existing={rules.find(r=>r.id===selected)} onCancel={()=>{setSelected(null);editTrigger.current?.focus();}} onSave={r=>{onChange(r);setSelected(null);editTrigger.current?.focus();}}/>}
    {importing&&canEdit&&<RulesetImport key={trunk} trunk={trunk} onCancel={()=>{setImporting(false);importTrigger.current?.focus();}} onImported={rule=>{onChange([...rules,rule]);setImporting(false);setNotice(`Imported ruleset “${rule.name}”.`);}}/>}
  </Card>;
}
function RulesetForm({trunk,existing,onCancel,onSave,environments}:{trunk:string;existing?:Ruleset;onCancel:()=>void;onSave:(r:Ruleset[])=>void;environments:NonNullable<ReviewSnapshot["environments"]>}) {
  const [target,setTarget]=useState<Input["target"]>(existing?.target??"branch");
  const [enforcement,setEnforcement]=useState<Input["enforcement"]>(existing?.enforcement??"active");
  const [enabled,setEnabled]=useState<Set<RuleType>>(new Set(existing?.rules.map(r=>r.type)??["deletion","non_fast_forward"]));
  const [metadata,setMetadata]=useState<MetadataDraft[]>(()=>existing?.rules.filter((rule):rule is import("@swarm/api/review").MetadataRule=>metadataFields.some(([type])=>type===rule.type)).map((rule,id)=>({id,rule}))??[]);
  const nextMetadataId=useRef(metadata.length);
  const [deploymentNames,setDeploymentNames]=useState<string[]>(existing?.rules.flatMap(rule=>rule.type==="required_deployments"?rule.parameters.required_deployment_environments:[])??[]);
  const [error,setError]=useState(""),[busy,setBusy]=useState(false);
  const errorRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(error)errorRef.current?.focus();},[error]);
  const lines=patternLines;
  async function save(form:HTMLFormElement|null,remove=false) {
    setBusy(true);setError("");
    try {
      const v=new FormData(form??undefined);
      const rules:Input["rules"]=target==="push"?pushOptions.filter(([type])=>enabled.has(type)).map(([type,,,key])=>({type,parameters:{[key]:key.startsWith("restricted_")?lines(v.get(type)):Number(v.get(type)),...(["file_path_restriction","max_file_size"].includes(type)?{allowed_file_paths:lines(v.get(type+"_exceptions"))}:{})}} as Input["rules"][number])):[...refOptions.filter(([type])=>enabled.has(type)).map(([type])=>({type})),...metadata.map(row=>row.rule),...(target==="branch"&&deploymentNames.length?[{type:"required_deployments" as const,parameters:{required_deployment_environments:deploymentNames}}]:[])];
      const input:Input={name:String(v.get("name")??""),target,enforcement,rules,
        ...(target==="push"?{}:{conditions:{ref_name:{include:lines(v.get("include")),exclude:lines(v.get("exclude"))}}}),
        bypass_actors:[...[4,5].flatMap(actor_id=>{const mode=v.get(`role_${actor_id}`);return mode==="always"||target==="branch"&&mode==="pull_request"?[{actor_type:"RepositoryRole" as const,actor_id:actor_id as 4|5,bypass_mode:mode as "always"|"pull_request"}]:[];}),...lines(v.get("always")).map(actor_id=>({actor_type:"User" as const,actor_id,bypass_mode:"always" as const})),...(target==="branch"?lines(v.get("pull_request")).map(actor_id=>({actor_type:"User" as const,actor_id,bypass_mode:"pull_request" as const})):[])]};
      await api(`${trunkPath(trunk)}/rulesets${existing?`/${existing.id}`:""}`,{method:remove?"DELETE":existing?"PUT":"POST",...(remove?{}:{body:input})});
      onSave((await api<{rulesets:Ruleset[]}>(`${trunkPath(trunk)}/rulesets`)).rulesets);
    } catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  const toggle=(type:RuleType,checked:boolean)=>setEnabled(prev=>{const n=new Set(prev);checked?n.add(type):n.delete(type);return n;});
  return <form className="repository-protection-form space-y-5" onSubmit={e=>{e.preventDefault();void save(e.currentTarget);}}>
    {error&&<div ref={errorRef} tabIndex={-1} className="outline-none"><Notice error={error}/></div>}
    <label className="block space-y-1 text-sm">Ruleset name<input className={field} name="name" required maxLength={100} defaultValue={existing?.name}/></label>
    <div className="flex flex-wrap gap-4">
      <label className="block space-y-1 text-sm">Target<select className={field} value={target} onChange={e=>{const next=e.target.value as Input["target"];setTarget(next);setEnabled(new Set(next==="push"?[]:["deletion","non_fast_forward"]));setMetadata(rows=>next==="push"?[]:rows.map(row=>({...row,rule:row.rule.type==="branch_name_pattern"||row.rule.type==="tag_name_pattern"?{...row.rule,type:next==="branch"?"branch_name_pattern":"tag_name_pattern"}:row.rule})));}}><option value="branch">Branches</option><option value="tag">Tags</option><option value="push">Pushes (all refs)</option></select></label>
      <label className="block space-y-1 text-sm">Enforcement<select className={field} name="enforcement" value={enforcement} onChange={event=>setEnforcement(event.target.value as Input["enforcement"])}><option value="active">Active</option><option value="evaluate">Evaluate (log only)</option><option value="disabled">Disabled</option></select></label>
    </div>
    {enforcement==="evaluate"&&<p className="max-w-2xl text-sm leading-6 text-muted">These rules will record what passes or fails in Rule insights without blocking changes. Active rulesets and branch protections still apply.</p>}
    {target!=="push"&&<div className="grid gap-4 sm:grid-cols-2">
      <label className="block space-y-1 text-sm">Include refs<textarea key={`include-${target}`} className={field} name="include" required rows={3} defaultValue={existing?.target===target?existing.conditions?.ref_name.include.join("\n"):"~ALL"}/><span className="block text-xs text-muted">One per line: ~ALL{target==="branch"?", ~DEFAULT_BRANCH, refs/heads/release/**":", refs/tags/v*"}.</span></label>
      <label className="block space-y-1 text-sm">Exclude refs<textarea key={`exclude-${target}`} className={field} name="exclude" rows={3} defaultValue={existing?.target===target?existing.conditions?.ref_name.exclude.join("\n"):""}/></label>
    </div>}
    {target!=="push"?<fieldset className="repository-rule-options"><legend className="sr-only">Ref restrictions</legend>{refOptions.map(([type,label,description])=><label key={type}><input type="checkbox" checked={enabled.has(type)} onChange={e=>toggle(type,e.target.checked)}/><span><strong>{label}</strong><small>{description}</small></span></label>)}</fieldset>:
      <fieldset className="space-y-4"><legend className="mb-3 text-sm font-semibold">File restrictions</legend><p className="text-xs text-muted">Checks the actual file changes and every introduced commit, including intermediate changes. Rewinds cannot restore restricted files. New refs check their full history.</p>{pushOptions.map(([type,label,hint,key])=>{
        const r=existing?.rules.find(r=>r.type===type),p=r&&"parameters" in r?r.parameters as unknown as Record<string,number|string[]>:{};
        return <div key={type} className="space-y-2"><label className="flex gap-2 text-sm"><input type="checkbox" checked={enabled.has(type)} onChange={e=>toggle(type,e.target.checked)}/>{label}</label>{enabled.has(type)&&<><label className="block space-y-1 text-xs text-muted">{hint}{key.startsWith("restricted_")?<textarea className={field} name={type} required rows={3} defaultValue={Array.isArray(p[key])?(p[key] as string[]).join("\n"):""}/>:<input className={field} type="number" name={type} required min={1} max={key==="max_file_size"?100:4096} defaultValue={typeof p[key]==="number"?p[key] as number:key==="max_file_size"?10:255}/>}</label>{(type==="file_path_restriction"||type==="max_file_size")&&<label className="block space-y-1 text-xs text-muted">{type==="file_path_restriction"?"Allowed paths within this restriction":"Paths allowed to exceed this size limit"}<textarea className={field} name={type+"_exceptions"} rows={3} placeholder="**/gradle/wrapper/*.jar" defaultValue={Array.isArray(p.allowed_file_paths)?p.allowed_file_paths.join("\n"):""}/><span className="block">One pattern per line. Applies only to this rule; all other restrictions still apply.</span></label>}</>}</div>;
      })}</fieldset>}
    {target!=="push"&&<MetadataRules target={target} rows={metadata} onChange={setMetadata} onAdd={()=>{const id=nextMetadataId.current++;setMetadata(rows=>[...rows,{id,rule:{type:"commit_message_pattern",parameters:{operator:"contains",pattern:""}}}]);}} disabled={busy} limit={20-refOptions.filter(([type])=>enabled.has(type)).length-(target==="branch"&&deploymentNames.length?1:0)}/>}
    {target==="branch"&&<RequiredEnvironments environments={environments} selected={deploymentNames} onChange={setDeploymentNames} disabled={busy}/>}
    <details className="space-y-3"><summary className="cursor-pointer text-sm font-semibold">Bypass permissions</summary><p className="text-xs leading-5 text-muted">Only signed-in humans with repository write access can bypass. Agent credentials never inherit bypass permission. Bypasses are audited and do not override separate branch protection rules.</p>
      <fieldset className="space-y-3"><legend className="mb-2 text-sm font-medium">Repository roles</legend>{([[5,"Repository admins (including the owner)"],[4,"Repository writers"]] as const).map(([id,label])=><label key={`${target}-${id}`} className="block space-y-1 text-sm">{label}<select className={field} name={`role_${id}`} disabled={busy} defaultValue={existing?.bypass_actors?.find(a=>a.actor_type==="RepositoryRole"&&a.actor_id===id&&(target==="branch"||a.bypass_mode==="always"))?.bypass_mode??"none"}><option value="none">No bypass</option><option value="always">Always</option>{target==="branch"&&<option value="pull_request">Pull request merges only</option>}</select></label>)}<p className="max-w-[70ch] text-xs leading-5 text-muted">Roles are checked again when the change is applied. Writer bypass applies to the writer role; admins are selected separately. Losing a role removes its permission. No role is allowed by default.</p></fieldset>
      <label className="block space-y-1 text-sm">Always (account IDs, one per line)<textarea className={field} name="always" rows={2} defaultValue={existing?.bypass_actors?.filter(a=>a.actor_type==="User"&&a.bypass_mode==="always").map(a=>a.actor_id).join("\n")}/></label>
      {target==="branch"&&<label className="block space-y-1 text-sm">Pull request merges only (account IDs)<textarea className={field} name="pull_request" rows={2} defaultValue={existing?.bypass_actors?.filter(a=>a.actor_type==="User"&&a.bypass_mode==="pull_request").map(a=>a.actor_id).join("\n")}/></label>}
    </details>
    <div className="flex flex-wrap gap-3"><Button type="submit" variant="primary" disabled={busy}>Save ruleset</Button><Button disabled={busy} onClick={onCancel}>Cancel</Button>{existing&&<Button className="repository-danger-button" disabled={busy} onClick={()=>void save(null,true)}>Delete ruleset</Button>}</div>
  </form>;
}
