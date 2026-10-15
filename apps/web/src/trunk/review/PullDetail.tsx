"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { GitPullRequest, GitMerge, ArrowDown } from "lucide-react";
import type { Branch, Pull, ReviewSnapshot } from "@swarm/api/review";
import { Button } from "@/components/controls";
import { Card, Pill } from "@/components/ui";
import { useSession } from "@/lib/session";
import { Files } from "@/pr/Files";
import type { ChangedFile } from "../types";
import { field, Notice, useReviewAction } from "./shared";

export type PullView = ReviewSnapshot & { pull: Pull; head: Branch; files: ChangedFile[]; truncated: string[] };

export function PullDetail({ trunk, view }: { trunk: string; view: PullView }) {
  const router = useRouter(), action = useReviewAction(trunk);
  const { user } = useSession();
  const p = view.pull, base = view.branches.find((b) => b.name === p.base);
  const parents: Pull[] = [], seen = new Set<number>([p.number]);
  for (let current = p;;) {
    const found = view.pulls.find((q) => current.parent ? q.number === current.parent : q.state === "open" && q.head === current.base);
    if (!found || seen.has(found.number)) break;
    parents.unshift(found); seen.add(found.number); current = found;
  }
  const children = view.pulls.filter((q) => q.state === "open" && (q.base === p.head || q.parent === p.number));
  const observed = { commit: view.head.commit, anchor: p.anchor };
  const run = (operation: string, extra: Record<string, unknown> = {}) => action.run(`/pulls/${p.number}/${operation}`, { ...observed, ...extra }, () => router.refresh());
  const reviews = view.reviews.filter((r) => r.pull === p.number);
  return <main className="mx-auto max-w-[1440px] space-y-5 px-5 py-8">
    <div className="flex items-center justify-between"><Link href={`/t/${trunk}/pulls`} className="text-xs text-muted hover:text-ink">← Pull requests</Link><Button size="sm" variant="ghost" onClick={() => router.refresh()}>Refresh</Button></div>
    <header className="space-y-3"><h1 className="text-2xl font-semibold tracking-tight text-ink">{p.title} <span className="font-normal text-muted">#{p.number}</span></h1>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted"><Pill>{p.state}</Pill><span>{p.author.name}</span><code>{p.base} ← {p.head}</code><code>{view.head.commit.slice(0, 7)}</code></div>
      {p.body && <p className="max-w-3xl whitespace-pre-wrap text-sm leading-6 text-ink-2">{p.body}</p>}
    </header>
    <Notice error={action.error} />
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="space-y-4 p-5"><h2 className="text-sm font-semibold text-ink">{p.state === "merged" ? "Merged into main" : p.state === "closed" ? "Closed without merging" : "Ready for review"}</h2>
        <p className="text-xs leading-5 text-muted">{p.state === "merged" ? `Landed as v${p.mergedVersion}. Dependent PRs now target main.` : p.state === "closed" ? "The final diff is retained below." : p.base !== "main" ? `Merge the PR for ${p.base} first. This diff includes only this layer’s changes.` : "Merge lands this PR through the workspace’s conflict checks."}</p>
        {p.state === "open" && <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={!user || action.busy || p.base !== "main"} onClick={() => void run("merge")}><GitMerge size={14} />{action.busy ? "Working…" : "Merge pull request"}</Button>
          <Button disabled={!user || action.busy || base?.commit === p.anchor} onClick={() => void run("restack")}>Restack onto {p.base}</Button>
          <Button variant="ghost" disabled={!user || action.busy} onClick={() => void run("close")}>Close</Button>
        </div>}
        {p.state === "open" && base?.commit !== p.anchor && <p className="text-xs text-muted">The base moved. Restack replays this layer on its latest commit; competing edits are left for you to resolve locally. Fetch the updated branch afterward.</p>}
      </Card>
      <Card className="p-5"><h2 className="mb-3 text-sm font-semibold text-ink">PR stack</h2><div className="space-y-2 text-xs">
        <span className="text-muted">main</span>{[...parents, p].map((q) => <div key={q.number}><ArrowDown size={12} className="my-2 text-muted" />
          <Link href={`/t/${trunk}/pulls/${q.number}`} aria-current={q.number === p.number ? "page" : undefined} className={`flex items-start gap-2 rounded-md p-2 ${q.number === p.number ? "bg-wash text-ink" : "text-muted hover:text-ink"}`}>
            <GitPullRequest size={14} className="mt-0.5 shrink-0" /><span>#{q.number} {q.title} {q.state === "merged" && "· merged"}<code className="mt-1 block break-all text-[11px] text-muted">{q.head}</code></span></Link></div>)}
        {children.length > 0 && <div className="border-t border-line pt-3"><p className="mb-2 text-muted">Dependent PRs</p>{children.map((q) => <Link key={q.number} href={`/t/${trunk}/pulls/${q.number}`} className="block py-1 text-series-1">#{q.number} {q.title}</Link>)}</div>}
      </div></Card>
    </div>
    <section aria-label="Changed files"><div className="mb-4 flex flex-wrap gap-4 text-xs text-muted"><span>{view.files.length} changed files</span><span className="text-series-1">+{view.files.reduce((n, f) => n + f.additions, 0)}</span><span>−{view.files.reduce((n, f) => n + f.deletions, 0)}</span>{view.truncated.map((t) => <span key={t}>{t}</span>)}</div>
      <Files local viewedKey={`${trunk}/pr/${p.number}/${view.head.commit}/${p.anchor}`} files={view.files.map((f) => ({ ...f, url: `/t/${trunk}/pulls/${p.number}/file?${new URLSearchParams({ path: f.path, side: f.status === "removed" ? "base" : "head" })}` }))} />
    </section>
    <Card className="p-5"><h2 className="mb-4 text-sm font-semibold text-ink">Reviews</h2>
      {!reviews.length && <p className="mb-4 text-xs text-muted">No reviews yet.</p>}
      <ul className="space-y-4">{reviews.map((r) => <li key={r.id} className="border-b border-line pb-4 text-sm"><div className="flex flex-wrap gap-2"><strong className="text-ink">{r.author.name}</strong><span className="text-xs text-muted">{r.verdict.toLowerCase().replaceAll("_", " ")}</span>
        {(r.commit !== view.head.commit || r.anchor !== p.anchor) && <span className="text-xs text-muted">· earlier revision</span>}</div><p className="mt-2 whitespace-pre-wrap text-ink-2">{r.body}</p></li>)}</ul>
      {user && p.state === "open" && <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); const form = new FormData(e.currentTarget); void run("reviews", { verdict: form.get("verdict"), body: form.get("body") }); }}>
        <label className="block space-y-1 text-xs text-muted">Review<textarea className={field} name="body" rows={3} maxLength={16000} placeholder="Leave feedback on this revision" /></label>
        <div className="flex flex-wrap gap-3"><select aria-label="Review decision" className={field + " max-w-56"} name="verdict"><option value="COMMENT">Comment</option><option value="APPROVE">Approve</option><option value="REQUEST_CHANGES">Request changes</option></select><Button disabled={action.busy} type="submit">Submit review</Button></div>
      </form>}
    </Card>
  </main>;
}
