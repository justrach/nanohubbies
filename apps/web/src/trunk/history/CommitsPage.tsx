import { ChevronLeft, ChevronRight, CircleDot, GitCommitHorizontal, SquareCode } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { Card } from "@/components/ui";
import { agentLabel, ago } from "@/lib/format";
import { history, orMissing } from "@/server/api";
import { Newer } from "../Newer";
import { commitHref, pathHref, trunkHref } from "../paths";
import type { CommitSummary } from "../types";

const PAGE = 30;

/** The trunk's history, newest first, a page at a time, grouped by day the
 *  way a git host groups commits. Rendered on the server; older pages are
 *  fixed once written, so they come from the cache. */
export async function CommitsPage({ trunk, from }: { trunk: string; from?: number }) {
  const page = await orMissing(history(trunk, from));
  if (from && page.commits[0]?.version !== from) notFound();
  const days = byDay(page.commits);
  const top = page.commits[0]?.version ?? page.head;
  const newer = from && top < page.head ? Math.min(page.head, top + PAGE) : null;

  return (
    <main className="mx-auto max-w-[1012px] px-5 py-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold tracking-tight text-ink">Commits</h1>
        <span className="text-sm text-muted">
          main, <span className="tabular">{page.head.toLocaleString("en-US")}</span> versions, one landed change each
        </span>
        {!from && <Newer version={page.head} />}
      </div>
      <ol className="space-y-6">
        {days.map(([day, commits]) => (
          <li key={day} className="relative pl-6">
            <span className="absolute top-1 bottom-0 left-[7px] w-px bg-line" aria-hidden />
            <GitCommitHorizontal size={15} className="absolute top-0.5 left-0 bg-page text-muted" aria-hidden />
            <h2 className="mb-2 text-xs font-medium text-ink-2">Changes on {day}</h2>
            <Card>
              <ul className="divide-y divide-line">
                {commits.map((c) => (
                  <Row key={c.version} trunk={trunk} c={c} />
                ))}
              </ul>
            </Card>
          </li>
        ))}
      </ol>
      <nav aria-label="Pages" className="mt-6 flex justify-center gap-2">
        <Pager href={newer === null ? null : newer >= page.head ? trunkHref(trunk, "/commits") : trunkHref(trunk, `/commits?from=${newer}`)}>
          <ChevronLeft size={14} aria-hidden /> Newer
        </Pager>
        <Pager href={page.next ? trunkHref(trunk, `/commits?from=${page.next}`) : null}>
          Older <ChevronRight size={14} aria-hidden />
        </Pager>
      </nav>
    </main>
  );
}

function Row({ trunk, c }: { trunk: string; c: CommitSummary }) {
  return (
    <li className="flex items-start gap-3 px-4 py-3 hover:bg-wash/60">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link prefetch={false} href={commitHref(trunk, c.version)} className="min-w-0 truncate text-[14px] font-medium text-ink hover:text-series-1 hover:underline">
            {c.subject || "(no message)"}
          </Link>
          {c.issue !== null && (
            <Link prefetch={false} href={trunkHref(trunk, `/issues#${c.issue}`)} className="flex items-center gap-1 rounded-full border border-line px-1.5 text-[11px] text-ink-2 hover:text-ink">
              <CircleDot size={11} aria-hidden /> {c.closes ? "closes" : ""} #{c.issue}
            </Link>
          )}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
          <Avatar name={agentLabel(c.agent)} size={16} />
          <span className="font-medium text-ink-2">{agentLabel(c.agent)}</span>
          {c.owner && <span>for {c.owner}</span>}
          <span>landed {ago(Date.now() - c.at)}</span>
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <span className="tabular rounded-md bg-wash px-1.5 py-0.5 text-[11px] text-ink-2">v{c.version.toLocaleString("en-US")}</span>
        <Link prefetch={false} href={commitHref(trunk, c.version)} className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[11px] text-ink-2 hover:bg-wash hover:text-ink">
          {c.commit.slice(0, 7)}
        </Link>
        <Link prefetch={false} href={pathHref(trunk, "tree", "", c.version)} title="Browse the files at this version" aria-label="Browse the files at this version" className="grid size-6 place-items-center rounded-md border border-line text-muted hover:bg-wash hover:text-ink">
          <SquareCode size={13} />
        </Link>
      </div>
    </li>
  );
}

function Pager({ href, children }: { href: string | null; children: React.ReactNode }) {
  const cls = "flex h-8 items-center gap-1 rounded-md border border-line px-3 text-xs font-medium";
  if (!href) return <span className={`${cls} text-muted opacity-50`}>{children}</span>;
  return (
    <Link prefetch={false} href={href} className={`${cls} text-ink hover:bg-wash`}>
      {children}
    </Link>
  );
}

/** Commits by the day they landed, in UTC, newest day first. */
function byDay(commits: CommitSummary[]): [string, CommitSummary[]][] {
  const out = new Map<string, CommitSummary[]>();
  for (const c of commits) {
    const day = new Date(c.at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
    out.set(day, [...(out.get(day) ?? []), c]);
  }
  return [...out];
}
