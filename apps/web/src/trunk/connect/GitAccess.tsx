"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Commands, Input } from "@/components/controls";
import { OneTimeToken } from "@/components/OneTimeToken";
import { LinkButton } from "@/components/ui";
import { api, trunkPath } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTrunk } from "@/trunk/context";
import type { PushToken } from "@/onboarding/usePushTokens";

export function GitAccess({trunk,origin}:{trunk:string;origin:string}) {
  const {user}=useSession(), {address}=useTrunk();
  const [tokens,setTokens]=useState<PushToken[]>([]),[made,setMade]=useState<(PushToken&{token:string})|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const scope=`${user?.id??""}/${trunk}`,current=useRef(scope);current.current=scope;
  const [stateScope,setStateScope]=useState(scope);
  const revision=useRef(0),pending=useRef(false);
  const clone=`${origin}/git/${address?`${address.namespace}/${address.name}`:trunk}.git`;
  useEffect(()=>{
    setStateScope(scope);setTokens([]);setMade(null);setError("");
    if(!user)return;
    const version=revision.current;
    void api<PushToken[]>(`${trunkPath(trunk)}/git-tokens`).then(list=>{if(current.current===scope&&version===revision.current)setTokens(list);}).catch(e=>{if(current.current===scope&&version===revision.current)setError(e.message);});
  },[scope,trunk,user?.id]);
  async function create(label:string) {
    if(pending.current)return;pending.current=true;revision.current++;
    const requested=scope;setBusy(true);setError("");
    try {
      const result=await api<PushToken&{token:string}>(`${trunkPath(trunk)}/git-tokens`,{body:{label}});
      if(current.current!==requested)return;
      setMade(result);setTokens(list=>[result,...list]);
    }catch(e){if(current.current===requested)setError((e as Error).message);}finally{pending.current=false;setBusy(false);}
  }
  async function revoke(id:string) {
    if(pending.current)return;pending.current=true;revision.current++;
    const requested=scope;setBusy(true);setError("");
    try {
      await api(`/api/tokens/${id}`,{method:"DELETE"});
      if(current.current!==requested)return;
      setTokens(list=>list.filter(t=>t.id!==id));setMade(m=>m?.id===id?null:m);
    }catch(e){if(current.current===requested)setError((e as Error).message);}finally{pending.current=false;setBusy(false);}
  }
  const visible=stateScope===scope;
  return <section className="space-y-6" aria-labelledby="git-access-title">
    <header className="space-y-2"><h1 id="git-access-title" className="text-2xl font-semibold tracking-tight">Git access</h1>
      <p className="max-w-[70ch] text-sm leading-6 text-muted">Clone, commit and push from your terminal, IDE or Git client. Agent collaboration is optional.</p></header>
    <div className="space-y-3"><h2 className="text-sm font-semibold">Clone this repository</h2><Commands code={`git clone ${clone}`}/>
      <p className="max-w-[70ch] text-xs leading-6 text-muted">When Git asks for credentials, enter your username and use a Git token as the password. Your usual credential manager can save it. Your repository role and all branch protections still apply.</p></div>
    {user&&<div className="border-y border-line py-5 space-y-4">
      <div><h2 className="text-sm font-semibold">Your Git tokens</h2><p className="mt-1 max-w-[70ch] text-xs leading-6 text-muted">Each token works for this repository for 30 days. It grants Git access only and can be revoked at any time.</p></div>
      <form className="flex flex-wrap items-end gap-3" onSubmit={e=>{e.preventDefault();void create(String(new FormData(e.currentTarget).get("label")??""));}}>
        <label className="min-w-44 max-w-sm flex-1 text-xs text-muted">Token name<Input className="mt-1 w-full" name="label" placeholder="My laptop" required maxLength={64} disabled={busy}/></label>
        <Button type="submit" variant="primary" disabled={busy}>{busy?"Saving…":"Create Git token"}</Button>
      </form>
      {visible&&made&&<div className="space-y-2" role="status"><p className="text-xs leading-6">Copy this token now. It is shown once.</p><OneTimeToken key={made.id} value={made.token}/></div>}
      {error&&<p role="alert" className="text-sm text-critical">{error}</p>}
      {visible&&<ul className="divide-y divide-line">{tokens.map(t=><li key={t.id} className="flex flex-wrap items-center gap-3 py-3 text-xs"><strong className="min-w-0 break-words">{t.label}</strong><span className="text-muted">Expires {new Date(t.expiresAt).toLocaleDateString()} · {t.usedAt?"Used":"Not used yet"}</span><Button className="ml-auto" disabled={busy} size="sm" onClick={()=>void revoke(t.id)}>Revoke</Button></li>)}</ul>}
    </div>}
    <div className="flex flex-wrap gap-2"><LinkButton href={`/t/${trunk}`}>Browse code</LinkButton><LinkButton href={`/t/${trunk}/pulls`}>Pull requests</LinkButton><LinkButton href={`/t/${trunk}/people`}>Invite collaborators</LinkButton></div>
  </section>;
}
