import { ExternalLink } from "lucide-react";
import { useMemo } from "react";
import { ago } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Md } from "./Md";
import { markWords, parsePatch, type Hunk, type Row } from "./patch";
import { GhAvatar, Who } from "./people";
import { Rows } from "./Rows";
import { highlightRows } from "./syntax";
import type { Thread } from "./types";

/** A review thread, drawn under the line it is about. `original` is the code
 *  the thread covers, so a suggested change can be shown as a diff of it. */
export function ThreadCard({ thread, original, lang, inset = true }: { thread: Thread; original: string[]; lang: string | null; inset?: boolean }) {
  return (
    <div className={cn("my-2 max-w-[780px] rounded-lg border border-line bg-page font-sans text-[13px] shadow-sm", inset ? "mr-4 ml-[var(--code-inset)]" : "mx-3")}>
      {thread.comments.map((c, i) => (
        <div key={c.id} className={cn("px-3.5 py-2.5", i > 0 && "border-t border-line")}>
          <div className="flex items-center gap-2 text-xs">
            <GhAvatar person={c.author} size={20} />
            <Who person={c.author} />
            <span className="text-muted">{ago(Date.now() - c.at)}</span>
            <a href={c.url} target="_blank" rel="noreferrer" aria-label="Open on GitHub" className="ml-auto text-muted hover:text-ink">
              <ExternalLink size={12} />
            </a>
          </div>
          <Md
            text={c.body}
            lang={lang}
            className="mt-1.5 leading-6 text-ink-2"
            suggestion={(code) => <Suggestion before={original} after={code.split("\n")} lang={lang} />}
          />
        </div>
      ))}
    </div>
  );
}

/** A ```suggestion block: the lines it replaces, then the lines it proposes. */
function Suggestion({ before, after, lang }: { before: string[]; after: string[]; lang: string | null }) {
  const { hunks, pieces } = useMemo(() => {
    const rows: Row[] = [
      ...before.map((text): Row => ({ kind: "del", old: null, new: null, text, words: [] })),
      ...after.map((text): Row => ({ kind: "add", old: null, new: null, text, words: [] })),
    ];
    markWords(rows);
    const hunk: Hunk = { oldStart: 1, oldLines: before.length, newStart: 1, newLines: after.length, section: "", hidden: 0, rows };
    return { hunks: [hunk], pieces: highlightRows(rows, lang) };
  }, [before, after, lang]);
  return (
    <div className="my-2 overflow-hidden rounded-md border border-line">
      <p className="border-b border-line bg-wash px-3 py-1 text-[11px] font-medium text-ink-2">Suggested change</p>
      <div className="diff syn compact">
        <Rows hunks={hunks} pieces={pieces} />
      </div>
    </div>
  );
}

/** Threads on code that has changed since: each with the diff it was written
 *  against, its last few lines, since the comment is on the last one. */
export function OutdatedThreads({ threads, lang }: { threads: Thread[]; lang: string | null }) {
  return (
    <div className="border-t border-line bg-page/40 py-2">
      <p className="px-4 pb-1 font-sans text-[11px] font-medium text-muted">
        {threads.length} outdated thread{threads.length === 1 ? "" : "s"}: the code under {threads.length === 1 ? "it" : "them"} has changed
      </p>
      {threads.map((t) => (
        <Outdated key={t.id} thread={t} lang={lang} />
      ))}
    </div>
  );
}

function Outdated({ thread, lang }: { thread: Thread; lang: string | null }) {
  const { hunks, pieces, original } = useMemo(() => {
    const parsed = parsePatch(thread.hunk);
    const rows = parsed.flatMap((h) => h.rows).slice(-4);
    const hunk: Hunk = { oldStart: 0, oldLines: 0, newStart: 0, newLines: 0, section: "", hidden: 0, rows };
    return { hunks: [hunk], pieces: highlightRows(rows, lang), original: rows.slice(-1).map((r) => r.text) };
  }, [thread.hunk, lang]);
  return (
    <div className="mx-4 my-2 overflow-hidden rounded-md border border-line">
      <div className="diff syn opacity-80">
        <Rows hunks={hunks} pieces={pieces} />
      </div>
      <ThreadCard thread={thread} original={original} lang={lang} inset={false} />
    </div>
  );
}
