"use client";
import {useEffect,useRef,useState} from "react";
import {TopBar} from "@/components/TopBar";
import {Button,Input} from "@/components/controls";
import {api,ApiError} from "@/lib/api";
import {useSession} from "@/lib/session";
import styles from "./CliAuthorize.module.css";
import {cliPermissionLabels as labels,toggleCliScope} from "@/lib/cli-scopes";

type Preview={userCode:string;label:string;repository:string;trunk:string;requestedScopes:string[];allowedScopes:string[];maxDays:number;expiresAt:number;status:"pending"|"approved"|"denied"|"consumed";archived:boolean;account:{id:string;name:string}};
function normalize(value:string) {const code=value.trim().toUpperCase().replace(/-/g,"");return /^[A-HJ-NP-Z2-9]{8}$/.test(code)?code.slice(0,4)+"-"+code.slice(4):null;}
const deviceMessage=(error:unknown)=>error instanceof ApiError&&typeof error.body.error_description==="string"?error.body.error_description:(error as Error).message;
export function CliAuthorize({initialCode,signInFailed}:{initialCode:string;signInFailed:boolean}) {
  const {user,loaded,providers,refresh}=useSession();
  const [code,setCode]=useState(initialCode),[preview,setPreview]=useState<Preview|null>(null),[scopes,setScopes]=useState<string[]>([]),[days,setDays]=useState(7),[confirmed,setConfirmed]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(signInFailed?"Sign-in did not finish. Try signing in again.":""),[expired,setExpired]=useState(false),[devName,setDevName]=useState("");
  const generation=useRef(0),current=useRef(user?.id);current.current=user?.id;
  const lock=useRef(false),failure=useRef<HTMLParagraphElement>(null),heading=useRef<HTMLHeadingElement>(null);
  const normalized=normalize(code),visible=preview?.account.id===user?.id?preview:null;
  useEffect(()=>{if(error)failure.current?.focus();},[error]);
  useEffect(()=>{
    setPreview(null);setConfirmed(false);setScopes([]);setExpired(false);setBusy(false);generation.current++;
    if(user&&normalize(initialCode))void lookup(initialCode);
    return()=>{generation.current++;};
  },[user?.id,initialCode]);
  useEffect(()=>{
    if(!visible||visible.status!=="pending")return;
    const remaining=visible.expiresAt-Date.now();setExpired(remaining<=0);
    const timer=setTimeout(()=>setExpired(true),Math.max(0,remaining));return()=>clearTimeout(timer);
  },[visible?.userCode,visible?.expiresAt,visible?.status]);
  async function lookup(value:string) {
    const formatted=normalize(value);
    if(!formatted){setError("Enter the eight-character code shown in your terminal.");return;}
    const requested=user?.id,g=++generation.current;setBusy(true);setError("");setPreview(null);setConfirmed(false);
    try {
      const result=await api<Preview>(`/api/cli/authorize?code=${formatted}`);
      if(current.current===requested&&generation.current===g){setCode(formatted);setPreview(result);setScopes(result.allowedScopes);setDays(result.maxDays);setExpired(result.expiresAt<=Date.now());}
    }catch(e){if(current.current===requested&&generation.current===g)setError(deviceMessage(e));}finally{if(generation.current===g)setBusy(false);}
  }
  async function decide(decision:"approve"|"deny") {
    if(!visible||lock.current)return;lock.current=true;const requested=user?.id,g=++generation.current;setBusy(true);setError("");
    try {
      const result=await api<{status:Preview["status"]}>("/api/cli/authorize",{body:{userCode:visible.userCode,decision,...(decision==="approve"?{scopes,days,codeConfirmed:confirmed}:{})}});
      if(current.current===requested&&generation.current===g){setPreview(p=>p?{...p,status:result.status}:p);heading.current?.focus();}
    }catch(e){if(current.current===requested&&generation.current===g)setError(deviceMessage(e));}finally{lock.current=false;if(generation.current===g)setBusy(false);}
  }
  const returnCode=normalized?`?cli_code=${normalized}`:"";
  return <><TopBar entry crumbs={<span>CLI authorization</span>}/><main className={`${styles.page} mx-auto max-w-2xl space-y-7 px-5 py-10`}>
    <header className="space-y-3"><h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold tracking-tight">Authorize Nanohub CLI</h1><p className="max-w-[70ch] text-sm leading-6 text-muted">Connect the terminal where you started <code>nh auth login</code>. Continue only if you started this request and the code matches your terminal.</p></header>
    {error&&<p ref={failure} tabIndex={-1} role="alert" className="text-sm leading-6 text-critical">{error}</p>}
    {!loaded?<p role="status" className="text-sm text-muted">Loading your account…</p>:!user?<section className="space-y-4"><h2 className="text-base font-semibold">Sign in to review the request</h2><p className="text-sm leading-6 text-muted">Signing in does not approve CLI access. You will choose the repository permissions next.</p>{providers.codegraff&&<a href={`/api/auth/signin/codegraff${returnCode}`} className="inline-flex rounded-md bg-ink px-4 py-2 text-sm font-medium text-page">Sign in with Codegraff</a>}{providers.dev&&<form className="flex flex-wrap items-end gap-3" onSubmit={async event=>{event.preventDefault();setBusy(true);setError("");try{await api("/api/auth/dev",{body:{name:devName}});await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}><label className="flex-1 text-sm">Development account<Input required value={devName} onChange={e=>setDevName(e.target.value)} disabled={busy} className="mt-1 w-full"/></label><Button type="submit" disabled={busy}>Dev login</Button></form>}</section>:<>
      <p className="text-sm text-muted">Signed in as <strong className="text-ink">{user.name}</strong>.</p>
      <form className="flex flex-wrap items-end gap-3" onSubmit={event=>{event.preventDefault();void lookup(code);}}><label className="flex-1 text-sm">Code from your terminal<Input aria-label="CLI authorization code" value={code} autoComplete="off" autoCapitalize="characters" maxLength={10} onChange={event=>{setCode(event.target.value);setPreview(null);setConfirmed(false);setError("");generation.current++;setBusy(false);}} placeholder="ABCD-EFGH" className="mt-1 w-full font-mono" disabled={busy&&!!visible}/></label><Button type="submit" disabled={busy||!normalized}>{busy&&!visible?"Loading…":"Review request"}</Button></form>
      {visible&&<section aria-label="Requested CLI access" className="space-y-5 border-t border-line pt-6">
        <dl className="space-y-3 text-sm"><div><dt className="text-xs text-muted">Repository</dt><dd className="mt-1 break-words font-semibold">{visible.repository}</dd></div><div><dt className="text-xs text-muted">CLI name</dt><dd className="mt-1 break-words">{visible.label}</dd></div></dl>
        {visible.status==="pending"?<>
          <fieldset disabled={busy||expired} className="space-y-3"><legend className="mb-3 text-sm font-semibold">Allow this CLI to</legend>{visible.requestedScopes.map(scope=><label key={scope} className="flex items-start gap-2 text-sm leading-6"><input type="checkbox" checked={scopes.includes(scope)} disabled={scope==="read"||!visible.allowedScopes.includes(scope)} onChange={event=>setScopes(previous=>toggleCliScope(previous,scope,event.target.checked))} className="mt-1.5"/><span>{labels[scope]??scope}{scope==="read"&&<span className="text-muted"> · required</span>}{!visible.allowedScopes.includes(scope)&&<span className="text-muted"> · unavailable with current repository access</span>}</span></label>)}</fieldset>
          {visible.archived&&<p className="text-sm text-muted">This repository is archived. Content permissions are unavailable. Admins can still approve requested archive administration to reopen it.</p>}
          <label className="block text-sm">Credential expires in<select className="mt-1 block rounded-md border border-line bg-page px-3 py-2 text-sm" value={days} onChange={event=>setDays(Number(event.target.value))} disabled={busy||expired}>{[...new Set([1,7,30,visible.maxDays])].filter(n=>n<=visible.maxDays).sort((a,b)=>a-b).map(n=><option key={n} value={n}>{n} {n===1?"day":"days"}</option>)}</select></label>
          <p className="max-w-[70ch] text-xs leading-6 text-muted">The credential acts as your account in this repository only. Repository roles, locks and review protections still apply to content changes. Revoke it later in Git access.{visible.requestedScopes.includes("rulesets:write")&&" Ruleset administration can change or remove restrictions and bypass accounts and requires your current admin role."}{visible.requestedScopes.includes("protections:write")&&" Protection management can change or remove branch requirements and requires your current admin role."}{visible.requestedScopes.includes("repository:archive")&&" Archive administration can make the repository read-only or reopen it and requires your current admin role."}{visible.requestedScopes.includes("environments:write")&&" Environment administration can change deployment reviewers, wait timers and branch/tag restrictions and requires your current admin role."}</p>
          {expired?<p role="status" className="text-sm">This request expired. Start a new login in your terminal.</p>:<><label className="flex items-start gap-2 text-sm leading-6"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} disabled={busy} className="mt-1.5"/><span>The code <code>{visible.userCode}</code> matches the code in my terminal.</span></label><div className="flex flex-wrap gap-3"><Button variant="primary" disabled={busy||!confirmed} onClick={()=>void decide("approve")}>Authorize CLI</Button><Button disabled={busy} onClick={()=>void decide("deny")}>Deny request</Button></div></>}
        </>:<div role="status" className="space-y-3"><h2 className="text-base font-semibold">{visible.status==="denied"?"Request denied":"CLI request approved"}</h2><p className="text-sm leading-6 text-muted">{visible.status==="denied"?"This request cannot receive a credential. You can close this page.":"Return to your terminal to finish. You can close this page; no credential is displayed here."}</p><a href={`/t/${visible.trunk}/connect#cli-access`} className="text-sm underline underline-offset-4">Manage your CLI credentials</a></div>}
      </section>}
    </>}
  </main></>;
}
