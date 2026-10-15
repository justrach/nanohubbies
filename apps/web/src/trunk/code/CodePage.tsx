import { BookOpen, History } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui";
import { Md } from "@/pr/Md";
import { at, orMissing, origin, repo as repoOf, tree, trunks } from "@/server/api";
import { Newer } from "../Newer";
import { pathHref, resolveRelative, trunkHref } from "../paths";
import { About } from "./About";
import { CloneMenu } from "./CloneMenu";
import { GoToFile } from "./GoToFile";
import { Crumbs, FileTable, LatestBar } from "./parts";

/** A directory of the trunk at a version, newest by default: the latest
 *  change, the entries, and the directory's README, rendered on the server.
 *  The top directory also gets the side column a repository's front page has. */
export async function CodePage({ trunk, path, v }: { trunk: string; path: string; v?: number }) {
  const version = await orMissing(at(trunk, v));
  const top = path === "";
  const [view, repo, here, listing] = await Promise.all([
    orMissing(tree(trunk, version, path)),
    repoOf(trunk).catch(() => null),
    origin(),
    top ? trunks().catch(() => []) : Promise.resolve([]),
  ]);
  const dir = view.readme ? view.readme.path.split("/").slice(0, -1).join("/") : path;
  // A README's links name entries beside it, whose kinds the listing knows; others are guessed by their extension.
  const kinds = new Map(view.entries.map((e) => [e.path, e.type === "dir" ? ("tree" as const) : ("blob" as const)]));
  const raw = (p: string) => (repo ? `https://raw.githubusercontent.com/${repo.fullName}/${repo.commit ?? repo.defaultBranch}/${p}` : `/api/trunks/${trunk}/raw?path=${encodeURIComponent(p)}&v=${version.version}`);

  return (
    <main className="repo-code mx-auto max-w-[1280px] px-5 py-8">
      <div className={top ? "grid gap-6 lg:grid-cols-[minmax(0,1fr)_288px]" : ""}>
        <div className="min-w-0 space-y-4">
          <div className="repo-file-toolbar flex flex-wrap items-center gap-2">
            <Link href={`/t/${trunk}/branches`} className="flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-xs text-ink-2 hover:bg-wash" title="Browse and create branches">
              <History size={13} className="text-muted" aria-hidden /> main
              <span className="tabular rounded bg-wash px-1 text-[11px] text-ink">v{version.version.toLocaleString("en-US")}</span>
            </Link>
            {v ? (
              <Link href={pathHref(trunk, "tree", path)} className="text-xs text-series-1 hover:underline">
                An older version: see the newest
              </Link>
            ) : (
              <Newer version={version.version} />
            )}
            {!top && <Crumbs trunk={trunk} path={path} v={v} />}
            <span className="ml-auto flex items-center gap-2">
              <GoToFile trunk={trunk} />
              <CloneMenu trunk={trunk} origin={here} imported={!!repo} />
            </span>
          </div>
          <Card>
            <LatestBar trunk={trunk} latest={view.latest} head={version.version} />
            <FileTable trunk={trunk} path={path} entries={view.entries} v={v} />
          </Card>
          {view.readme && (
            <Card>
              <h2 className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-[13px] font-semibold text-ink">
                <BookOpen size={15} className="text-muted" aria-hidden />
                <Link href={pathHref(trunk, "blob", view.readme.path, v)} className="hover:underline">
                  {view.readme.path.split("/").pop()}
                </Link>
              </h2>
              <Md
                text={view.readme.text}
                className="readme max-w-none px-6 py-5 text-[14px] leading-7 text-ink-2 sm:px-8"
                link={(href) => {
                  const to = resolveRelative(dir, href);
                  return to === null ? href : `${pathHref(trunk, kinds.get(to) ?? (/\.\w+$/.test(to) ? "blob" : "tree"), to, v)}${href.includes("#") ? `#${href.split("#")[1]}` : ""}`;
                }}
                image={(src) => {
                  const to = resolveRelative(dir, src);
                  return to === null ? src : raw(to);
                }}
              />
            </Card>
          )}
          {!view.readme && top && (
            <p className="text-xs text-muted">
              No README at the top of this trunk. <Link href={trunkHref(trunk, "/live")} className="text-series-1 hover:underline">See what its agents are doing</Link>.
            </p>
          )}
        </div>
        {top && <About trunk={trunk} repo={repo} source={listing.find((t) => t.name === trunk)?.source ?? null} />}
      </div>
    </main>
  );
}
