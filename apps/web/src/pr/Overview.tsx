import { CircleCheck, CircleDashed, CircleDot, CircleMinus, CircleX, GitCommitHorizontal, LoaderCircle, MessageSquare, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { ago } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Md } from "./Md";
import { areas, readingOrder } from "./order";
import { GhAvatar, Who } from "./people";
import type { Activity, Check, PullView, ReviewState } from "./types";

/** What the pull request says, what happened on it, and, at the side, how its
 *  checks and reviews stand and where in the tree it lands. */
export function Overview({ pull, onFiles }: { pull: PullView; onFiles: () => void }) {
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-6">
        <article className="rounded-xl border border-line bg-surface">
          <header className="flex items-center gap-2 border-b border-line px-5 py-3 text-xs">
            <GhAvatar person={pull.author} size={22} />
            <Who person={pull.author} />
            <span className="text-muted">opened this {ago(Date.now() - pull.created)}</span>
          </header>
          <div className="px-6 py-5">
            {pull.body.trim() ? <Md text={pull.body} className="max-w-[74ch] text-[14px] leading-7 text-ink-2" /> : <p className="text-sm text-muted">No description.</p>}
          </div>
        </article>
        <Timeline activity={pull.activity} onFiles={onFiles} />
      </div>
      <aside className="space-y-6 text-xs">
        <Checks checks={pull.checks} />
        <Reviewers pull={pull} />
        <Side title="Reading order" hint="The Files tab groups files this way">
          <ul className="space-y-1">
            {readingOrder(pull.files).map((g) => (
              <li key={g.role}>
                <button type="button" onClick={onFiles} className="flex w-full justify-between rounded px-1 py-0.5 text-ink-2 hover:bg-wash hover:text-ink">
                  <span>{g.label}</span>
                  <span className="tabular text-muted">{g.files.length}</span>
                </button>
              </li>
            ))}
          </ul>
        </Side>
        <Areas pull={pull} />
        {pull.truncated.length > 0 && <p className="text-muted">Showing {pull.truncated.join("; ")}.</p>}
      </aside>
    </div>
  );
}

