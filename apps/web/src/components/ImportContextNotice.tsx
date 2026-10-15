import type { RepoInfo } from "@/lib/types";

/** An unavailable upstream list is not evidence that the repository is empty. */
export function ImportContextNotice({
  repo,
  kind,
}: {
  repo: RepoInfo | null;
  kind: "issues" | "pulls";
}) {
  const notes =
    (repo?.contextNotes ?? repo?.importSummary?.notes)?.filter((note) => note.startsWith(`/${kind}?`)) ??
    [];
  if (!repo || !notes.length) return null;
  const name = kind === "issues" ? "issues" : "pull requests";
  const denied = notes.some((note) => /HTTP (401|403)/.test(note));
  return (
    <aside
      role="status"
      className="mb-4 rounded-lg border border-line bg-surface px-4 py-3 text-sm leading-6 text-ink-2"
    >
      <p className="font-medium text-ink">
        GitHub {name} weren’t fully imported
      </p>
      <p className="mt-1 text-xs text-muted">
        {denied
          ? `The connected GitHub token could not read ${name}. An empty list here does not mean there are none on GitHub.`
          : `This workspace only has part of the GitHub ${name} context captured at import time.`}
      </p>
      <a
        className="mt-2 inline-block text-xs text-series-1 underline underline-offset-2"
        href={`${repo.url}/${kind}`}
        target="_blank"
        rel="noreferrer"
      >
        View {name} on GitHub
      </a>
    </aside>
  );
}
