import type { Issue, IssueState, Owner, RepoInfo } from "../types";
import { setMeta, type Emit } from "./store";

/** An agent counts as working on an issue for this long after its last change for it. */
const WORKING_MS = 120_000;
/** A claim on an issue lapses after this long without a change for it. */
const CLAIM_MS = 60_000;
/** A hold lasts longer: a real agent can plan for minutes between changes. */
const HOLD_MS = 900_000;

type Work = { agent: string; owner: string | null; change: string; version: number | null; outcome: string; at: number };

/** Records where an imported trunk came from, and takes in its issues. */
export function importRepo(sql: SqlStorage, repo: RepoInfo, issues: Omit<Issue, "state" | "landed" | "agents" | "closedBy" | "closedIn" | "heldBy">[]) {
  setMeta(sql, "repo", repo);
  for (const i of issues) {
    sql.exec(
      `INSERT OR REPLACE INTO issues (number, title, body, origin, upstream, state, labels, author, created, comments, url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      i.number,
      i.title,
      i.body,
      i.origin,
      i.upstream,
      i.upstream === "closed" ? "closed" : "open",
      JSON.stringify(i.labels),
      i.author,
      i.created,
      i.comments,
      i.url,
    );
  }
}

/** Opens an issue on the trunk itself. */
export function openIssue(sql: SqlStorage, emit: Emit, title: string, body: string, author: string, labels: Issue["labels"] = []): Issue {
  const clean = title.trim().slice(0, 200);
  if (!clean) throw new Error("an issue needs a title");
  const number = (sql.exec<{ n: number | null }>("SELECT MAX(number) AS n FROM issues").one().n ?? 0) + 1;
  const at = Date.now();
  sql.exec(
    `INSERT INTO issues (number, title, body, origin, upstream, state, labels, author, created, comments, url)
     VALUES (?, ?, ?, 'local', 'open', 'open', ?, ?, ?, 0, NULL)`,
    number,
    clean,
    body.slice(0, 20_000),
    JSON.stringify(labels.slice(0, 10)),
    author,
    at,
  );
  emit({ t: "issue", number, title: clean, state: "open", by: author, version: null, at });
  return issueDetail(sql, number)!.issue;
}

export function listIssues(sql: SqlStorage): Issue[] {
  const working = workingCounts(sql);
  const held = holders(sql);
  return sql
    .exec("SELECT * FROM issues ORDER BY CASE state WHEN 'progress' THEN 0 WHEN 'open' THEN 1 ELSE 2 END, number DESC LIMIT 500")
    .toArray()
    .map((r) => toIssue(r, working.get(r.number as number) ?? 0, held.get(r.number as number) ?? null));
}

export function issueDetail(sql: SqlStorage, number: number): { issue: Issue; work: Work[] } | null {
  const row = sql.exec("SELECT * FROM issues WHERE number = ?", number).toArray()[0];
  if (!row) return null;
  const work = sql.exec<Work>("SELECT agent, owner, change, version, outcome, at FROM issue_work WHERE issue = ? ORDER BY at DESC LIMIT 100", number).toArray();
  return { issue: toIssue(row, workingCounts(sql).get(number) ?? 0, holders(sql).get(number) ?? null), work };
}

/** What to work on next: issues not yet closed, least crowded first, with
 *  how many changes for each have landed. Crowding is a hint, not a lock:
 *  two agents on one issue is allowed, it is just shown as busier. */
export function agenda(sql: SqlStorage, limit = 50): { number: number; title: string; agents: number; landed: number; heldBy: string | null }[] {
  const working = workingCounts(sql);
  const held = holders(sql);
  return sql
    .exec<{ number: number; title: string; landed: number }>("SELECT number, title, landed FROM issues WHERE state != 'closed' ORDER BY number")
    .toArray()
    .map((r) => ({ ...r, agents: working.get(r.number) ?? 0, heldBy: held.get(r.number) ?? null }))
    .sort((a, b) => a.agents - b.agents || a.number - b.number)
    .slice(0, limit);
}

/** An agent takes a particular issue. Scripted agents drop it and leave it
 *  alone while the hold lasts; the hold ends when the issue closes or the
 *  agent goes quiet on it. */
export function hold(sql: SqlStorage, emit: Emit, agent: string, number: number): Issue | null {
  const row = sql.exec<{ state: IssueState; title: string }>("SELECT state, title FROM issues WHERE number = ?", number).toArray()[0];
  if (!row || row.state === "closed") return null;
  sql.exec("DELETE FROM claims WHERE agent = ? OR (issue = ? AND held = 0)", agent, number);
  sql.exec("INSERT INTO claims (agent, issue, at, held) VALUES (?, ?, ?, 1)", agent, number, Date.now());
  emit({ t: "issue", number, title: row.title, state: row.state, by: agent, version: null, heldBy: agent, at: Date.now() });
  return issueDetail(sql, number)!.issue;
}

/** Hands an agent the least crowded open issue with room on it, and
 *  remembers the claim. An issue has `cap` places, shared out between the
 *  people running swarms, so the first swarm to arrive cannot keep every
 *  place. The claim lapses when the agent stops naming the issue, and
 *  nothing stops anyone else from naming it. */
export function claim(sql: SqlStorage, agent: string, owner: string | null, cap: number): { number: number; title: string; landed: number } | null {
  const now = Date.now();
  sql.exec("DELETE FROM claims WHERE agent = ? OR (held = 0 AND at < ?) OR (held = 1 AND at < ?)", agent, now - CLAIM_MS, now - HOLD_MS);
  const running = sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM swarms WHERE until > ?", now).one().n;
  const share = Math.max(1, Math.floor(cap / Math.max(1, running)));
  const pick = sql
    .exec<{ number: number; title: string; landed: number }>(
      `SELECT i.number, i.title, i.landed FROM issues i
       WHERE i.state != 'closed'
         AND NOT EXISTS (SELECT 1 FROM claims h WHERE h.issue = i.number AND h.held = 1)
         AND (SELECT COUNT(*) FROM claims c WHERE c.issue = i.number) < ?
         AND (SELECT COUNT(*) FROM claims c WHERE c.issue = i.number AND c.owner IS ?) < ?
       ORDER BY (SELECT COUNT(*) FROM claims c WHERE c.issue = i.number), i.number LIMIT 1`,
      cap,
      owner,
      share,
    )
    .toArray()[0];
  if (!pick) return null;
  sql.exec("INSERT INTO claims (agent, issue, owner, at) VALUES (?, ?, ?, ?)", agent, pick.number, owner, now);
  return { number: pick.number, title: pick.title, landed: pick.landed };
}

/** A change named an issue. The first landed change moves it to progress; a
 *  landed change that closes it closes it. */
export function workedOn(
  sql: SqlStorage,
  emit: Emit,
  number: number,
  agent: string,
  owner: Owner | null,
  change: string,
  version: number | null,
  outcome: string,
  at: number,
  closes: boolean,
) {
  const row = sql.exec<{ state: IssueState; title: string }>("SELECT state, title FROM issues WHERE number = ?", number).toArray()[0];
  if (!row) return;
  sql.exec("INSERT INTO issue_work (issue, agent, owner, change, version, outcome, at) VALUES (?, ?, ?, ?, ?, ?, ?)", number, agent, owner?.name ?? null, change, version, outcome, at);
  sql.exec("UPDATE claims SET at = ? WHERE agent = ? AND issue = ?", at, agent, number);
  if (outcome !== "landed") return;
  sql.exec("UPDATE issues SET landed = landed + 1 WHERE number = ?", number);
  if (row.state === "closed") return;
  if (closes) {
    sql.exec("UPDATE issues SET state = 'closed', closed_by = ?, closed_in = ? WHERE number = ?", agent, version, number);
    sql.exec("DELETE FROM claims WHERE issue = ?", number);
    emit({ t: "issue", number, title: row.title, state: "closed", by: agent, version, heldBy: null, at });
  } else if (row.state === "open") {
    sql.exec("UPDATE issues SET state = 'progress' WHERE number = ?", number);
    emit({ t: "issue", number, title: row.title, state: "progress", by: agent, version, at });
  }
}

/** Who holds each held issue. */
function holders(sql: SqlStorage): Map<number, string> {
  return new Map(
    sql
      .exec<{ issue: number; agent: string }>("SELECT issue, agent FROM claims WHERE held = 1 AND at > ?", Date.now() - HOLD_MS)
      .toArray()
      .map((r) => [r.issue, r.agent]),
  );
}

/** Distinct agents per issue with a change for it in the last two minutes. */
function workingCounts(sql: SqlStorage): Map<number, number> {
  return new Map(
    sql
      .exec<{ issue: number; n: number }>("SELECT issue, COUNT(DISTINCT agent) AS n FROM issue_work WHERE at > ? GROUP BY issue", Date.now() - WORKING_MS)
      .toArray()
      .map((r) => [r.issue, r.n]),
  );
}

function toIssue(r: Record<string, SqlStorageValue>, agents: number, heldBy: string | null): Issue {
  return {
    number: r.number as number,
    title: r.title as string,
    body: r.body as string,
    origin: r.origin as Issue["origin"],
    upstream: r.upstream as Issue["upstream"],
    state: r.state as IssueState,
    labels: JSON.parse(r.labels as string),
    author: r.author as string,
    created: r.created as number,
    comments: r.comments as number,
    url: (r.url as string | null) ?? null,
    landed: r.landed as number,
    agents,
    closedBy: (r.closed_by as string | null) ?? null,
    closedIn: (r.closed_in as number | null) ?? null,
    heldBy,
  };
}
