// The pull request document the Worker sends (src/github/pulls.ts). Kept here,
// not imported from the Worker, so the web build never pulls in Worker code.

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
  patch: string | null;
  sha: string;
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

export interface Thread {
  id: number;
  path: string;
  side: "LEFT" | "RIGHT";
  line: number | null;
  startLine: number | null;
  originalLine: number | null;
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

/** How the page was read from GitHub: with your own connection, the
 *  deployment's token, or nothing; `connect` is where to connect yours. */
export type Access = { as: "you"; login: string } | { as: "server" | "anonymous"; connect?: string };

export interface PullView {
  access: Access;
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
  truncated: string[];
}
