import { File, Folder, History } from "lucide-react";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { agentLabel, ago } from "@/lib/format";
import { commitHref, pathHref, trunkHref } from "../paths";
import type { CommitSummary, TreeEntry } from "../types";

// The pieces of the code pages, rendered on the server.

/** trunk / src / shared / dates.js, each part a link up the tree. */
export function Crumbs({ trunk, path, v }: { trunk: string; path: string; v?: number }) {
  const parts = path ? path.split("/") : [];
  return (
    <nav aria-label="Path" className="flex min-w-0 flex-wrap items-center gap-x-1 text-[15px]">
      <Link href={pathHref(trunk, "tree", "", v)} className="font-semibold text-series-1 hover:underline">
        {trunk}
      </Link>
      {parts.map((p, i) => {
        const last = i === parts.length - 1;
        const to = parts.slice(0, i + 1).join("/");
        return (
          <span key={to} className="flex items-center gap-x-1">
            <span className="text-muted">/</span>
            {last ? (
              <span className="font-semibold text-ink">{p}</span>
            ) : (
              <Link href={pathHref(trunk, "tree", to, v)} className="text-series-1 hover:underline">
                {p}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

/** The change a version is: who made it, for whom, and when, with the way to the rest of the history. */
export function LatestBar({ trunk, latest, head }: { trunk: string; latest: CommitSummary; head: number }) {
  return (
    <div className="flex items-center gap-2.5 rounded-t-xl border-b border-line bg-wash px-4 py-2.5 text-[13px]">
      <Avatar name={agentLabel(latest.agent)} size={22} />
      <span className="shrink-0 font-semibold text-ink">{agentLabel(latest.agent)}</span>
      {latest.owner && <span className="hidden shrink-0 text-muted sm:inline">for {latest.owner}</span>}
      <Link href={commitHref(trunk, latest.version)} className="min-w-0 truncate text-ink-2 hover:text-series-1 hover:underline">
        {latest.subject}
      </Link>
      <span className="ml-auto flex shrink-0 items-center gap-3 text-xs text-muted">
        <Link href={commitHref(trunk, latest.version)} className="hidden font-mono hover:text-ink sm:inline">
          {latest.commit.slice(0, 7)}
        </Link>
        <span className="hidden md:inline">{ago(Date.now() - latest.at)}</span>
        <Link href={trunkHref(trunk, "/commits")} className="flex items-center gap-1 font-medium text-ink hover:text-series-1">
          <History size={14} aria-hidden />
          <span className="tabular">{head.toLocaleString("en-US")}</span> {head === 1 ? "version" : "versions"}
        </Link>
      </span>
    </div>
  );
}

/** A directory's entries, folders first, the way a git host lists them. */
export function FileTable({ trunk, path, entries, v }: { trunk: string; path: string; entries: TreeEntry[]; v?: number }) {
  const up = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  return (
    <ul className="divide-y divide-line text-[13px]">
      {path && (
        <li>
          <Link href={pathHref(trunk, "tree", up, v)} className="flex items-center gap-3 px-4 py-2 text-ink-2 hover:bg-wash">
            <Folder size={16} className="shrink-0 text-muted" aria-hidden />
            ..
          </Link>
        </li>
      )}
      {entries.map((e) => (
        <li key={e.name}>
          <Link href={pathHref(trunk, e.type === "dir" ? "tree" : "blob", e.path, v)} className="flex items-center gap-3 px-4 py-2 hover:bg-wash">
            {e.type === "dir" ? (
              <Folder size={16} className="shrink-0 fill-[color-mix(in_srgb,var(--series-1)_30%,transparent)] text-series-1" aria-hidden />
            ) : (
              <File size={16} className="shrink-0 text-muted" aria-hidden />
            )}
            <span className="min-w-0 truncate text-ink hover:text-series-1 hover:underline">{e.name}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
