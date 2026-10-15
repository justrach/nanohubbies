import type { Issue, RepoInfo } from "../types";
import { getMeta, setMeta } from "./store";
type IssueSeed = Omit<
  Issue,
  "state" | "landed" | "agents" | "closedBy" | "closedIn" | "heldBy"
>;

/** Refresh upstream fields without deleting local tasks, work, claims or closures. */
export function refreshContext(
  sql: SqlStorage,
  repo: RepoInfo,
  issues: IssueSeed[],
  warnings: string[],
) {
  const previous = getMeta<RepoInfo>(sql, "repo");
  if (
    !previous ||
    previous.fullName.toLowerCase() !== repo.fullName.toLowerCase()
  )
    throw new Error("Repository context does not match this workspace");
  const notes = [...warnings];
  for (const issue of issues) {
    const existing = sql
      .exec<{
        origin: string;
      }>("SELECT origin FROM issues WHERE number = ?", issue.number)
      .toArray()[0];
    if (existing?.origin === "local") {
      notes.push(
        `GitHub issue #${issue.number} shares a number with a local issue; the local issue was preserved`,
      );
      continue;
    }
    sql.exec(
      `INSERT INTO issues (number, title, body, origin, upstream, state, labels, author, created, comments, url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(number) DO UPDATE SET title=excluded.title, body=excluded.body,
      upstream=excluded.upstream, labels=excluded.labels, author=excluded.author,
      created=excluded.created, comments=excluded.comments, url=excluded.url,
      state=CASE WHEN issues.landed > 0 OR issues.closed_by IS NOT NULL THEN issues.state ELSE excluded.state END`,
      issue.number,
      issue.title,
      issue.body,
      issue.origin,
      issue.upstream,
      issue.upstream === "closed" ? "closed" : "open",
      JSON.stringify(issue.labels),
      issue.author,
      issue.created,
      issue.comments,
      issue.url,
    );
  }
  const next: RepoInfo = {
    ...repo,
    commit: previous.commit,
    contextUpdatedAt: Date.now(),
    contextNotes: notes,
    importSummary: previous.importSummary
      ? { ...previous.importSummary, notes }
      : undefined,
  };
  setMeta(sql, "repo", next);
  return next;
}
