"use client";

import { File, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/controls";
import { Kbd } from "@/components/ui";
import { api, trunkPath } from "@/lib/api";
import { cn } from "@/lib/utils";
import { pathHref } from "../paths";

/** Finds a file by a few letters of its path, as `t` does on a git host. */
export function GoToFile({ trunk }: { trunk: string }) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<string[] | null>(null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable]");
      if (e.key !== "t" || e.metaKey || e.ctrlKey || e.altKey || typing) return;
      e.preventDefault();
      setOpen(true);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    if (!files) void api<{ path: string }[]>(`${trunkPath(trunk)}/files`).then((all) => setFiles(all.map((f) => f.path)), () => setFiles([]));
  }, [open, files, trunk]);

  const hits = useMemo(() => rank(files ?? [], q).slice(0, 50), [files, q]);
  const go = (path: string) => {
    setOpen(false);
    router.push(pathHref(trunk, "blob", path));
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} className="text-ink-2">
        <Search size={13} aria-hidden /> Go to file <Kbd>t</Kbd>
      </Button>
      {open && (
        <div className="fixed inset-0 z-40 flex items-start justify-center bg-page/60 px-4 pt-[12vh] backdrop-blur-sm" onPointerDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div role="dialog" aria-label="Go to file" className="w-full max-w-xl overflow-hidden rounded-xl border border-line bg-surface shadow-2xl">
            <div className="flex items-center gap-2 border-b border-line px-3">
              <Search size={15} className="text-muted" aria-hidden />
              <input
                ref={input}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setSel(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setOpen(false);
                  else if (e.key === "ArrowDown") setSel((s) => Math.min(hits.length - 1, s + 1));
                  else if (e.key === "ArrowUp") setSel((s) => Math.max(0, s - 1));
                  else if (e.key === "Enter" && hits[sel]) go(hits[sel]);
                  else return;
                  e.preventDefault();
                }}
                placeholder="Find a file"
                className="h-11 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted"
              />
              <Kbd>esc</Kbd>
            </div>
            <ul className="max-h-[50vh] overflow-auto py-1 text-[13px]">
              {files === null && <li className="px-4 py-3 text-muted">Listing files…</li>}
              {files && hits.length === 0 && <li className="px-4 py-3 text-muted">No file matches.</li>}
              {hits.map((path, i) => (
                <li key={path}>
                  <button
                    type="button"
                    onClick={() => go(path)}
                    onPointerMove={() => setSel(i)}
                    className={cn("flex w-full items-center gap-2 px-4 py-1.5 text-left", i === sel ? "bg-wash text-ink" : "text-ink-2")}
                  >
                    <File size={14} className="shrink-0 text-muted" aria-hidden />
                    <span className="truncate font-mono text-[12px]">{path}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

/** Paths holding the query's letters in order, best first: a match in the
 *  file's own name, then a tight match, then a short path. */
function rank(paths: string[], q: string): string[] {
  const needle = q.toLowerCase().replace(/\s+/g, "");
  if (!needle) return paths.slice(0, 50);
  const scored: [number, string][] = [];
  for (const path of paths) {
    const hay = path.toLowerCase();
    let at = -1;
    let first = -1;
    let ok = true;
    for (const ch of needle) {
      at = hay.indexOf(ch, at + 1);
      if (at < 0) {
        ok = false;
        break;
      }
      if (first < 0) first = at;
    }
    if (!ok) continue;
    const name = hay.slice(hay.lastIndexOf("/") + 1);
    const score = (name.includes(needle) ? 0 : hay.includes(needle) ? 1000 : 2000) + (at - first) * 10 + path.length;
    scored.push([score, path]);
  }
  return scored.sort((a, b) => a[0] - b[0]).map(([, p]) => p);
}
