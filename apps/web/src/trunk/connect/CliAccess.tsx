"use client";
import {useEffect,useRef,useState} from "react";
import {Button,Commands,Input} from "@/components/controls";
import {OneTimeToken} from "@/components/OneTimeToken";
import {api,trunkPath} from "@/lib/api";
import {useSession} from "@/lib/session";
import {useTrunk} from "../context";
import {cliPermissions,cliArchivedScope,toggleCliScope} from "@/lib/cli-scopes";

type Credential={id:string;label:string;scopes:string[];createdAt:number;expiresAt:number;usedAt:number|null};
export function CliAccess({trunk,origin}:{trunk:string;origin:string}) {
  const {user}=useSession(),{address,readOnly}=useTrunk();
  const [data,setData]=useState<{credentials:Credential[];allowedScopes:string[]}|null>(null),[made,setMade]=useState<(Credential&{token:string})|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const [selectedScopes,setSelectedScopes]=useState<string[]>(["read"]);
  const scope=`${user?.id??""}/${trunk}`,current=useRef(scope);current.current=scope;
  const [visibleScope,setVisibleScope]=useState(scope),mutation=useRef(false),generation=useRef(0);
  useEffect(()=>{
    const g=++generation.current;setVisibleScope(scope);setData(null);setMade(null);setError("");setSelectedScopes(["read"]);
    if(user)void api<{credentials:Credential[];allowedScopes:string[]}>(`${trunkPath(trunk)}/cli-credentials`).then(value=>{if(current.current===scope&&generation.current===g)setData(value);}).catch(e=>{if(current.current===scope&&generation.current===g)setError(e.message);});
  },[scope,trunk,user?.id,readOnly]);
  if(!user)return null;
  const visible=visibleScope===scope,repo=address?`${address.namespace}/${address.name}`:null,target=(repo?`-R ${repo}`:`--trunk ${trunk}`)+(origin==="https://nanohub.sh"?"":` --host ${origin}`);
  async function create(form:FormData) {
    if(mutation.current)return;mutation.current=true;generation.current++;setBusy(true);setError("");const requested=scope;
    try {
      const value=await api<Credential&{token:string}>(`${trunkPath(trunk)}/cli-credentials`,{body:{label:form.get("label"),scopes:["read",...form.getAll("scopes")],days:Number(form.get("days"))}});
      if(current.current===requested){setMade(value);setData(d=>d?{...d,credentials:[value,...d.credentials]}:d);}
    }catch(e){if(current.current===requested)setError((e as Error).message);}finally{mutation.current=false;setBusy(false);}
  }
  async function revoke(id:string) {
    if(mutation.current)return;mutation.current=true;generation.current++;setBusy(true);setError("");const requested=scope;
    try {
      await api(`/api/cli/credentials/${id}`,{method:"DELETE"});
      if(current.current===requested){setData(d=>d?{...d,credentials:d.credentials.filter(c=>c.id!==id)}:d);setMade(m=>m?.id===id?null:m);}
    }catch(e){if(current.current===requested)setError((e as Error).message);}finally{mutation.current=false;setBusy(false);}
  }
  return <section id="cli-access" aria-labelledby="cli-access-title" className="border-t border-line pt-6 space-y-5">
    <header className="space-y-2"><h2 id="cli-access-title" className="text-lg font-semibold">Nanohub CLI</h2><p className="max-w-[70ch] text-sm leading-6 text-muted">Use nh or nanohub to inspect diffs, submit reviews and work with pull requests from your terminal. Choose the permissions this credential can use in this repository.</p></header>
    {visible&&data&&<form className="space-y-4" onSubmit={e=>{e.preventDefault();void create(new FormData(e.currentTarget));}}>
      <div className="flex flex-wrap gap-4"><label className="min-w-44 flex-1 max-w-sm text-xs text-muted">Credential name<Input name="label" required maxLength={64} disabled={busy} placeholder="My laptop CLI" className="mt-1 w-full"/></label>
        <label className="text-xs text-muted">Expires in<select name="days" defaultValue="7" disabled={busy} className="mt-1 block rounded-md border border-line bg-page px-3 py-2 text-sm text-ink"><option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option></select></label></div>
      <fieldset disabled={busy} className="space-y-2"><legend className="mb-2 text-sm font-medium">Permissions</legend>{cliPermissions.map(([id,label])=><label key={id} className="flex items-start gap-2 text-sm"><input type="checkbox" name={id==="read"?undefined:"scopes"} value={id} checked={selectedScopes.includes(id)} onChange={event=>setSelectedScopes(previous=>toggleCliScope(previous,id,event.target.checked))} disabled={id==="read"||!data.allowedScopes.includes(id)||!!readOnly&&!cliArchivedScope(id)} className="mt-1 accent-[var(--brand)]"/><span>{label}{id==="read"&&<span className="text-muted"> · required</span>}</span></label>)}</fieldset>
      <p className="max-w-[70ch] text-xs leading-6 text-muted">This credential acts as {user.name} for this repository only. Git access requires the clone/fetch or push permissions above. Reviews are attributed to your account and marked “via CLI”. Protection and ruleset administration can change or remove requirements, including ruleset bypass accounts, and require your current admin role. Archive administration can make this repository read-only or reopen it and requires its own admin permission. Default-branch administration selects an existing branch and requires its own admin permission. Runner administration is owner-only and issues separate CI credentials that last until revoked, even after this CLI credential expires. Secrets and other repository settings stay in their existing settings pages.</p>
      {readOnly&&<p className="text-xs text-muted">This repository is archived. Content permissions are unavailable. Admins can still delegate archive administration to reopen it.</p>}
      <Button type="submit" variant="primary" disabled={busy}>{busy?"Saving…":"Create CLI credential"}</Button>
    </form>}
    {!data&&!error&&<p role="status" className="text-sm text-muted">Loading your CLI credentials…</p>}
    {error&&<p role="alert" className="text-sm text-critical">{error}</p>}
    {visible&&made&&<div role="status" className="space-y-3"><p className="text-sm">Copy this credential now; it is shown once. Supply it through stdin to <code>nh auth login --with-api-token {target}</code>.</p><OneTimeToken key={made.id} value={made.token}/><Button size="sm" onClick={()=>setMade(null)}>Hide credential</Button></div>}
    <Commands code={`nh auth login --with-api-token ${target}\nnh pr list ${target}\nnh pr view 1 ${target}\nnh pr diff 1 ${target}\nnh auth logout --api ${target}`}/>
    {visible&&data&&<ul className="divide-y divide-line">{data.credentials.map(c=><li key={c.id} className="flex flex-wrap items-center gap-3 py-3 text-xs"><div className="min-w-0 flex-1 space-y-1"><strong className="break-words">{c.label}</strong><p className="break-words text-muted">{c.scopes.join(", ")} · Expires {new Date(c.expiresAt).toLocaleDateString()} · {c.usedAt?"Used":"Not used yet"}</p></div><Button size="sm" disabled={busy} onClick={()=>void revoke(c.id)}>Revoke CLI credential</Button></li>)}</ul>}
    {visible&&data&&!data.credentials.length&&<p className="text-xs text-muted">You have no active CLI credentials for this repository.</p>}
  </section>;
}
