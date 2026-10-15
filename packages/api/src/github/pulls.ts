import { gh, ghPages, type Reader } from "./api";

// A GitHub pull request gathered into one document for the PR page: what it
// changes, who reviewed it, what they said and where, and how its checks went.

export interface Person {
  login: string;
  avatar: string;
  bot: boolean;
}

export type FileStatus = "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";

export interface PullFile {
  path: string;
  previous: string | null;
  status: FileStatus;
  additions: number;
  deletions: number;
  /** The unified diff, or null when GitHub leaves it out (binary or too big). */
  patch: string | null;
  /** The blob it changes to, so "viewed" resets when the file changes again. */
  sha: string;
  /** Lockfiles, minified bundles and snapshots, shown collapsed. */
  generated: boolean;
  url: string;
}

export interface Comment {
  id: number;
  author: Person;
  body: string;
  at: number;
  url: string;
}

/** Review comments on one place in the diff, first comment first. */
export interface Thread {
  id: number;
  path: string;
  side: "LEFT" | "RIGHT";
  /** The line it is on now, or null when the code under it changed since. */
  line: number | null;
  startLine: number | null;
  /** The line it was written on, for outdated threads. */
  originalLine: number | null;
  /** The diff around the comment when it was written. */
  hunk: string;
  comments: Comment[];
}

export type ReviewState = "approved" | "changes_requested" | "commented" | "dismissed" | "pending";

export type Activity =
  | ({ kind: "comment" } & Comment)
  | ({ kind: "review"; state: ReviewState; inline: number } & Comment)
  | { kind: "commit"; sha: string; message: string; author: Person | null; at: number; url: string };

export interface Check {
  name: string;
  status: string;
  conclusion: string | null;
  url: string | null;
}

export interface PullView {
  repo: string;
  number: number;
  url: string;
  title: string;
  body: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  author: Person;
  base: string;
  head: string;
  /** The fork the branch lives in, when it is not the base repository. */
  headRepo: string | null;
  headSha: string;
  created: number;
  updated: number;
  merged: number | null;
  closed: number | null;
  labels: { name: string; color: string }[];
  additions: number;
  deletions: number;
  changedFiles: number;
  commits: number;
  reviewers: { person: Person; state: ReviewState }[];
  checks: Check[];
  files: PullFile[];
  threads: Thread[];
  activity: Activity[];
  /** What was left out, in words: lists longer than the page reads. */
  truncated: string[];
}

/** Files whose diffs are generated, shown folded: in pull requests, and in a trunk's history. */
export const GENERATED = [
  /(^|\/)(Cargo\.lock|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Gemfile\.lock|poetry\.lock|composer\.lock|go\.sum|Pipfile\.lock|uv\.lock|flake\.lock)$/,
  /\.min\.(js|css)$/,
  /(^|\/)__snapshots__\//,
  /\.snap$/,
  /(^|\/)(dist|vendor|third_party)\//,
  /\.(pb|generated)\.\w+$/,
];

type GhUser = { login: string; avatar_url: string; type: string } | null;

const person = (u: GhUser): Person => ({ login: u?.login ?? "ghost", avatar: u?.avatar_url ?? "", bot: u?.type === "Bot" });
const time = (s: string | null | undefined) => (s ? Date.parse(s) : 0);

/** Reads one pull request. Lists are capped at three pages each, so a giant
 *  pull request still costs a handful of requests. */
