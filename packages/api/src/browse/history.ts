import { GENERATED } from "../github/pulls";
import { changedFiles, type Change } from "../trees";
import type { Head } from "../types";
import { gitDiff, unified } from "./diff";
import { inTurn, parseCommit, type CommitInfo, type TrunkObjects } from "./objects";

/** A landed version as the history lists it. */
export interface CommitSummary {
  version: number;
  commit: string;
  subject: string;
  body: string;
  /** The agent that made the change: its Agent trailer, or the commit's author. */
  agent: string;
  /** The person the agent worked for. */
  owner: string | null;
  issue: number | null;
  closes: boolean;
  author: { name: string; email: string };
  at: number;
}

export function summarize(version: number, c: CommitInfo): CommitSummary {
  const trailer = (k: string) => c.trailers.find(([key]) => key === k)?.[1] ?? null;
  const issue = /#(\d+)/.exec(trailer("Closes") ?? trailer("Issue") ?? "");
  return {
    version,
    commit: c.sha,
    subject: c.subject,
    body: c.body,
    agent: trailer("Agent") ?? c.author.name,
    owner: trailer("On-behalf-of"),
    issue: issue ? Number(issue[1]) : null,
    closes: trailer("Closes") !== null,
    author: { name: c.author.name, email: c.author.email },
    at: c.committer.at || c.author.at,
  };
}

export async function readCommit(objects: TrunkObjects, head: Head): Promise<CommitInfo> {
  return parseCommit(head.commit, await objects.body(head.commit, "commit"));
}

export async function summaries(objects: TrunkObjects, heads: Head[]): Promise<CommitSummary[]> {
  return inTurn(heads, async (h) => summarize(h.version, await readCommit(objects, h)));
}

/** One changed file, shaped like a GitHub pull request's file, so the same
 *  page draws both. */
export interface ChangedFile {
  path: string;
  previous: null;
  status: "added" | "removed" | "modified";
  additions: number;
  deletions: number;
  /** The hunks; null when the file was too big to diff here. */
  patch: string | null;
  /** The blob it changes to, or the one removed. */
  sha: string;
  generated: boolean;
}

/** Files listed, files diffed, and bytes of text diffed, for one page. */
const MAX_LISTED = 3000;
const MAX_DIFFED = 300;
const MAX_SIDE_BYTES = 1 << 20;
const MAX_DIFF_BYTES = 8 << 20;

/** What changed between two trees, file by file, with each file's diff while
 *  the page's budget lasts. `truncated` says what was left out. */
export async function changesBetween(objects: TrunkObjects, from: string | null, to: string): Promise<{ files: ChangedFile[]; truncated: string[] }> {
  const changed = (await changedFiles(objects, from, to)).sort((x, y) => (x.path < y.path ? -1 : 1));
  const truncated: string[] = [];
  if (changed.length > MAX_LISTED) truncated.push(`${(changed.length - MAX_LISTED).toLocaleString("en-US")} more changed files are not listed`);
  if (Math.min(changed.length, MAX_LISTED) > MAX_DIFFED) truncated.push(`only the first ${MAX_DIFFED} files have diffs here`);
  let bytes = 0;
  const listed = changed.slice(0, MAX_LISTED).map((c, i) => ({ c, i }));
  const files = await inTurn(listed, async ({ c, i }): Promise<ChangedFile> => {
    const file: ChangedFile = {
      path: c.path,
      previous: null,
      status: !c.before ? "added" : !c.after ? "removed" : "modified",
      additions: 0,
      deletions: 0,
      patch: null,
      sha: (c.after ?? c.before)!.sha,
      generated: GENERATED.some((re) => re.test(c.path)),
    };
    if (i >= MAX_DIFFED || bytes > MAX_DIFF_BYTES) return file;
    const [before, after] = await Promise.all([c.before ? objects.text(c.before.sha) : "", c.after ? objects.text(c.after.sha) : ""]);
    bytes += before.length + after.length;
    if (before.length > MAX_SIDE_BYTES || after.length > MAX_SIDE_BYTES) return file;
    const p = unified(before, after);
    return { ...file, additions: p.additions, deletions: p.deletions, patch: p.hunks };
  });
  return { files, truncated };
}

/** The most bytes of patch made in one request. */
const MAX_PATCH_BYTES = 32 << 20;

/** Every change between two trees as one patch for `git apply` or `git am`. */
export async function patchBetween(objects: TrunkObjects, from: string | null, to: string): Promise<{ diff: string; files: number }> {
  const changed = (await changedFiles(objects, from, to)).sort((x, y) => (x.path < y.path ? -1 : 1));
  let bytes = 0;
  const side = async (e: Change["before"]) => {
    if (!e) return null;
    const text = await objects.text(e.sha);
    bytes += text.length;
    if (bytes > MAX_PATCH_BYTES) throw new PatchTooBig(`the patch would be over ${MAX_PATCH_BYTES >> 20} MB; clone the trunk with git instead`);
    return { sha: e.sha, text };
  };
  const parts = await inTurn(changed, async (c) => gitDiff(c.path, await side(c.before), await side(c.after)));
  return { diff: parts.join(""), files: changed.length };
}

export class PatchTooBig extends Error {}
