"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { GitPullRequest, GitBranch, Plus } from "lucide-react";
import type { Pull, ReviewSnapshot } from "@swarm/api/review";
import { Button } from "@/components/controls";
import { Card, Empty, LinkButton, Pill } from "@/components/ui";
import { useSession } from "@/lib/session";
import { field, Notice, useReviewAction } from "./shared";

export function Pulls({ trunk, initial }: { trunk: string; initial: ReviewSnapshot }) {
  const router = useRouter();
  const { user } = useSession();
  const [creating, setCreating] = useState(false);
  const [state, setState] = useState<Pull["state"]>("open");
  const action = useReviewAction(trunk);
  const [head, setHead] = useState(initial.branches.find((b) => b.name !== "main")?.name ?? "");
  const [base, setBase] = useState("main");
  const rows = initial.pulls.filter((p) => p.state === state);
  const ordered: Pull[] = [], added = new Set<number>();
  function append(p: Pull) {
    if (added.has(p.number)) return;
    added.add(p.number); ordered.push(p);
    for (const child of rows.filter((q) => q.base === p.head).sort((a, b) => a.number - b.number)) append(child);
  }
  for (const root of rows.filter((p) => !rows.some((q) => q.head === p.base)).sort((a, b) => b.number - a.number)) append(root);
  for (const p of rows) append(p);
  const depth = (p: Pull) => {
    let n = 0, current = p;
    const seen = new Set<number>();
    while (n < 10 && !seen.has(current.number)) {
      seen.add(current.number);
      const parent = initial.pulls.find((q) => q.state === "open" && q.head === current.base);
      if (!parent) break;
      n++; current = parent;
    }
    return n;
  };
  return <main className="mx-auto max-w-[1120px] space-y-5 px-5 py-8">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-2xl font-semibold tracking-tight text-ink">Pull requests</h1>
        <p className="mt-2 text-sm text-muted">Review a branch. Stack the next change on top. Land them in order.</p></div>
      <div className="flex gap-2"><LinkButton href={`/t/${trunk}/branches`}><GitBranch size={14} /> Branches</LinkButton>
        <Button variant="primary" disabled={!user} onClick={() => setCreating(!creating)}><Plus size={14} /> New pull request</Button></div>
    </header>
    <Notice error={action.error} />
    {creating && <Card className="p-5"><form className="space-y-4" onSubmit={(event) => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      void action.run("/pulls", { title: form.get("title"), body: form.get("body"), head, base }, (s) => router.push(`/t/${trunk}/pulls/${s.pulls[0].number}`));
    }}>
      <h2 className="font-semibold text-ink">Open a pull request</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-xs text-muted">Head branch<select aria-label="Head branch" className={field} value={head} onChange={(e) => setHead(e.target.value)} required>
          <option value="" disabled>Choose a branch</option>{initial.branches.filter((b) => b.name !== "main").map((b) => <option key={b.name}>{b.name}</option>)}
        </select></label>
        <label className="space-y-1 text-xs text-muted">Base branch<select aria-label="Base branch" className={field} value={base} onChange={(e) => setBase(e.target.value)}>
          {initial.branches.filter((b) => b.name !== head).map((b) => <option key={b.name}>{b.name}</option>)}
        </select></label>
      </div>
      <p className="text-xs text-muted">To stack this PR, choose the previous PR’s head branch as its base.</p>
      <label className="block space-y-1 text-xs text-muted">Title<input className={field} name="title" required maxLength={200} placeholder="What does this change?" /></label>
      <label className="block space-y-1 text-xs text-muted">Description<textarea className={field} name="body" rows={3} maxLength={16000} placeholder="Why this change, and how was it tested?" /></label>
      <Button type="submit" variant="primary" disabled={action.busy || !head || head === base}>{action.busy ? "Opening…" : "Open pull request"}</Button>
      {!head && <p className="text-xs text-muted">Create and push a branch first.</p>}
    </form></Card>}
    <div className="flex gap-2" aria-label="Filter pull requests">{(["open", "merged", "closed"] as const).map((s) => <Button key={s} onClick={() => setState(s)} aria-pressed={state === s} variant={state === s ? "secondary" : "ghost"}>
      {s[0].toUpperCase() + s.slice(1)} <span className="text-muted">{initial.pulls.filter((p) => p.state === s).length}</span>
    </Button>)}</div>
    <Card>{!rows.length ? <Empty title={`No ${state} pull requests`}>
      Push a branch to this workspace, then open a PR. Each layer of a stack gets its own diff and review.
    </Empty> : <ul className="divide-y divide-line">{ordered.map((p) => {
      const parent = initial.pulls.find((q) => q.head === p.base && q.state === "open");
      return <li key={p.number} className="px-4 py-4 sm:px-5"><div className="flex gap-3" style={{ paddingLeft: Math.min(depth(p), 4) * 16 }}>
        <GitPullRequest size={18} className="mt-1 shrink-0 text-series-1" />
        <div className="min-w-0 flex-1"><Link className="font-medium text-ink hover:text-series-1" href={`/t/${trunk}/pulls/${p.number}`}>{p.title} <span className="font-normal text-muted">#{p.number}</span></Link>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted"><code>{p.base} ← {p.head}</code><span>by {p.author.name}</span></div>
          {parent && <Link href={`/t/${trunk}/pulls/${parent.number}`} className="mt-2 inline-block text-xs text-series-1">Stacked on #{parent.number} · {parent.title}</Link>}
          {!parent && p.base !== "main" && p.state === "open" && <p className="mt-2 text-xs text-muted">Open and merge a PR for {p.base} first.</p>}
        </div><Pill>{p.state}</Pill>
      </div></li>;
    })}</ul>}</Card>
    <Link href={`/t/${trunk}/pulls/upstream`} className="inline-block text-xs text-muted hover:text-ink">GitHub context and export →</Link>
  </main>;
}
