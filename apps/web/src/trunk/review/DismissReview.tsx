"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, trunkPath } from "@/lib/api";
import { Button } from "@/components/controls";
import { field, Notice } from "./shared";

export function DismissReview({trunk,pull,review,author}:{trunk:string;pull:number;review:number;author:string}) {
  const router=useRouter(),[open,setOpen]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const input=useRef<HTMLTextAreaElement>(null),trigger=useRef<HTMLButtonElement>(null),pending=useRef(false),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{if(open)input.current?.focus();},[open]);
  const close=()=>{setOpen(false);setError("");trigger.current?.focus();};
  async function dismiss() {
    if (pending.current || !message.trim()) return;
    pending.current=true;setBusy(true);setError("");
    try {
      await api(`${trunkPath(trunk)}/pulls/${pull}/reviews/${review}/dismissals`,{method:"PUT",body:{message}});
      if(mounted.current){setOpen(false);trigger.current?.closest("li")?.focus();router.refresh();}
    } catch(error) {if(mounted.current)setError((error as Error).message);}
    finally {pending.current=false;if(mounted.current)setBusy(false);}
  }
  return <div className="mt-3">
    <Button ref={trigger} size="sm" variant="ghost" aria-expanded={open} aria-controls={`dismiss-review-${review}`} onClick={()=>{if(open)close();else setOpen(true);}} disabled={busy}>Dismiss review</Button>
    {open&&<form id={`dismiss-review-${review}`} aria-label={`Dismiss ${author}'s review`} className="mt-3 max-w-[70ch] space-y-3" onSubmit={event=>{event.preventDefault();void dismiss();}}>
      <p className="text-xs leading-5 text-muted">Dismissal removes this review’s approval or blocking effect. The original review and your reason remain visible.</p>
      <label className="block space-y-1 text-xs text-muted">Reason for dismissal
        <textarea ref={input} className={field} value={message} onChange={event=>setMessage(event.target.value)} required maxLength={16000} rows={3} disabled={busy}/>
      </label>
      <Notice error={error}/>
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy||!message.trim()}>{busy?"Dismissing…":"Confirm dismissal"}</Button><Button variant="ghost" onClick={close} disabled={busy}>Cancel</Button></div>
    </form>}
  </div>;
}
