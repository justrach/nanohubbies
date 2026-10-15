import { Check, ChevronRight, Folder } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./badges";
import { readingOrder } from "./order";
import type { PullFile } from "./types";

export type Mode = "reading" | "folders";

/** The pull request's files, in reading order or as folders, with how many
 *  have been viewed. Picking one scrolls to it. */
export function FileTree(props: {
  files: PullFile[];
  mode: Mode;
  onMode: (m: Mode) => void;
  viewed: Set<string>;
  indexOf: Map<string, number>;
  comments: Map<string, number>;
}) {
  const [filter, setFilter] = useState("");
  const shown = props.files.filter((f) => f.path.toLowerCase().includes(filter.toLowerCase()));
  const done = props.files.filter((f) => props.viewed.has(f.path)).length;
  const go = (path: string) => document.getElementById(`file-${props.indexOf.get(path)}`)?.scrollIntoView({ behavior: "smooth" });
  const entry = (f: PullFile, depth = 0, nameOnly = false) => (
    <File key={f.path} file={f} depth={depth} nameOnly={nameOnly} viewed={props.viewed.has(f.path)} comments={props.comments.get(f.path) ?? 0} onPick={() => go(f.path)} />
  );

  return (
    <nav aria-label="Files" className="text-xs">
      <div className="flex items-baseline justify-between">
        <p className="font-semibold text-ink">
          Files <span className="tabular font-normal text-muted">{props.files.length}</span>
        </p>
        <p className="tabular text-[11px] text-muted">
          {done} of {props.files.length} viewed
        </p>
      </div>
      <div className="mt-1.5 h-1 rounded-full bg-wash">
        <div className="h-1 rounded-full bg-good transition-[width]" style={{ width: `${(100 * done) / Math.max(1, props.files.length)}%` }} />
      </div>
      <div role="group" aria-label="Order" className="mt-3 flex rounded-md border border-line p-0.5 text-[11px]">
        {(["reading", "folders"] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={props.mode === m}
            onClick={() => props.onMode(m)}
            className={cn("flex-1 rounded px-2 py-0.5", props.mode === m ? "bg-wash text-ink" : "text-muted hover:text-ink-2")}
          >
            {m === "reading" ? "Reading order" : "Folders"}
          </button>
        ))}
      </div>
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter files"
        className="mt-2 w-full rounded-md border border-line bg-page px-2 py-1 text-xs text-ink outline-none placeholder:text-muted focus:border-axis"
      />
      <div className="mt-2">
        {props.mode === "reading"
          ? readingOrder(shown).map((g) => (
              <div key={g.role} className="mb-2">
                <p className="px-1.5 py-1 text-[10.5px] font-semibold tracking-wide text-muted uppercase">{g.label}</p>
                {g.files.map((f) => entry(f))}
              </div>
            ))
          : <Folders files={shown} entry={entry} />}
        {shown.length === 0 && <p className="px-1.5 py-3 text-muted">No file matches.</p>}
      </div>
    </nav>
  );
}

function File(props: { file: PullFile; depth: number; nameOnly: boolean; viewed: boolean; comments: number; onPick: () => void }) {
  const { file } = props;
  const cut = file.path.lastIndexOf("/") + 1;
  return (
    <button
      type="button"
      onClick={props.onPick}
      title={file.path}
      className={cn("flex w-full items-center gap-1.5 rounded-md py-1 pr-1.5 text-left hover:bg-wash", props.viewed && "opacity-60")}
      style={{ paddingLeft: 6 + props.depth * 12 }}
    >
      <StatusBadge status={file.status} />
      <span className="min-w-0 flex-1 truncate">
        {!props.nameOnly && cut > 0 && <span className="text-muted">{shorten(file.path.slice(0, cut))}</span>}
        <span className="text-ink">{file.path.slice(cut)}</span>
      </span>
      {props.comments > 0 && <span className="tabular text-[10.5px] text-ink-2">{props.comments}</span>}
      {props.viewed ? (
        <Check size={13} className="shrink-0 text-good" aria-label="Viewed" />
      ) : (
        <span className="tabular shrink-0 font-mono text-[10.5px] text-muted">+{file.additions}</span>
      )}
    </button>
  );
}

/** "crates/observe/src/" → "…/src/": the folder a file sits in, not its whole path. */
function shorten(dir: string) {
  const parts = dir.split("/").filter(Boolean);
  return parts.length > 1 ? `…/${parts[parts.length - 1]}/` : dir;
}

type Dir = { name: string; path: string; dirs: Map<string, Dir>; files: PullFile[] };

function Folders({ files, entry }: { files: PullFile[]; entry: (f: PullFile, depth: number, nameOnly: boolean) => React.ReactNode }) {
  const root = useMemo(() => {
    const top: Dir = { name: "", path: "", dirs: new Map(), files: [] };
    for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
      const parts = f.path.split("/");
      let d = top;
      for (const p of parts.slice(0, -1)) {
        if (!d.dirs.has(p)) d.dirs.set(p, { name: p, path: d.path ? `${d.path}/${p}` : p, dirs: new Map(), files: [] });
        d = d.dirs.get(p)!;
      }
      d.files.push(f);
    }
    return top;
  }, [files]);
  return <DirView dir={root} depth={0} entry={entry} />;
}

function DirView({ dir, depth, entry }: { dir: Dir; depth: number; entry: (f: PullFile, depth: number, nameOnly: boolean) => React.ReactNode }) {
  return (
    <>
      {[...dir.dirs.values()].map((d) => (
        <Collapsible key={d.path} dir={squash(d)} depth={depth} entry={entry} />
      ))}
      {dir.files.map((f) => entry(f, depth, true))}
    </>
  );
}

/** A folder with one folder in it and nothing else shows as "a/b". */
function squash(d: Dir): Dir {
  let out = d;
  while (out.files.length === 0 && out.dirs.size === 1) {
    const only = [...out.dirs.values()][0];
    out = { ...only, name: `${out.name}/${only.name}` };
  }
  return out;
}

function Collapsible({ dir, depth, entry }: { dir: Dir; depth: number; entry: (f: PullFile, depth: number, nameOnly: boolean) => React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-1 rounded-md py-1 text-left text-ink-2 hover:bg-wash" style={{ paddingLeft: 4 + depth * 12 }}>
        <ChevronRight size={12} className={cn("shrink-0 transition-transform", open && "rotate-90")} aria-hidden />
        <Folder size={12} className="shrink-0 text-muted" aria-hidden />
        <span className="truncate">{dir.name}</span>
      </button>
      {open && <DirView dir={dir} depth={depth + 1} entry={entry} />}
    </div>
  );
}
