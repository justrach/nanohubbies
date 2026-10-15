"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Branch, ReviewSnapshot } from "@swarm/api/review";
import { GitBranch, Folder, File } from "lucide-react";
import { Button, Commands } from "@/components/controls";
import { Card, LinkButton } from "@/components/ui";
import { api, trunkPath } from "@/lib/api";
import { useSession } from "@/lib/session";
import { field, Notice, useReviewAction } from "./shared";

type View = { branch: Branch; path: string; entries?: { name: string; directory: boolean }[]; text?: string };

export function Branches({ trunk, initial, selected = "", path = "" }: { trunk: string; initial: ReviewSnapshot; selected?: string; path?: string }) {
  const { user } = useSession();
  const [data, setData] = useState(initial);
  const [view, setView] = useState<View | null>(null);
  const [loadError, setLoadError] = useState("");
  const action = useReviewAction(trunk);
  useEffect(() => { setData(initial); }, [initial]);
  useEffect(() => {
    let current = true;
    setView(null); setLoadError("");
    if (selected) api<View>(`${trunkPath(trunk)}/branches/tree?${new URLSearchParams({ name: selected, path })}`)
      .then((v) => { if (current) setView(v); }).catch((e) => { if (current) setLoadError(e.message); });
    return () => { current = false; };
  }, [selected, path, trunk, data]);
  const href = (name: string, path = "") => `/t/${trunk}/branches?${new URLSearchParams({ name, path })}`;
  return <main className="mx-auto max-w-[1120px] space-y-5 px-5 py-8">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight text-ink">Branches</h1>
      <p className="mt-2 text-sm text-muted">Keep work on its own branch until it’s ready to land.</p></div><LinkButton href={`/t/${trunk}/pulls`}>Pull requests</LinkButton></header>
    <Notice error={action.error || loadError} />
    {user && <Card className="p-4"><form className="flex flex-wrap items-end gap-3" onSubmit={(e) => {
      e.preventDefault(); const form = e.currentTarget, values = new FormData(form);
      void action.run("/branches", { name: values.get("name"), from: values.get("from") }, (s) => { setData(s); form.reset(); });
    }}><label className="min-w-48 flex-1 space-y-1 text-xs text-muted">Branch name<input className={field} name="name" placeholder="agent/my-feature" required maxLength={128} /></label>
      <label className="min-w-40 space-y-1 text-xs text-muted">Create from<select className={field} name="from" defaultValue={selected || "main"}>{data.branches.map((b) => <option key={b.name}>{b.name}</option>)}</select></label>
      <Button type="submit" variant="primary" disabled={action.busy}>{action.busy ? "Creating…" : "Create branch"}</Button></form></Card>}
    <Card><ul className="divide-y divide-line">{data.branches.map((b) => <li key={b.name} className="flex flex-wrap items-center gap-3 px-4 py-3">
      <GitBranch size={16} className="text-series-1" /><Link className="min-w-0 flex-1 break-all text-sm font-medium text-ink hover:text-series-1" href={href(b.name)}>{b.name}</Link>
      {b.name === "main" && <span className="text-xs text-muted">Default</span>}<code className="text-xs text-muted">{b.commit.slice(0, 7)}</code>
    </li>)}</ul></Card>
    {selected && <Card className="overflow-hidden"><header className="flex flex-wrap items-center gap-3 border-b border-line p-4 text-sm text-ink"><GitBranch size={15} />
      <Link href={href(selected)}>{selected}</Link><span className="break-all text-muted">/ {path}</span>{view && <code className="ml-auto text-xs text-muted">{view.branch.commit.slice(0, 7)}</code>}</header>
      {!view ? <p className="p-5 text-sm text-muted">{loadError ? "Unable to load this path." : "Loading source…"}</p> : view.entries ? <ul className="divide-y divide-line text-sm">
        {path && <li><Link className="block px-4 py-2 text-series-1" href={href(selected, path.split("/").slice(0, -1).join("/"))}>..</Link></li>}
        {view.entries.map((e) => <li key={e.name}><Link className="flex items-center gap-3 px-4 py-2 text-ink hover:bg-wash" href={href(selected, [path, e.name].filter(Boolean).join("/"))}>
          {e.directory ? <Folder size={15} className="text-series-1" /> : <File size={15} className="text-muted" />}{e.name}</Link></li>)}
      </ul> : <pre className="max-h-[70vh] overflow-auto p-4 font-mono text-xs leading-6 text-ink-2">{view.text}</pre>}
    </Card>}
    <Card className="space-y-3 p-5"><h2 className="text-sm font-medium text-ink">Work on a branch</h2><p className="text-xs text-muted">In your workspace clone, fetch the branch, make a change, then push it for review.</p>
      <Commands code={`git fetch origin\ngit switch ${selected ? selected : "-c agent/my-feature"}\n# Make and commit your change\ngit push -u origin HEAD`} />
      <p className="text-xs text-muted">After restacking a PR here, fetch its updated branch before continuing local work.</p>
    </Card>
  </main>;
}
