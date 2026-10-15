import { ExternalLink, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, type LucideIcon } from "lucide-react";
import { ago } from "@/lib/format";
import { AccessNote } from "./Access";
import { DiffCount } from "./badges";
import { GhAvatar, Who } from "./people";
import type { PullView } from "./types";

const STATES: Record<string, { label: string; color: string; Icon: LucideIcon }> = {
  open: { label: "Open", color: "var(--good)", Icon: GitPullRequest },
  draft: { label: "Draft", color: "var(--muted)", Icon: GitPullRequestDraft },
  merged: { label: "Merged", color: "var(--series-1)", Icon: GitMerge },
  closed: { label: "Closed", color: "var(--critical)", Icon: GitPullRequestClosed },
};

export function StatePill({ pull }: { pull: PullView }) {
  const s = STATES[pull.state === "open" && pull.draft ? "draft" : pull.state];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-ink"
      style={{ background: `color-mix(in srgb, ${s.color} 16%, transparent)` }}
    >
      <s.Icon size={14} strokeWidth={2.25} style={{ color: s.color }} aria-hidden />
      {s.label}
    </span>
  );
}

/** Title, state, who wants what merged where, and how big it is. */
export function Header({ pull }: { pull: PullView }) {
  const failing = pull.checks.filter((c) => c.conclusion === "failure" || c.conclusion === "timed_out" || c.conclusion === "action_required").length;
  const passed = pull.checks.filter((c) => c.conclusion === "success").length;
  const pending = pull.checks.filter((c) => c.status !== "completed").length;
  return (
    <header className="pull-review-header pt-7 pb-5">
      <p className="text-xs text-muted">
        <a href={`https://github.com/${pull.repo}`} target="_blank" rel="noreferrer" className="hover:text-ink">
          {pull.repo}
        </a>
      </p>
      <h1 className="mt-1.5 max-w-5xl text-[26px] leading-[1.25] font-semibold tracking-tight text-ink">
        {pull.title} <span className="font-normal text-muted">#{pull.number}</span>
      </h1>
      <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-2 text-[13px] text-ink-2">
        <StatePill pull={pull} />
        <GhAvatar person={pull.author} size={20} />
        <Who person={pull.author} />
        <span>
          {pull.state === "merged" ? "merged" : "wants to merge"} {pull.commits} commit{pull.commits === 1 ? "" : "s"} into <Branch name={pull.base} /> from{" "}
          <Branch name={pull.headRepo ? `${pull.headRepo}:${pull.head}` : pull.head} />
        </span>
        <span className="text-muted">· opened {ago(Date.now() - pull.created)}</span>
      </div>
      <div className="pull-review-summary mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-2">
        <DiffCount additions={pull.additions} deletions={pull.deletions} />
        <span className="tabular">{pull.changedFiles.toLocaleString("en-US")} files</span>
        {pull.checks.length > 0 && (
          <span className="tabular">
            {failing ? `${failing} failing check${failing === 1 ? "" : "s"}` : pending ? `${pending} check${pending === 1 ? "" : "s"} running` : `${passed} checks passed`}
          </span>
        )}
        {pull.labels.map((l) => (
          <span key={l.name} className="flex items-center gap-1">
            <span className="inline-block size-2 rounded-full" style={{ background: `#${l.color}` }} aria-hidden />
            {l.name}
          </span>
        ))}
        <span className="ml-auto flex items-center gap-4 text-muted">
          <AccessNote access={pull.access} />
          <a href={pull.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-ink">
            Open on GitHub <ExternalLink size={12} aria-hidden />
          </a>
        </span>
      </div>
    </header>
  );
}

export function Branch({ name }: { name: string }) {
  return <code className="rounded-md bg-wash px-1.5 py-0.5 font-mono text-[12px] text-ink">{name}</code>;
}
