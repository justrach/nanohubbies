"use client";
import { useEffect, useState } from "react";
import { Button, CopyButton, Input } from "./controls";

/** A manual-copy path remains available when a browser denies clipboard APIs. */
export function OneTimeToken({value}:{value:string}) {
  const [visible,setVisible]=useState(false);
  useEffect(()=>setVisible(false),[value]);
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      {visible?<code aria-label="Revealed Git token" className="min-w-0 max-w-sm flex-1 select-all break-all rounded border border-line bg-page px-3 py-2 text-xs">{value}</code>:<Input aria-label="New Git token" type="password" readOnly value={value} className="min-w-0 max-w-sm flex-1"/>}
      <Button size="sm" aria-pressed={visible} onClick={()=>setVisible(!visible)}>{visible?"Hide token":"Show token"}</Button>
      <CopyButton text={value} label="Copy Git token"/>
    </div>
    {visible&&<p className="text-xs leading-5 text-muted">If Copy is unavailable, select the token above and copy it manually.</p>}
  </div>;
}
