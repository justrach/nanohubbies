import { ChevronRight, ExternalLink, MessageSquare } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Md } from "./Md";
import { outlineRule } from "./order";
import { parsePatch, type Row } from "./patch";
import { DiffCount, StatusBadge } from "./badges";
import { Rows } from "./Rows";
import { highlightRows, languageOf } from "./syntax";
import { OutdatedThreads, ThreadCard } from "./Thread";
import type { PullFile, Thread } from "./types";

/** Rows past this many wait behind a button. */
const SHOW = 400;
const ROW_PX = 20;

/** One file of a pull request, or of a trunk's version (`local`): a header
 *  that stays in view while you read it, then the diff, drawn only once it
 *  scrolls near the screen. */
export function FileDiff(props: { file: PullFile; index: number; threads: Thread[]; viewed: boolean; onViewed: () => void; local?: boolean }) {
  const { file, index, threads, viewed } = props;
  const [open, setOpen] = useState(!file.generated && !viewed);
  // A new document reads best rendered; its source is one click away.
  const doc = file.status === "added" && !!file.patch && /\.(md|mdx|markdown)$/i.test(file.path);
  const [rendered, setRendered] = useState(doc);
  const [near, setNear] = useState(false);
  const [all, setAll] = useState(false);
  const body = useRef<HTMLDivElement | null>(null);

  // Marking a file viewed folds it away, the way a reviewer works down a list.
  useEffect(() => {
    if (viewed) setOpen(false);
  }, [viewed]);
  useEffect(() => {
    if (near || !open || !body.current) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { rootMargin: "1500px 0px" });
    io.observe(body.current);
    return () => io.disconnect();
  }, [near, open]);

  const hunks = useMemo(() => (file.patch ? parsePatch(file.patch) : []), [file.patch]);
  const rows = useMemo(() => hunks.flatMap((h) => h.rows), [hunks]);
  const lang = languageOf(file.path);
  const pieces = useMemo(() => (near && open ? highlightRows(rows, lang) : []), [near, open, rows, lang]);
  const outline = useMemo(() => outlineOf(file.path, rows), [file.path, rows]);
  const anchored = threads.filter((t) => t.line !== null);
  const outdated = threads.filter((t) => t.line === null);
  const limit = all || rows.length <= SHOW + 100 ? undefined : SHOW;
  const comments = threads.reduce((n, t) => n + t.comments.length, 0);

  const threadsAt = (r: Row) =>
    anchored
      .filter((t) => (t.side === "RIGHT" ? r.kind !== "del" && r.new === t.line : r.kind !== "add" && r.old === t.line))
      .map((t) => <ThreadCard key={t.id} thread={t} original={coveredBy(t, rows)} lang={lang} />);

  return (
    <section id={`file-${index}`} className="scroll-mt-16 rounded-xl border border-line bg-surface">
      <header className={cn("sticky top-12 z-10 flex items-center gap-2 border-line bg-surface/95 px-3 py-2 backdrop-blur", open ? "rounded-t-xl border-b" : "rounded-xl")}>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? "Fold" : "Unfold"} className="grid size-6 place-items-center rounded text-muted hover:bg-wash hover:text-ink">
          <ChevronRight size={15} className={cn("transition-transform", open && "rotate-90")} />
        </button>
        <StatusBadge status={file.status} />
        <PathLabel path={file.path} previous={file.previous} />
        {comments > 0 && (
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-ink-2">
            <MessageSquare size={12} aria-hidden /> {comments}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-3">
          {open && doc && <Segmented value={rendered} onChange={setRendered} />}
          {open && !rendered && outline.length > 2 && <Outline items={outline} index={index} />}
          <DiffCount additions={file.additions} deletions={file.deletions} />
          <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-line px-2 py-0.5 text-[11px] text-ink-2 hover:bg-wash">
            <input type="checkbox" checked={viewed} onChange={props.onViewed} className="accent-[var(--good)]" />
            Viewed
          </label>
          <a
            href={file.url}
            target={props.local ? undefined : "_blank"}
            rel="noreferrer"
            aria-label={props.local ? "View the file" : "Open on GitHub"}
            title={props.local ? "View the file" : "Open on GitHub"}
            className="text-muted hover:text-ink"
          >
            <ExternalLink size={13} />
          </a>
        </span>
      </header>
      {!open && file.generated && !viewed && (
        <p className="px-4 py-2.5 text-xs text-muted">
          Generated file, folded.{" "}
          <button type="button" onClick={() => setOpen(true)} className="text-ink-2 underline underline-offset-2 hover:text-ink">
            Show the diff
          </button>
        </p>
      )}
      {open && (
        <div
          ref={body}
          className={cn("diff syn overflow-hidden rounded-b-xl", file.status === "added" && "quiet one-side added", file.status === "removed" && "one-side removed")}
          style={near ? undefined : { height: Math.min(rows.length, limit ?? rows.length) * ROW_PX + 8 }}
        >
          {near && rendered && (
            <div className="px-8 py-6 font-sans">
              <Md text={rows.filter((r) => r.kind === "add").map((r) => r.text).join("\n")} className="max-w-[80ch] text-[14px] leading-7 text-ink-2" />
            </div>
          )}
          {!file.patch && (
            <p className="px-4 py-3 font-sans text-xs text-muted">
              {props.local ? "No diff here: the file is too big to diff on this page, or past the first files." : "GitHub shows no diff for this file: it is binary, or too large."}{" "}
              <a href={file.url} target={props.local ? undefined : "_blank"} rel="noreferrer" className="text-ink-2 underline underline-offset-2">
                {props.local ? "View the file" : "Open it on GitHub"}
              </a>
            </p>
          )}
          {near && !rendered && <Rows hunks={hunks} pieces={pieces} id={`f${index}`} limit={limit} after={threadsAt} />}
          {near && !rendered && limit !== undefined && (
            <button type="button" onClick={() => setAll(true)} className="block w-full border-t border-line py-2 font-sans text-xs text-ink-2 hover:bg-wash hover:text-ink">
              Show the other {(rows.length - limit).toLocaleString("en-US")} lines
            </button>
          )}
          {near && outdated.length > 0 && <OutdatedThreads threads={outdated} lang={lang} />}
        </div>
      )}
    </section>
  );
}