function Side({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[11px] font-semibold tracking-wide text-muted uppercase">{title}</h3>
      {hint && <p className="mt-0.5 text-[11px] text-muted">{hint}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

const CHECK: Record<string, { label: string; color: string; Icon: LucideIcon }> = {
  success: { label: "passed", color: "var(--good)", Icon: CircleCheck },
  failure: { label: "failed", color: "var(--critical)", Icon: CircleX },
  timed_out: { label: "timed out", color: "var(--critical)", Icon: CircleX },
  action_required: { label: "needs action", color: "var(--warning)", Icon: CircleDot },
  cancelled: { label: "cancelled", color: "var(--muted)", Icon: CircleMinus },
  skipped: { label: "skipped", color: "var(--muted)", Icon: CircleDashed },
  neutral: { label: "neutral", color: "var(--muted)", Icon: CircleDashed },
};
const RUNNING = { label: "running", color: "var(--series-1)", Icon: LoaderCircle };

function Checks({ checks }: { checks: Check[] }) {
  if (!checks.length) return null;
  const look = (c: Check) => (c.status !== "completed" ? RUNNING : (CHECK[c.conclusion ?? ""] ?? CHECK.neutral));
  const order = (c: Check) => ["failed", "timed out", "needs action", "running", "passed"].indexOf(look(c).label);
  const counts = new Map<string, number>();
  for (const c of checks) counts.set(look(c).label, (counts.get(look(c).label) ?? 0) + 1);
  return (
    <Side title="Checks" hint={[...counts].map(([label, n]) => `${n} ${label}`).join(" · ")}>
      <ul className="max-h-64 space-y-0.5 overflow-auto">
        {[...checks]
          .sort((a, b) => (order(b) === -1 ? -1 : order(a) === -1 ? 1 : order(a) - order(b)))
          .map((c, i) => {
            const s = look(c);
            return (
              <li key={i}>
                <a href={c.url ?? undefined} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded px-1 py-0.5 text-ink-2 hover:bg-wash hover:text-ink">
                  <s.Icon size={13} strokeWidth={2.25} style={{ color: s.color }} className="shrink-0" aria-label={s.label} />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className="text-[10.5px] text-muted">{s.label}</span>
                </a>
              </li>
            );
          })}
      </ul>
    </Side>
  );
}

const REVIEW: Record<ReviewState, { label: string; color: string; Icon: LucideIcon }> = {
  approved: { label: "approved", color: "var(--good)", Icon: CircleCheck },
  changes_requested: { label: "asked for changes", color: "var(--warning)", Icon: CircleX },
  commented: { label: "commented", color: "var(--muted)", Icon: MessageSquare },
  dismissed: { label: "dismissed", color: "var(--muted)", Icon: CircleMinus },
  pending: { label: "review requested", color: "var(--muted)", Icon: CircleDashed },
};

function Reviewers({ pull }: { pull: PullView }) {
  return (
    <Side title="Reviewers">
      {pull.reviewers.length === 0 ? (
        <p className="text-muted">No reviews yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {pull.reviewers.map(({ person, state }) => {
            const s = REVIEW[state];
            return (
              <li key={person.login} className="flex items-center gap-2">
                <GhAvatar person={person} size={18} />
                <Who person={person} />
                <span className="ml-auto flex items-center gap-1 text-[11px] text-ink-2">
                  <s.Icon size={12} strokeWidth={2.25} style={{ color: s.color }} aria-hidden /> {s.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Side>
  );
}

function Areas({ pull }: { pull: PullView }) {
  const list = areas(pull.files).slice(0, 6);
  const max = Math.max(1, ...list.map((a) => a.additions + a.deletions));
  return (
    <Side title="Where it changes" hint="Lines added and removed, per folder">
      <ul className="space-y-2">
        {list.map((a) => (
          <li key={a.dir}>
            <div className="flex justify-between gap-2">
              <span className="truncate font-mono text-[11px] text-ink-2" title={a.dir}>
                {a.dir}
              </span>
              <span className="tabular shrink-0 font-mono text-[11px]">
                <span className="text-good-text">+{a.additions.toLocaleString("en-US")}</span> <span className="text-critical">−{a.deletions.toLocaleString("en-US")}</span>
              </span>
            </div>
            <div className="mt-1 flex h-1.5 gap-px overflow-hidden rounded-full bg-wash">
              <div style={{ width: `${(100 * a.additions) / max}%`, background: "var(--good)" }} />
              <div style={{ width: `${(100 * a.deletions) / max}%`, background: "var(--critical)" }} />
            </div>
          </li>
        ))}
      </ul>
    </Side>
  );
}

/** Comments, reviews and pushes in the order they happened. Runs of commits
 *  by one person fold into one entry. */
function Timeline({ activity, onFiles }: { activity: Activity[]; onFiles: () => void }) {
  const items: (Activity | { kind: "push"; commits: Extract<Activity, { kind: "commit" }>[] })[] = [];
  for (const a of activity) {
    const last = items[items.length - 1];
    if (a.kind === "commit" && last?.kind === "push" && last.commits[0].author?.login === a.author?.login) last.commits.push(a);
    else items.push(a.kind === "commit" ? { kind: "push", commits: [a] } : a);
  }
  if (!items.length) return null;
  return (
    <section>
      <h2 className="mb-3 text-[13px] font-semibold text-ink">Activity</h2>
      <ol className="relative space-y-4 border-l border-line pl-6">
        {items.map((it, i) => (
          <li key={i} className="relative">
            <span className="absolute top-0.5 -left-[33px] grid size-[18px] place-items-center rounded-full border border-line bg-page text-muted">
              {it.kind === "push" ? <GitCommitHorizontal size={11} /> : <MessageSquare size={10} />}
            </span>
            {it.kind === "push" ? <Push commits={it.commits} /> : it.kind !== "commit" && <Said item={it} onFiles={onFiles} />}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Push({ commits }: { commits: Extract<Activity, { kind: "commit" }>[] }) {
  const who = commits[0].author;
  return (
    <div className="text-xs">
      <p className="flex items-center gap-2 text-ink-2">
        {who && <GhAvatar person={who} size={18} />}
        {who ? <Who person={who} /> : "Someone"} pushed {commits.length} commit{commits.length === 1 ? "" : "s"}
        <span className="text-muted">{ago(Date.now() - commits[commits.length - 1].at)}</span>
      </p>
      <ul className="mt-1.5 space-y-0.5">
        {commits.map((c) => (
          <li key={c.sha} className="flex items-center gap-2">
            <a href={c.url} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-muted hover:text-ink">
              {c.sha.slice(0, 7)}
            </a>
            <span className="truncate text-ink-2">{c.message.split("\n")[0]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Said({ item, onFiles }: { item: Exclude<Activity, { kind: "commit" }>; onFiles: () => void }) {
  const [full, setFull] = useState(item.body.length < 1500);
  const review = item.kind === "review" ? REVIEW[item.state] : null;
  return (
    <div className="rounded-xl border border-line bg-surface">
      <p className="flex items-center gap-2 border-b border-line px-4 py-2 text-xs text-ink-2">
        <GhAvatar person={item.author} size={18} />
        <Who person={item.author} />
        {review ? (
          <span className="flex items-center gap-1">
            <review.Icon size={12} strokeWidth={2.25} style={{ color: review.color }} aria-hidden />
            {review.label}
          </span>
        ) : (
          "commented"
        )}
        {item.kind === "review" && item.inline > 0 && (
          <button type="button" onClick={onFiles} className="text-muted underline-offset-2 hover:text-ink hover:underline">
            {item.inline} comment{item.inline === 1 ? "" : "s"} on the code
          </button>
        )}
        <a href={item.url} target="_blank" rel="noreferrer" className="ml-auto text-muted hover:text-ink">
          {ago(Date.now() - item.at)}
        </a>
      </p>
      {item.body.trim() && (
        <div className={cn("relative px-4 py-3", !full && "max-h-72 overflow-hidden")}>
          <Md text={item.body} className="text-[13px] leading-6 text-ink-2" />
          {!full && (
            <button type="button" onClick={() => setFull(true)} className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-surface pt-10 pb-2 text-xs text-ink-2 hover:text-ink">
              Show all of it
            </button>
          )}
        </div>
      )}
    </div>
  );
}