export async function readPull(owner: string, repo: string, number: number, reader: Reader): Promise<PullView> {
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  type GhPull = {
    number: number;
    title: string;
    body: string | null;
    state: "open" | "closed";
    draft: boolean;
    merged: boolean;
    merged_at: string | null;
    closed_at: string | null;
    created_at: string;
    updated_at: string;
    html_url: string;
    user: GhUser;
    labels: { name: string; color: string }[];
    head: { ref: string; sha: string; repo: { full_name: string } | null };
    base: { ref: string; repo: { full_name: string } };
    additions: number;
    deletions: number;
    changed_files: number;
    commits: number;
    requested_reviewers: GhUser[];
  };
  type GhFile = { filename: string; previous_filename?: string; status: FileStatus; additions: number; deletions: number; patch?: string; sha: string; blob_url: string };
  type GhReviewComment = {
    id: number;
    in_reply_to_id?: number;
    pull_request_review_id: number | null;
    path: string;
    side: "LEFT" | "RIGHT" | null;
    line: number | null;
    start_line: number | null;
    original_line: number | null;
    diff_hunk: string;
    body: string;
    user: GhUser;
    created_at: string;
    html_url: string;
  };
  type GhComment = { id: number; body: string | null; user: GhUser; created_at: string; html_url: string };
  type GhReview = { id: number; body: string | null; user: GhUser; state: string; submitted_at: string | null; html_url: string };
  type GhCommit = { sha: string; html_url: string; author: GhUser; commit: { message: string; author: { date: string } | null } };
  type GhChecks = { check_runs: { name: string; status: string; conclusion: string | null; html_url: string | null; details_url: string | null }[] };

  const pr = await gh<GhPull>(`${base}/pulls/${number}`, reader);
  const [files, inline, comments, reviews, commits, checks] = await Promise.all([
    ghPages<GhFile>(`${base}/pulls/${number}/files`, reader, 3),
    ghPages<GhReviewComment>(`${base}/pulls/${number}/comments`, reader, 3),
    ghPages<GhComment>(`${base}/issues/${number}/comments`, reader, 2),
    ghPages<GhReview>(`${base}/pulls/${number}/reviews`, reader, 2),
    ghPages<GhCommit>(`${base}/pulls/${number}/commits`, reader, 2),
    gh<GhChecks>(`${base}/commits/${pr.head.sha}/check-runs?per_page=100`, reader).catch(() => ({ check_runs: [] })),
  ]);

  const truncated: string[] = [];
  if (!files.complete) truncated.push(`only the first ${files.items.length} of ${pr.changed_files} files`);
  if (!inline.complete) truncated.push(`only the first ${inline.items.length} review comments`);
  if (!commits.complete) truncated.push(`only the first ${commits.items.length} of ${pr.commits} commits`);

  // Replies point at the thread's first comment.
  const threads = new Map<number, Thread>();
  for (const c of inline.items) {
    const comment: Comment = { id: c.id, author: person(c.user), body: c.body, at: time(c.created_at), url: c.html_url };
    const root = c.in_reply_to_id ? threads.get(c.in_reply_to_id) : undefined;
    if (root) root.comments.push(comment);
    else
      threads.set(c.id, {
        id: c.id,
        path: c.path,
        side: c.side ?? "RIGHT",
        line: c.line,
        startLine: c.start_line,
        originalLine: c.original_line,
        hunk: c.diff_hunk,
        comments: [comment],
      });
  }
  const inlineByReview = new Map<number, number>();
  for (const c of inline.items) if (c.pull_request_review_id) inlineByReview.set(c.pull_request_review_id, (inlineByReview.get(c.pull_request_review_id) ?? 0) + 1);

  const reviewState = (s: string): ReviewState =>
    s === "APPROVED" ? "approved" : s === "CHANGES_REQUESTED" ? "changes_requested" : s === "DISMISSED" ? "dismissed" : s === "PENDING" ? "pending" : "commented";

  const activity: Activity[] = [
    ...comments.items.map((c): Activity => ({ kind: "comment", id: c.id, author: person(c.user), body: c.body ?? "", at: time(c.created_at), url: c.html_url })),
    ...reviews.items
      .filter((r) => r.state !== "PENDING")
      .map(
        (r): Activity => ({
          kind: "review",
          id: r.id,
          author: person(r.user),
          body: r.body ?? "",
          state: reviewState(r.state),
          inline: inlineByReview.get(r.id) ?? 0,
          at: time(r.submitted_at),
          url: r.html_url,
        }),
      ),
    ...commits.items.map(
      (c): Activity => ({ kind: "commit", sha: c.sha, message: c.commit.message, author: c.author ? person(c.author) : null, at: time(c.commit.author?.date), url: c.html_url }),
    ),
  ].sort((a, b) => a.at - b.at);

  return {
    repo: pr.base.repo.full_name,
    number: pr.number,
    url: pr.html_url,
    title: pr.title,
    body: pr.body ?? "",
    state: pr.merged ? "merged" : pr.state,
    draft: pr.draft,
    author: person(pr.user),
    base: pr.base.ref,
    head: pr.head.ref,
    headRepo: pr.head.repo && pr.head.repo.full_name !== pr.base.repo.full_name ? pr.head.repo.full_name : null,
    headSha: pr.head.sha,
    created: time(pr.created_at),
    updated: time(pr.updated_at),
    merged: pr.merged_at ? time(pr.merged_at) : null,
    closed: pr.closed_at ? time(pr.closed_at) : null,
    labels: pr.labels.map((l) => ({ name: l.name, color: l.color })),
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changed_files,
    commits: pr.commits,
    reviewers: reviewersOf(pr.user?.login ?? "", reviews.items, pr.requested_reviewers, reviewState),
    checks: checks.check_runs.map((c) => ({ name: c.name, status: c.status, conclusion: c.conclusion, url: c.html_url ?? c.details_url })),
    files: files.items.map((f) => ({
      path: f.filename,
      previous: f.previous_filename ?? null,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch ?? null,
      sha: f.sha,
      generated: GENERATED.some((re) => re.test(f.filename)),
      url: f.blob_url,
    })),
    threads: [...threads.values()],
    activity,
    truncated,
  };
}

/** Each reviewer's standing: their latest approval, change request or
 *  dismissal, else that they commented; asked-for reviewers who have not
 *  answered are pending. */
function reviewersOf(
  author: string,
  reviews: { user: GhUser; state: string }[],
  requested: GhUser[],
  reviewState: (s: string) => ReviewState,
): { person: Person; state: ReviewState }[] {
  const out = new Map<string, { person: Person; state: ReviewState }>();
  for (const r of reviews) {
    const p = person(r.user);
    if (p.login === author || r.state === "PENDING") continue;
    const state = reviewState(r.state);
    const prev = out.get(p.login);
    if (!prev || state !== "commented" || prev.state === "commented") out.set(p.login, { person: p, state });
  }
  for (const u of requested) {
    const p = person(u);
    if (!out.has(p.login)) out.set(p.login, { person: p, state: "pending" });
  }
  return [...out.values()];
}
