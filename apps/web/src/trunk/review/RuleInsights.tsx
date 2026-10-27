"use client";
import { useEffect, useRef, useState } from "react";
import { ListChecks } from "lucide-react";
import type { RuleOutcome, RuleSuitePage } from "@swarm/api/review";
import { api, trunkPath } from "@/lib/api";
import { Button } from "@/components/controls";
import { Card } from "@/components/ui";
import { field, Notice } from "./shared";

type Filters={ref:string;actor:string;ruleset:string;result:string;from:string;to:string};
const empty:Filters={ref:"",actor:"",ruleset:"",result:"",from:"",to:""};
const labels:Record<RuleOutcome,string>={pass:"Passed",fail:"Failed",bypass:"Bypassed",error:"Could not evaluate"};

export function RuleInsights({trunk}:{trunk:string}) {
  const [data,setData]=useState<RuleSuitePage>({suites:[],nextCursor:null});
  const [filter,setFilter]=useState(empty),[busy,setBusy]=useState(true),[error,setError]=useState("");
  const sequence=useRef(0),failure=useRef<HTMLDivElement>(null);
  async function load(next=false,values=filter) {
    const request=++sequence.current;setBusy(true);setError("");
    if(!next)setData({suites:[],nextCursor:null});
    try {
      const params=new URLSearchParams({limit:"25"});
      for(const key of ["ref","actor","ruleset","result"] as const)if(values[key])params.set(key,values[key]);
      for(const key of ["from","to"] as const)if(values[key]) {
        const time=new Date(values[key]).getTime();if(!Number.isFinite(time)||time<=0)throw Error("Choose a valid date and time.");params.set(key,String(time));
      }
      if(next&&data.nextCursor)params.set("before",String(data.nextCursor));
      const page=await api<RuleSuitePage>(`${trunkPath(trunk)}/rulesets/rule-suites?${params}`);
      if(request===sequence.current)setData(previous=>({...page,suites:next?[...previous.suites,...page.suites]:page.suites}));
    }catch(e){if(request===sequence.current)setError((e as Error).message);}
    finally{if(request===sequence.current)setBusy(false);}
  }
  useEffect(()=>{void load(false,empty);return()=>{sequence.current++;};},[trunk]);
  useEffect(()=>{if(error)failure.current?.focus();},[error]);
  return <Card className="repository-protections">
    <header><div><h2><ListChecks size={16} aria-hidden/>Rule insights</h2><p>Inspect enforced and evaluate-only rules for ref writes. Visible to repository admins.</p></div><Button disabled={busy} onClick={()=>void load()}>Refresh insights</Button></header>
    <div className="min-w-0 space-y-5 p-4">
      <form className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={event=>{
        event.preventDefault();const form=new FormData(event.currentTarget);
        const values=Object.fromEntries(Object.keys(empty).map(key=>[key,String(form.get(key)??"").trim()])) as Filters;
        setFilter(values);void load(false,values);
      }}>
        <label className="min-w-0 space-y-1 text-xs text-muted">Result<select className={field} name="result"><option value="">All results</option><option value="pass">Passed</option><option value="fail">Failed</option><option value="bypass">Bypassed</option><option value="error">Could not evaluate</option></select></label>
        <label className="min-w-0 space-y-1 text-xs text-muted">Exact ref<input className={field} name="ref" maxLength={150} placeholder="refs/heads/main"/></label>
        <label className="min-w-0 space-y-1 text-xs text-muted">Actor account ID<input className={field} name="actor" maxLength={256} placeholder="Any account"/></label>
        <label className="min-w-0 space-y-1 text-xs text-muted">Ruleset ID<input className={field} name="ruleset" type="number" min={1} step={1} placeholder="Any ruleset"/></label>
        <label className="min-w-0 space-y-1 text-xs text-muted">From (local time)<input className={field} name="from" type="datetime-local"/></label>
        <label className="min-w-0 space-y-1 text-xs text-muted">To (local time)<input className={field} name="to" type="datetime-local"/></label>
        <div><Button type="submit" disabled={busy}>Filter insights</Button></div>
      </form>
      {error&&<div ref={failure} tabIndex={-1} className="outline-none"><Notice error={error}/><p className="mt-2 text-xs text-muted">Adjust the filters or refresh to try again.</p></div>}
      <p className="text-xs leading-5 text-muted" role="status">{busy?"Loading insights…":`${data.suites.length} observation${data.suites.length===1?"":"s"} loaded.`} Retained for up to 30 days, 2,000 observations or 32 MiB. Evaluate failures do not block writes. Earlier history is unavailable.</p>
      <ol className="min-w-0 divide-y divide-line">{data.suites.map(suite=><li key={suite.id} className="min-w-0 space-y-2 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm"><strong>{labels[suite.result]} · {suite.accepted?"Ref transaction accepted":"Ref transaction rejected"}</strong><time className="text-xs text-muted" dateTime={new Date(suite.at).toISOString()}>{new Date(suite.at).toLocaleString()}</time></div>
        <p className="break-all font-mono text-xs">{suite.ref}</p>
        <p className="break-all text-xs leading-5 text-muted">{suite.actor} · {suite.human?"signed-in human":"credential"} · {suite.source} · observation #{suite.id} · rules revision {suite.revision}</p>
        <p className="break-all font-mono text-xs text-muted">{suite.old??"new ref"} → {suite.next??"deleted"}</p>
        {suite.rejection&&<p className="max-w-[75ch] break-words text-sm leading-6">{suite.rejection}</p>}
        <details className="min-w-0"><summary className="cursor-pointer text-xs text-series-1 underline underline-offset-2">Inspect {suite.evaluations.length} matching {suite.evaluations.length===1?"ruleset":"rulesets"}</summary>
          <ul className="mt-3 min-w-0 space-y-4">{suite.evaluations.map(evaluation=><li key={evaluation.id} className="min-w-0 space-y-1 text-sm">
            <p className="break-words font-medium">{evaluation.name} · {labels[evaluation.result]}</p>
            <p className="text-xs text-muted">#{evaluation.id} · {evaluation.enforcement==="evaluate"?"Evaluate only — does not block":"Active"}</p>
            {evaluation.bypass&&<p className="break-words text-xs leading-5 text-muted">Bypass: {evaluation.bypass.actor_type==="RepositoryRole"?evaluation.bypass.actor_id===5?"repository admin":"repository writer":evaluation.bypass.actor_id} · {evaluation.bypass.bypass_mode==="pull_request"?"pull request merges only":"always"}{evaluation.bypass.role?` · verified role: ${evaluation.bypass.role}`:""}</p>}
            {evaluation.reasons.map((reason,index)=><p key={index} className="max-w-[75ch] break-words text-sm leading-6">{reason}</p>)}
            <p className="break-words text-xs leading-5 text-muted">Configured rules: {evaluation.rules.join(", ")||"none"}.</p>
          </li>)}</ul>
          <p className="mt-3 break-all text-xs text-muted">Atomic batch: {suite.batch}. Rejected batches leave all refs unchanged, including observations whose rules passed.</p>
        </details>
      </li>)}</ol>
      {!busy&&!data.suites.length&&!error&&<p className="py-2 text-sm text-muted">No matching rule evaluations. New ref writes appear here when a ruleset applies.</p>}
      {data.nextCursor&&<Button disabled={busy} onClick={()=>void load(true)}>Load older insights</Button>}
    </div>
  </Card>;
}
