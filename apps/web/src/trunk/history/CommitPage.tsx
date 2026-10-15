import { ArrowLeft, ArrowRight, CircleDot, SquareCode } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { LinkButton } from "@/components/ui";
import { agentLabel, ago } from "@/lib/format";
import { DiffCount } from "@/pr/badges";
import { at, commit, orMissing } from "@/server/api";
import { commitHref, pathHref, trunkHref } from "../paths";
import { ChangeFiles } from "./ChangeFiles";

/** Trailers the page already says in words. */
const SHOWN = new Set(["Agent", "On-behalf-of", "Version", "Issue", "Closes"]);

/** One landed version: what the change said it does, who made it for whom,
 *  what it built on, and its diff, file by file. Rendered on the server and
 *  cached by commit: a version never changes. */
export async function CommitPage({ trunk, id }: { trunk: string; id: string }) {
  const sha = /^\d{1,12}$/.test(id) ? (await orMissing(at(trunk, Number(id)))).commit : /^[0-9a-f]{40}$/.test(id) ? id : notFound();
  const [view, head] = await Promise.all([orMissing(commit(trunk, id, sha)), at(trunk)]);
  const additions = view.files.reduce((n, f) => n + f.additions, 0);
  const deletions = view.files.reduce((n, f) => n + f.deletions, 0);
  const trailers = view.trailers.filter(([k]) => !SHOWN.has(k));

  return (
    <main className="mx-auto max-w-[1440px] px-5 pt-6 pb-24">
      <header className="mb-5 rounded-xl border border-line bg-surface">
        <div className="px-5 pt-4 pb-3">
          <div className="flex flex-wrap items-start gap-3">
            <h1 className="min-w-0 flex-1 text-xl leading-snug font-semibold tracking-tight text-ink">{view.subject || "(no message)"}</h1>
            <LinkButton href={pathHref(trunk, "tree", "", view.version)} size="sm">
              <SquareCode size={13} aria-hidden /> Browse files
            </LinkButton>
          </div>
          {view.body && <p className="mt-2 max-w-[90ch] text-[13px] leading-6 whitespace-pre-line text-ink-2">{view.body}</p>}
          {(trailers.length > 0 || view.issue !== null) && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {view.issue !== null && (
                <Link href={trunkHref(trunk, `/issues#${view.issue}`)} className="flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-2 hover:text-ink">
                  <CircleDot size={11} aria-hidden /> {view.closes ? "Closes" : "Works on"} #{view.issue}
                </Link>
              )}
              {trailers.map(([k, v], i) => (
                <span key={i} title={`${k}: ${v}`} className="max-w-full truncate rounded-full bg-wash px-2 py-0.5 font-mono text-[11px] text-ink-2">
                  {k}: {v}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line bg-wash/50 px-5 py-2.5 text-xs text-ink-2">
          <span className="flex items-center gap-1.5">
            <Avatar name={agentLabel(view.agent)} size={18} />
            <span className="font-medium text-ink">{agentLabel(view.agent)}</span>
            {view.owner && <span className="text-muted">for {view.owner}</span>}
            <span className="text-muted">landed {ago(Date.now() - view.at)}</span>
          </span>
          <span className="tabular rounded-md bg-surface px-1.5 py-0.5 text-[11px]">v{view.version.toLocaleString("en-US")}</span>
          <code className="font-mono text-[11px] text-muted">{view.commit}</code>
          <span className="ml-auto flex items-center gap-2">
            {view.parent && (
              <Link href={commitHref(trunk, view.parent)} className="flex items-center gap-1 hover:text-ink">
                <ArrowLeft size={13} aria-hidden /> v{view.parent}
              </Link>
            )}
            {view.version < head.version && (
              <Link href={commitHref(trunk, view.version + 1)} className="flex items-center gap-1 hover:text-ink">
                v{view.version + 1} <ArrowRight size={13} aria-hidden />
              </Link>
            )}
          </span>
        </div>
      </header>
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-2">
        <span className="tabular">
          {view.files.length.toLocaleString("en-US")} file{view.files.length === 1 ? "" : "s"} changed
        </span>
        <DiffCount additions={additions} deletions={deletions} />
        {view.truncated.map((t) => (
          <span key={t} className="text-muted">
            {t}
          </span>
        ))}
      </div>
      <ChangeFiles trunk={trunk} files={view.files} v={view.version} viewedKey={`${trunk}@${view.commit}`} />
    </main>
  );
}
