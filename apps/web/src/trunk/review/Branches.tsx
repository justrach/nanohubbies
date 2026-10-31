"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {useRouter} from 'next/navigation';
import type { Branch, ReviewSnapshot } from "@swarm/api/review";
import { GitBranch, Folder, File, Search, ShieldCheck } from "lucide-react";
import { Button, Commands } from "@/components/controls";
import { Card, LinkButton } from "@/components/ui";
import { api, trunkPath } from "@/lib/api";
import {useTrunk} from "../context";
import { useSession } from "@/lib/session";
import { field, Notice, useReviewAction } from "./shared";
import {branchWorkCommands} from "@swarm/api/connect";
import {BranchRename} from './BranchRename';

type View = { branch: Branch; path: string; entries?: { name: string; directory: boolean }[]; text?: string };

export function Branches({ trunk, initial, selected = "", path = "" }: { trunk: string; initial: ReviewSnapshot; selected?: string; path?: string }) {
  const { user } = useSession();
  const router=useRouter();
  const {readOnly}=useTrunk();
  const [creating,setCreating]=useState(false),[query,setQuery]=useState("");
  const createButton=useRef<HTMLButtonElement>(null);
  const [data, setData] = useState(initial);
  const [view, setView] = useState<View | null>(null);
  const [loadError, setLoadError] = useState("");
  const [renaming,setRenaming]=useState<string|null>(null),[notice,setNotice]=useState('');
  const renameTrigger=useRef<HTMLButtonElement|null>(null);
  const noticeRef=useRef<HTMLParagraphElement|null>(null);
  useEffect(()=>{if(notice)noticeRef.current?.focus();},[notice]);
  const action = useReviewAction(trunk);
  useEffect(() => { setData(initial); }, [initial]);
  useEffect(() => {
    let current = true;
    setView(null); setLoadError("");
    if (selected) api<View>(`${trunkPath(trunk)}/branches/tree?${new URLSearchParams({ name: selected, path })}`)
      .then((v) => { if (current){setView(v);if(v.branch.name!==selected)router.replace(`/t/${trunk}/branches?${new URLSearchParams({name:v.branch.name,path})}`);} }).catch((e) => { if (current) setLoadError(e.message); });
    return () => { current = false; };
  }, [selected, path, trunk, data,router]);
  const href = (name: string, path = "") => `/t/${trunk}/branches?${new URLSearchParams({ name, path })}`;
  const branches=data.branches.filter(b=>b.name.toLowerCase().includes(query.toLowerCase()));
  const rulesHref=`/t/${trunk}/settings/rules`;
  return <main className="branch-page">
    <header className="branch-heading"><h1>Branches</h1><div className="flex items-center gap-3"><Link className="branch-rules-link" href={rulesHref}><ShieldCheck size={14} aria-hidden/>Rules</Link>{user&&!readOnly&&data.branches.length>0&&<Button ref={createButton} variant="primary" size="sm" aria-expanded={creating} aria-controls="create-branch-form" onClick={()=>setCreating(!creating)}>New branch</Button>}</div></header>
    <Notice error={action.error || loadError} />
    {notice&&<p ref={noticeRef} tabIndex={-1} className="text-sm text-ink" role="status">{notice}</p>}
    {creating&&!readOnly&&<form id="create-branch-form" className="branch-create" onSubmit={e=>{
      e.preventDefault();const form=e.currentTarget,values=new FormData(form);
      void action.run("/branches",{name:values.get("name"),from:values.get("from")},s=>{setData(s);setCreating(false);setQuery("");createButton.current?.focus();});
    }}>
      <label>Branch name<input className={field} name="name" autoFocus placeholder="feature/my-change" required maxLength={244}/></label>
      <label>Create from<select className={field} name="from" defaultValue={selected||data.defaultBranch||"main"}>{data.branches.map(b=><option key={b.name}>{b.name}</option>)}</select></label>
      <div className="branch-create-actions"><Button type="submit" variant="primary" size="sm" disabled={action.busy}>{action.busy?"Creating…":"Create branch"}</Button><Button size="sm" variant="ghost" disabled={action.busy} onClick={()=>{setCreating(false);createButton.current?.focus();}}>Cancel</Button></div>
    </form>}
    <div className="branch-toolbar"><label className="branch-search"><Search size={14} aria-hidden/><span className="sr-only">Find a branch</span><input type="search" placeholder="Find a branch…" value={query} onChange={e=>setQuery(e.target.value)}/></label><span className="text-xs text-muted" aria-live="polite">{branches.length} {branches.length===1?"branch":"branches"}</span></div>
    <section className="branch-list" aria-label="Repository branches"><ul>{branches.map(b=><li className="branch-row" key={b.name}>
      <GitBranch size={15} className="text-muted" aria-hidden/><div className="branch-row-name"><Link href={href(b.name)}><bdi>{b.name}</bdi></Link>{b.name===(data.defaultBranch??"main")&&<span>Default</span>}</div>
      {data.effectivePolicies?.[b.name]&&<Link className="branch-row-protection" href={rulesHref} aria-label={`Protection rules for ${b.name}`}><ShieldCheck size={14} aria-hidden/></Link>}
      <code className="branch-row-sha">{b.commit.slice(0,7)}</code>
      {user&&!readOnly&&data.repositoryMode&&data.canManagePulls&&<Button size="sm" variant="ghost" aria-expanded={renaming===b.name} onClick={event=>{renameTrigger.current=event.currentTarget;setRenaming(renaming===b.name?null:b.name);setNotice('');}}>Rename<span className="sr-only"> {b.name}</span></Button>}
      {renaming===b.name&&!readOnly&&<BranchRename trunk={trunk} from={b.name} onCancel={()=>{setRenaming(null);renameTrigger.current?.focus();}} onInspect={()=>{setRenaming(null);router.refresh();}} onRenamed={result=>{
       setRenaming(null);setNotice(`Renamed ${result.renamed.from} to ${result.renamed.to}.`);setData(current=>({...current,defaultBranch:result.defaultBranch,branches:result.branches}));
       if(selected===result.renamed.from)router.replace(href(result.renamed.to,path));router.refresh();
      }}/>}
    </li>)}</ul>{!branches.length&&<p className="px-4 py-8 text-sm text-muted">{data.branches.length?"No branches match your search.":`Push your first commit to create ${data.defaultBranch??"main"}.`}</p>}</section>
    {selected && <Card className="overflow-hidden"><header className="flex flex-wrap items-center gap-3 border-b border-line p-4 text-sm text-ink"><GitBranch size={15} />
      <Link href={href(selected)} className="min-w-0 break-all"><bdi>{selected}</bdi></Link><span className="break-all text-muted">/ {path}</span>{view && <code className="ml-auto text-xs text-muted">{view.branch.commit.slice(0, 7)}</code>}</header>
      {!view ? <p className="p-5 text-sm text-muted">{loadError ? "Unable to load this path." : "Loading source…"}</p> : view.entries ? <ul className="divide-y divide-line text-sm">
        {path && <li><Link className="block px-4 py-2 text-series-1" href={href(selected, path.split("/").slice(0, -1).join("/"))}>..</Link></li>}
        {view.entries.map((e) => <li key={e.name}><Link className="flex items-center gap-3 px-4 py-2 text-ink hover:bg-wash" href={href(selected, [path, e.name].filter(Boolean).join("/"))}>
          {e.directory ? <Folder size={15} className="text-series-1" /> : <File size={15} className="text-muted" />}{e.name}</Link></li>)}
      </ul> : <pre className="max-h-[70vh] overflow-auto p-4 font-mono text-xs leading-6 text-ink-2">{view.text}</pre>}
    </Card>}
    <footer className="branch-footer"><details><summary>Git commands</summary><div className="mt-3">{selected&&<p className="mb-2 max-w-[72ch] text-xs leading-5 text-muted">Work from the fetched commit. The final command updates this exact remote branch.</p>}<Commands code={branchWorkCommands(selected)}/></div></details><Link href={`/t/${trunk}/connect`}>Git access</Link><Link href={rulesHref}>Rules and protection</Link></footer>
  </main>;
}