/** The new-side lines a thread covers, for drawing its suggestions. */
function coveredBy(t: Thread, rows: Row[]): string[] {
  if (t.line === null) return [];
  const from = t.startLine ?? t.line;
  const side = (r: Row) => (t.side === "RIGHT" ? (r.kind !== "del" ? r.new : null) : r.kind !== "add" ? r.old : null);
  return rows.filter((r) => {
    const n = side(r);
    return n !== null && n >= from && n <= t.line!;
  }).map((r) => r.text);
}

function outlineOf(path: string, rows: Row[]): { name: string; kind: string; line: number }[] {
  const rule = outlineRule(path);
  if (!rule) return [];
  const out: { name: string; kind: string; line: number }[] = [];
  for (const r of rows) {
    if (r.kind === "del" || r.new === null) continue;
    const m = rule.exec(r.text);
    if (m && !/^\s/.test(r.text)) out.push({ kind: m[1], name: m[2].trim(), line: r.new });
  }
  return out;
}

function Segmented({ value, onChange }: { value: boolean; onChange: (rendered: boolean) => void }) {
  return (
    <span role="group" aria-label="Show as" className="flex rounded-md border border-line p-0.5 text-[11px]">
      {[true, false].map((r) => (
        <button key={String(r)} type="button" aria-pressed={value === r} onClick={() => onChange(r)} className={cn("rounded px-1.5", value === r ? "bg-wash text-ink" : "text-muted hover:text-ink-2")}>
          {r ? "Rendered" : "Source"}
        </button>
      ))}
    </span>
  );
}

/** Jumps to a definition in a long file. */
function Outline({ items, index }: { items: { name: string; kind: string; line: number }[]; index: number }) {
  return (
    <select
      aria-label="Jump to a definition"
      value=""
      onChange={(e) => document.getElementById(`f${index}-${e.target.value}`)?.scrollIntoView({ block: "center" })}
      className="max-w-44 rounded-md border border-line bg-page px-1.5 py-0.5 text-[11px] text-ink-2 outline-none hover:bg-wash"
    >
      <option value="">Outline ({items.length})</option>
      {items.map((d) => (
        <option key={`${d.line}`} value={d.line}>
          {d.kind} {d.name}
        </option>
      ))}
    </select>
  );
}

function PathLabel({ path, previous }: { path: string; previous: string | null }) {
  const cut = path.lastIndexOf("/") + 1;
  return (
    <span className="min-w-0 truncate font-mono text-[12.5px]" title={previous ? `${previous} → ${path}` : path}>
      {previous && <span className="text-muted">{previous} → </span>}
      <span className="text-muted">{path.slice(0, cut)}</span>
      <span className="font-semibold text-ink">{path.slice(cut)}</span>
    </span>
  );
}
