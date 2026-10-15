import { Fragment, useEffect, useMemo, useState } from "react";
import { FileDiff } from "./FileDiff";
import { FileTree, type Mode } from "./FileTree";
import { readingOrder } from "./order";
import type { PullFile, Thread } from "./types";

/** The Files tab: the file list on the left, every file's diff on the right.
 *  j and k move between files; v marks the current one viewed. A pull
 *  request's files, or a trunk version's (`local`, with no review threads);
 *  `viewedKey` keeps what was viewed apart per pull request or version. */
export function Files({ files, threads = [], viewedKey, local = false }: { files: PullFile[]; threads?: Thread[]; viewedKey: string; local?: boolean }) {
  const [mode, setMode] = useState<Mode>("reading");
  useEffect(() => {
    if (localStorage.getItem("pr:order") === "folders") setMode("folders");
  }, []);
  const { viewed, toggle } = useViewed(viewedKey, files);
  const groups = useMemo(() => readingOrder(files), [files]);
  const ordered = useMemo(() => (mode === "reading" ? groups.flatMap((g) => g.files) : [...files].sort((a, b) => a.path.localeCompare(b.path))), [mode, groups, files]);
  const indexOf = useMemo(() => new Map(ordered.map((f, i) => [f.path, i])), [ordered]);
  const byPath = useMemo(() => {
    const by = new Map<string, Thread[]>();
    for (const t of threads) by.set(t.path, [...(by.get(t.path) ?? []), t]);
    return by;
  }, [threads]);
  const comments = useMemo(() => new Map([...byPath].map(([p, ts]) => [p, ts.reduce((n, t) => n + t.comments.length, 0)])), [byPath]);
  const pick = (m: Mode) => {
    localStorage.setItem("pr:order", m);
    setMode(m);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest("input, textarea, select")) return;
      if (e.key !== "j" && e.key !== "k" && e.key !== "v") return;
      const at = current(ordered.length);
      if (e.key === "v" && ordered[at]) toggle(ordered[at]);
      const next = e.key === "k" ? Math.max(0, at - 1) : Math.min(ordered.length - 1, at + 1);
      document.getElementById(`file-${next}`)?.scrollIntoView({ behavior: "smooth" });
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [ordered, toggle]);

  const card = (f: PullFile) => (
    <FileDiff key={f.path} file={f} index={indexOf.get(f.path)!} threads={byPath.get(f.path) ?? []} viewed={viewed.has(f.path)} onViewed={() => toggle(f)} local={local} />
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[272px_minmax(0,1fr)]">
      <aside className="sticky top-16 hidden max-h-[calc(100vh-5rem)] self-start overflow-auto pr-1 lg:block">
        <FileTree files={files} mode={mode} onMode={pick} viewed={viewed} indexOf={indexOf} comments={comments} />
        <p className="mt-4 text-[11px] text-muted">
          <Key>j</Key> <Key>k</Key> next and previous file · <Key>v</Key> viewed
        </p>
      </aside>
      <div className="min-w-0 space-y-3">
        {mode === "reading"
          ? groups.map((g) => (
              <Fragment key={g.role}>
                <h3 className="pt-2 text-[11px] font-semibold tracking-wide text-muted uppercase first:pt-0">
                  {g.label} <span className="tabular font-normal">{g.files.length}</span>
                </h3>
                {g.files.map(card)}
              </Fragment>
            ))
          : ordered.map(card)}
      </div>
    </div>
  );
}

function Key({ children }: { children: string }) {
  return <kbd className="rounded border border-line bg-surface px-1 font-mono text-[10px] text-ink-2">{children}</kbd>;
}

/** The file whose card holds the top of the screen, under the sticky bars. */
function current(count: number): number {
  let at = 0;
  for (let i = 0; i < count; i++) {
    const top = document.getElementById(`file-${i}`)?.getBoundingClientRect().top ?? Infinity;
    if (top <= 72) at = i;
    else break;
  }
  return at;
}

/** Which files were marked viewed, kept per pull request or version in this browser. A
 *  file counts as viewed only at the version it was viewed at. */
function useViewed(key: string, files: PullFile[]) {
  const storeKey = `viewed:${key}`;
  // Read once mounted: the server, which may draw the list first, has no storage.
  const [marks, setMarks] = useState<Record<string, string>>({});
  useEffect(() => {
    try {
      setMarks(JSON.parse(localStorage.getItem(storeKey) ?? "{}") as Record<string, string>);
    } catch {
      setMarks({});
    }
  }, [storeKey]);
  const viewed = useMemo(() => new Set(files.filter((f) => marks[f.path] === f.sha).map((f) => f.path)), [marks, files]);
  const toggle = useMemo(
    () => (f: PullFile) =>
      setMarks((m) => {
        const next = { ...m };
        if (next[f.path] === f.sha) delete next[f.path];
        else next[f.path] = f.sha;
        localStorage.setItem(storeKey, JSON.stringify(next));
        return next;
      }),
    [storeKey],
  );
  return { viewed, toggle };
}
