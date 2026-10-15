import { commit, encode, text, type GitObject } from "../git";
import type { ChangeRequest, Overlap } from "../types";

/** What a landing's commit says about the change it came from. */
export type Landing = Pick<ChangeRequest, "id" | "agent" | "intent" | "base"> & Partial<Pick<ChangeRequest, "owner" | "issue" | "closes" | "pushed">>;

/** The commit a landing makes on `parent`: the agent as author, the
 *  sequencer as committer, and trailers naming the change, the agent, the
 *  base and the version, who it was for, its issue, and what to revalidate.
 *  A pushed commit that is exactly this version (a fast-forward, with the tree
 *  the trunk computed) is kept as is: the agent's history and the trunk's stay
 *  one, and its next push needs no pull first. */
export function landingCommit(version: number, root: string, c: Landing, soft: Overlap[], parent: string | null): GitObject {
  if (c.pushed && fastForward(c.pushed.body, root, parent)) return encode("commit", c.pushed.body);
  const time = Math.floor(Date.now() / 1000);
  const trailers = [
    `Change-Id: ${c.id}`,
    `Agent: ${c.agent}`,
    `Base: v${c.base}`,
    `Version: v${version}`,
    ...(c.owner ? [`On-behalf-of: ${c.owner.name}`] : []),
    ...(c.issue != null ? [c.closes ? `Closes: #${c.issue}` : `Issue: #${c.issue}`] : []),
    ...soft.map((o) => `Revalidate: ${o.key} (changed by ${o.by} in v${o.version})`),
  ];
  return commit({
    tree: root,
    parents: parent ? [parent] : [],
    author: { name: c.agent, email: `${slug(c.agent)}@agents.invalid`, time },
    committer: { name: "nanohub swarm", email: "sequencer@agents.invalid", time },
    message: `${c.intent}\n\n${trailers.join("\n")}`,
  });
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9.-]+/g, "-") || "agent";

/** Whether a commit's body names exactly this tree and this one parent. */
function fastForward(body: Uint8Array, tree: string, parent: string | null): boolean {
  const head = text(body).split("\n\n", 1)[0].split("\n");
  const parents = head.filter((l) => l.startsWith("parent ")).map((l) => l.slice(7));
  return head[0] === `tree ${tree}` && parent !== null && parents.length === 1 && parents[0] === parent;
}
