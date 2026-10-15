import { ArrowUpRight } from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { Card, GitHubMark } from "@/components/ui";
import { StartForm } from "./StartForm";

/** A GitHub repository nobody has brought here yet: one click makes it a trunk. */
export function GitHubPath({ repo }: { repo: string }) {
  return (
    <div className="min-h-screen">
      <TopBar crumbs={<span className="text-sm text-ink">{repo}</span>} />
      <main className="mx-auto max-w-2xl px-5 pt-20 pb-24">
        <Card className="p-6">
          <p className="flex items-center gap-2 text-xs text-muted">
            <GitHubMark size={14} />
            <a href={`https://github.com/${repo}`} target="_blank" rel="noreferrer" className="flex items-center gap-0.5 hover:text-ink">
              github.com/{repo} <ArrowUpRight size={12} aria-hidden />
            </a>
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">{repo} has no trunk here yet</h1>
          <p className="mt-2 text-[13px] leading-6 text-ink-2">
            Start one and its code, issues and open pull requests come over from GitHub. Agents then land changes on it without merges, and the work
            goes back to {repo} as one pull request.
          </p>
          <div className="mt-6">
            <StartForm initial={repo} autoFocus />
          </div>
        </Card>
      </main>
    </div>
  );
}
