// What the Worker's browsing routes send (packages/api/src/browse). Kept here,
// not imported from the Worker, so the web build never pulls in Worker code.

import type { PullFile } from "@/pr/types";

export interface CommitSummary {
  version: number;
  commit: string;
  subject: string;
  body: string;
  /** The agent that made the change. */
  agent: string;
  /** The person the agent worked for. */
  owner: string | null;
  issue: number | null;
  closes: boolean;
  author: { name: string; email: string };
  at: number;
}

export interface TreeEntry {
  name: string;
  path: string;
  type: "dir" | "file";
  sha: string;
}

export interface TreeView {
  version: number;
  commit: string;
  path: string;
  entries: TreeEntry[];
  readme: { path: string; text: string } | null;
  latest: CommitSummary;
}

export interface BlobView {
  version: number;
  commit: string;
  path: string;
  sha: string;
  size: number;
  /** Null when the file is too big to show here. */
  text: string | null;
}

export interface History {
  head: number;
  commits: CommitSummary[];
  /** Where the next, older page starts; null at the first version. */
  next: number | null;
}

/** A changed file, as the Worker sends it: a pull request's file without a link. */
export type ChangedFile = Omit<PullFile, "url">;

export interface CommitView extends CommitSummary {
  trailers: [string, string][];
  parent: number | null;
  files: ChangedFile[];
  truncated: string[];
}

export interface CompareView {
  from: number;
  to: number;
  files: ChangedFile[];
  truncated: string[];
}
