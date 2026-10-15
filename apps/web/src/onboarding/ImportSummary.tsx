import { GitHubSync } from "@/components/GitHubSync";
import { CheckCircle2, ExternalLink } from "lucide-react";
import type { RepoInfo } from "@/lib/types";

export function ImportSummary({ trunk, repo }: { trunk: string; repo: RepoInfo }) {
  const summary = repo.importSummary;
  return <section className="mt-6 rounded-xl border border-line px-5 py-4" aria-label="Imported repository content">
    <div className="flex items-center gap-3">
      <CheckCircle2 size={16} className="shrink-0 text-muted" aria-hidden />
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-xs font-medium">{repo.fullName}</h2>
        <p className="mt-1 text-xs text-muted">{summary ? `${summary.files.toLocaleString()} source files ready` : "Repository connected"}</p>
      </div>
      {summary && <a className="shrink-0 text-xs text-ink-2 hover:underline" href={`/t/${trunk}`}>Browse code →</a>}
    </div>
    {!!summary?.notes.length && <p className="mt-3 text-xs text-warning">Some GitHub context needs attention. See details below.</p>}
    <details className="mt-3 text-xs leading-6 text-muted">
      <summary className="cursor-pointer text-ink-2">What was copied?</summary>
      <p className="mt-3">This workspace contains a source snapshot plus issue and pull-request context. Full Git history, binary assets, and issue comment threads remain on GitHub.</p>
      {summary && summary.skipped > 0 && <p className="mt-2">{summary.skipped.toLocaleString()} files were left out of the source copy. These include binary files, generated folders, text files over 256 KiB, or files beyond the 3,000-file limit. They remain in your original repository; nothing was deleted.</p>}
      <p className="mt-2">Signed-in background imports can include up to 64 MiB of source text. GitHub context is fetched in pages, up to 5,000 entries per issue or pull-request query. Any incomplete results are noted here.</p>
      {summary?.notes.map((note, i) => <p key={i} className="mt-2 text-warning">{note}</p>)}
      <GitHubSync trunk={trunk} />
      <a href={repo.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-ink-2 underline">View original on GitHub <ExternalLink size={12} /></a>
    </details>
  </section>;
}
