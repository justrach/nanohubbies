import { ArrowUpRight, GitPullRequest, KeyRound, Scale, Star } from "lucide-react";
import Link from "next/link";
import { compact } from "@/lib/format";
import type { RepoInfo } from "@/lib/types";
import { trunkHref } from "../paths";
import { LiveStats } from "./LiveStats";

/** The side column of a trunk's front page: where it came from, what is
 *  happening on it now, and the two ways to take part. */
export function About({ trunk, repo, source }: { trunk: string; repo: RepoInfo | null; source: string | null }) {
  return (
    <aside className="space-y-6 text-[13px]">
      <section>
        <h2 className="mb-2 font-semibold text-ink">About</h2>
        {repo ? (
          <>
            {repo.description && <p className="mb-3 leading-6 text-ink-2">{repo.description}</p>}
            <a href={repo.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-medium text-series-1 hover:underline">
              github.com/{repo.fullName} <ArrowUpRight size={13} aria-hidden />
            </a>
            <p className="mt-1 text-xs text-muted">
              The original, imported at <code className="font-mono">{repo.commit ? repo.commit.slice(0, 12) : repo.defaultBranch}</code>
            </p>
            {repo.topics.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {repo.topics.slice(0, 8).map((t) => (
                  <span key={t} className="rounded-full bg-[color-mix(in_srgb,var(--series-1)_12%,transparent)] px-2 py-0.5 text-[11px] font-medium text-series-1">
                    {t}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
              <span className="flex items-center gap-1">
                <Star size={13} aria-hidden /> {compact(repo.stars)} stars
              </span>
              {repo.license && (
                <span className="flex items-center gap-1">
                  <Scale size={13} aria-hidden /> {repo.license}
                </span>
              )}
            </div>
          </>
        ) : (
          <p className="leading-6 text-ink-2">{source?.startsWith("template:") ? `Made here from the ${source.slice(9)} template.` : "Made here, not imported."}</p>
        )}
      </section>
      <section className="border-t border-line pt-5">
        <h2 className="mb-3 font-semibold text-ink">Now</h2>
        <LiveStats />
        <Link href={trunkHref(trunk, "/live")} className="mt-3 inline-block text-xs text-series-1 hover:underline">
          Watch it live
        </Link>
      </section>
      <section className="space-y-3 border-t border-line pt-5">
        <Link href={trunkHref(trunk, "/connect")} className="group flex gap-2.5">
          <KeyRound size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />
          <span>
            <span className="font-medium text-ink group-hover:text-series-1">Connect an agent</span>
            <span className="block text-xs leading-5 text-muted">Any agent that speaks git: a push lands by itself unless it touches code that changed.</span>
          </span>
        </Link>
        {repo && (
          <Link href={trunkHref(trunk, "/pulls")} className="group flex gap-2.5">
            <GitPullRequest size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />
            <span>
              <span className="font-medium text-ink group-hover:text-series-1">Send back to GitHub</span>
              <span className="block text-xs leading-5 text-muted">Everything that landed here, as one pull request on {repo.fullName}.</span>
            </span>
          </Link>
        )}
      </section>
    </aside>
  );
}
