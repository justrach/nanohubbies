"use client";
import {useEffect,useRef,useState} from "react";
import type {SigningKeyList} from "@swarm/api/review";
import {TopBar} from "@/components/TopBar";
import {Button} from "@/components/controls";
import {api,ApiError} from "@/lib/api";
import {useSession,useSignInUrl} from "@/lib/session";
import {field,Notice} from "@/trunk/review/shared";

export function SigningKeys({initial}:{initial:SigningKeyList|null}){
  const {user,loaded,refresh}=useSession(),signIn=useSignInUrl();
  const [data,setData]=useState(initial),[label,setLabel]=useState(""),[publicKey,setPublicKey]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[status,setStatus]=useState(""),[revoking,setRevoking]=useState<string|null>(null);
  const failure=useRef<HTMLDivElement>(null),title=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{if(error)failure.current?.focus();},[error]);
  useEffect(()=>{let active=true;setData(previous=>previous?.account===user?.id?previous:null);if(!user)return;void api<SigningKeyList>("/api/signing-keys").then(next=>{if(active)setData(next);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[user?.id]);
  const own=data?.account===user?.id?data:null;
  async function act(body?:{label:string;publicKey:string},id?:string){
    if(busy)return;setError("");setStatus("");
    if(body&&/PRIVATE KEY/.test(body.publicKey)){setError("Keep private keys on your computer. Paste only the public signing key.");return;}
    setBusy(true);
    try{const next=await api<SigningKeyList>(`/api/signing-keys${id?`/${encodeURIComponent(id)}`:""}`,{method:id?"DELETE":"POST",...(body?{body}:{})});setData(next);setRevoking(null);setStatus(id?"Signing key revoked. Existing verification records are retained.":"Public signing key added to your account.");if(body){setLabel("");setPublicKey("");}title.current?.focus();}catch(e){setError((e as Error).message);if(e instanceof ApiError&&e.status===403)await refresh();}finally{setBusy(false);}
  }
  return <><TopBar crumbs={<span>Signing keys</span>}/><main className="mx-auto max-w-4xl space-y-8 px-5 py-8">
    <header className="space-y-2"><h1 ref={title} tabIndex={-1} className="text-2xl font-semibold tracking-tight">Signing keys</h1><p className="max-w-2xl text-sm leading-6 text-muted">Connect a public key to your account so Nanohub can verify signed Git commits. Your private key stays on your computer.</p></header>
    {error&&<div ref={failure} tabIndex={-1}><Notice error={error}/>{!own&&<Button size="sm" onClick={()=>{setError("");void api<SigningKeyList>("/api/signing-keys").then(setData).catch(e=>setError(e.message));}}>Retry loading keys</Button>}</div>}
    {status&&<p role="status" className="text-sm">{status}</p>}
    {!loaded?<p className="text-sm text-muted">Loading account…</p>:!user?<p className="text-sm"><a href={signIn} className="underline">Sign in</a> to manage your public signing keys.</p>:!own?<p className="text-sm text-muted">Loading signing keys…</p>:<>
      <section className="space-y-3 border-y border-line py-5" aria-label="Signing identity"><h2 className="text-sm font-semibold">Your signing email</h2><code className="block break-all text-sm">{own.signingEmail}</code><p className="max-w-2xl text-sm leading-6 text-muted">Use this address as your Git committer email to keep your account email out of commits, or choose a verified account email listed below. A signature must match an email bound to its registered key.</p><ul className="space-y-1 text-xs text-muted">{own.emails.filter(email=>email!==own.signingEmail).map(email=><li className="break-all" key={email}>{email}</li>)}</ul></section>
      <section className="space-y-4" aria-label="Registered signing keys"><h2 className="text-base font-semibold">Your public keys</h2>{!own.keys.length?<p className="text-sm text-muted">No signing keys yet. Add a public key below to verify your commits.</p>:<ul className="divide-y divide-line">{own.keys.map(key=><li key={key.id} className="space-y-3 py-5"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="break-words text-sm font-medium">{key.label}</h3><span className="text-xs text-muted">{key.kind==="pgp"?"OpenPGP":"SSH"} · {key.revokedAt?"Revoked":"Active"}</span></div><code className="block break-all text-xs">{key.fingerprint}</code><p className="break-all text-xs text-muted">{key.emails.join(", ")}</p><details><summary className="cursor-pointer text-xs underline">View public key</summary><pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded border border-line bg-wash p-3 text-xs">{key.publicKey}</pre></details>{!key.revokedAt&&(revoking===key.id?<div className="space-y-3"><p className="max-w-2xl text-sm leading-6 text-muted">Revocation blocks new verifications with this key. Previously verified commits keep their records. Add a new key to resume signing.</p><div className="flex flex-wrap gap-3"><Button disabled={busy} onClick={()=>void act(undefined,key.id)}>Confirm revocation</Button><Button disabled={busy} onClick={()=>setRevoking(null)}>Cancel revocation</Button></div></div>:<Button size="sm" disabled={busy} onClick={()=>setRevoking(key.id)}>Revoke signing key</Button>)}</li>)}</ul>}</section>
      <section className="space-y-4 border-t border-line pt-6" aria-label="Add public signing key"><h2 className="text-base font-semibold">Add a signing key</h2><p className="max-w-2xl text-sm leading-6 text-muted">Use an SSH Ed25519, RSA or NIST ECDSA public key, or an armored OpenPGP public key with a matching user ID. S/MIME certificates and hardware-backed SSH key formats are not supported yet.</p><form className="space-y-4" onSubmit={event=>{event.preventDefault();void act({label,publicKey});}}><label className="block space-y-1 text-sm">Key name<input className={field} required maxLength={100} value={label} onChange={event=>{setLabel(event.target.value);setError("");}} disabled={busy} placeholder="Work laptop"/></label><label className="block space-y-1 text-sm">Public signing key<textarea className={`${field} min-h-44 font-mono text-xs`} required maxLength={65536} value={publicKey} onChange={event=>{setPublicKey(event.target.value);setError("");}} disabled={busy} spellCheck={false} autoComplete="off" placeholder="ssh-ed25519 AAAA…"/></label><Button type="submit" variant="primary" disabled={busy||!label.trim()||!publicKey.trim()}>{busy?"Saving…":"Add public signing key"}</Button></form></section>
    </>}
  </main></>;
}
