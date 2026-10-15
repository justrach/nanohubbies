import type { Head, RepoInfo } from "../types";
import type { CommitSummary } from "./history";

/** Everything that landed between two versions as one email, the way `git
 *  format-patch` writes it, so `git am` makes a single commit whose message
 *  says where it came from: the trunk, its versions, and the newest changes.
 *  Applied to the commit the trunk was imported from, it is the trunk's work
 *  on the original repository, ready for a pull request. */
export function mbox(p: { trunk: string; origin: string; from: Head; to: Head; files: number; newest: CommitSummary[]; repo: RepoInfo | null; diff: string }): string {
  const n = p.to.version - p.from.version;
  const count = (k: number, one: string) => `${k.toLocaleString("en-US")} ${one}${k === 1 ? "" : "s"}`;
  const subject = n === 1 && p.newest[0] ? p.newest[0].subject : `Land ${count(n, "change")} from the swarm trunk ${p.trunk}`;
  const started = p.repo?.commit ? `, which started from ${p.repo.fullName} at ${p.repo.commit.slice(0, 12)}` : "";
  const body = [
    `${count(n, "change")} to ${count(p.files, "file")}, landed on the nanohub swarm trunk ${p.trunk} between v${p.from.version} and v${p.to.version}${started}.`,
    ...(n > 1
      ? [
          "",
          "Newest first:",
          "",
          ...p.newest.map((c) => `- v${c.version} ${oneLine(c.subject)} (${c.agent}${c.owner ? ` for ${c.owner}` : ""})`),
          ...(n > p.newest.length ? [`- and ${count(n - p.newest.length, "earlier change")}`] : []),
        ]
      : []),
    "",
    `Swarm-Trunk: ${p.origin}/t/${p.trunk}`,
    `Swarm-Versions: v${p.from.version}..v${p.to.version}`,
    `Swarm-Commit: ${p.to.commit}`,
  ];
  return [
    `From ${p.to.commit} Mon Sep 17 00:00:00 2001`,
    "From: nanohub swarm <swarm@agents.invalid>",
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Subject: [PATCH] ${header(oneLine(subject))}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    ...body,
    "---",
    `${p.diff}-- `,
    "nanohub swarm",
    "",
  ].join("\n");
}

/** One line, and nothing git's mail reader would take for the patch itself. */
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim().replace(/^(-{3}|diff -)/, " $1").slice(0, 200);

/** A header value, encoded when it is not plain ASCII. */
function header(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  let bin = "";
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return `=?UTF-8?B?${btoa(bin)}?=`;
}
