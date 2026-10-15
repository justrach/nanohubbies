import { History } from "lucide-react";
import Link from "next/link";
import { CopyButton } from "@/components/controls";
import { Card, LinkButton } from "@/components/ui";
import { Md } from "@/pr/Md";
import { at, blob, orMissing, repo as repoOf } from "@/server/api";
import { Newer } from "../Newer";
import { pathHref, resolveRelative, trunkHref } from "../paths";
import { GoToFile } from "./GoToFile";
import { Highlighted } from "./Highlighted";
import { Crumbs } from "./parts";

const MARKDOWN = /\.(md|mdx|markdown)$/i;

/** One file at a version, highlighted on the server, every line linkable.
 *  Markdown renders unless `plain`, as a git host shows a README. */
export async function BlobPage({ trunk, path, v, plain }: { trunk: string; path: string; v?: number; plain: boolean }) {
  const version = await orMissing(at(trunk, v));
  const [file, repo] = await Promise.all([orMissing(blob(trunk, version, path)), MARKDOWN.test(path) ? repoOf(trunk).catch(() => null) : null]);
  const lines = file.text === null ? 0 : file.text.split("\n").length - (file.text.endsWith("\n") ? 1 : 0);
  const rendered = MARKDOWN.test(path) && !plain && file.text !== null;
  const dir = path.split("/").slice(0, -1).join("/");
  const raw = `/api/trunks/${trunk}/raw?path=${encodeURIComponent(path)}&v=${version.version}`;
  const here = pathHref(trunk, "blob", path, v);

  return (
    <main className="mx-auto max-w-[1280px] space-y-4 px-5 py-6">
      <div className="flex flex-wrap items-center gap-2">
        <Crumbs trunk={trunk} path={path} v={v} />
        {v ? (
          <Link href={pathHref(trunk, "blob", path)} className="text-xs text-series-1 hover:underline">
            v{version.version}, an older version: see the newest
          </Link>
        ) : (
          <Newer version={version.version} />
        )}
        <span className="ml-auto">
          <GoToFile trunk={trunk} />
        </span>
      </div>
      <Card>
        <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2.5 text-xs text-ink-2">
          <span className="tabular">
            {lines.toLocaleString("en-US")} lines · {size(file.size)}
          </span>
          <span className="tabular text-muted">
            at v{version.version.toLocaleString("en-US")} <code className="font-mono">{version.commit.slice(0, 7)}</code>
          </span>
          <span className="ml-auto flex items-center gap-2">
            {MARKDOWN.test(path) && (
              <span role="group" aria-label="Show as" className="flex rounded-md border border-line p-0.5 text-[11px]">
                <Link href={here} aria-current={rendered ? "page" : undefined} className={`rounded px-2 py-0.5 ${rendered ? "bg-wash text-ink" : "text-muted hover:text-ink-2"}`}>
                  Preview
                </Link>
                <Link href={`${here}${here.includes("?") ? "&" : "?"}plain=1`} aria-current={rendered ? undefined : "page"} className={`rounded px-2 py-0.5 ${rendered ? "text-muted hover:text-ink-2" : "bg-wash text-ink"}`}>
                  Code
                </Link>
              </span>
            )}
            <LinkButton href={trunkHref(trunk, "/commits")} size="sm" variant="ghost">
              <History size={12} aria-hidden /> History
            </LinkButton>
            <a href={raw} className="inline-flex h-7 items-center rounded-md border border-line px-2 text-[11px] font-medium text-ink hover:bg-wash">
              Raw
            </a>
            {file.text !== null && <CopyButton text={file.text} />}
          </span>
        </header>
        {file.text === null ? (
          <p className="px-4 py-8 text-center text-xs text-muted">
            This file is too big to show here.{" "}
            <a href={raw} className="text-series-1 underline">
              Open it raw
            </a>
            .
          </p>
        ) : rendered ? (
          <Md
            text={file.text}
            className="readme max-w-none px-6 py-5 text-[14px] leading-7 text-ink-2 sm:px-8"
            link={(href) => {
              const to = resolveRelative(dir, href);
              return to === null ? href : pathHref(trunk, /\.\w+$/.test(to) ? "blob" : "tree", to, v);
            }}
            image={(src) => {
              const to = resolveRelative(dir, src);
              if (to === null) return src;
              return repo ? `https://raw.githubusercontent.com/${repo.fullName}/${repo.commit ?? repo.defaultBranch}/${to}` : src;
            }}
          />
        ) : (
          <Highlighted text={file.text} path={path} />
        )}
      </Card>
    </main>
  );
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
