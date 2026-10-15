import { decode, type GitObject } from "./git";
import { buildPack, concat, packEntry } from "./packfile";

/** The client half of a git smart-HTTP push (receive-pack, protocol v1):
 *  enough for the sequencer, a trunk's only writer, to mirror landed commits
 *  into a Cloudflare Artifacts repo. */

export const ZERO = "0".repeat(40);
const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder();
const FLUSH = utf8.encode("0000");

export interface PushTarget {
  remote: string;
  token: string;
}

/** Moves `ref` to `to`, sending `objects`. The remote ref must be at a commit
 *  `ours` recognises (or absent when `fromEmpty`): a push never overwrites
 *  history the trunk did not write. Pushing a commit the remote already has
 *  is a no-op, so a push that succeeded but went unrecorded can be retried. */
export async function push(
  target: PushTarget,
  ref: string,
  to: string,
  objects: GitObject[],
  ours: (sha: string) => boolean,
  fromEmpty: boolean,
): Promise<void> {
  const auth = { Authorization: `Bearer ${target.token}`, "User-Agent": "nanohub-swarm" };
  const adv = await fetch(`${target.remote}/info/refs?service=git-receive-pack`, { headers: auth });
  if (!adv.ok) throw new Error(`push: ref advertisement failed (HTTP ${adv.status})`);
  let current = ZERO;
  let caps = new Set<string>();
  for (const line of pktLines(new Uint8Array(await adv.arrayBuffer()))) {
    if (line === null || line.startsWith("# service=")) continue;
    const [refPart, capPart] = line.split("\0");
    if (capPart !== undefined) caps = new Set(capPart.trim().split(" "));
    const [sha, name] = refPart.split(" ");
    if (name === ref) current = sha;
  }
  if (current === to) return;
  if (current === ZERO ? !fromEmpty : !ours(current)) {
    throw new Error(`push: ${ref} is at ${current.slice(0, 7)}, which this trunk did not write`);
  }

  const wanted = ["report-status", "agent=nanohub-swarm"].filter((c) => c.startsWith("agent=") || caps.has(c));
  const res = await fetch(`${target.remote}/git-receive-pack`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/x-git-receive-pack-request", Accept: "application/x-git-receive-pack-result" },
    body: concat([pkt(`${current} ${to} ${ref}\0${wanted.join(" ")}\n`), FLUSH, pack(objects)]),
  });
  if (!res.ok) throw new Error(`push: receive-pack failed (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`);
  if (!wanted.includes("report-status")) return;
  const report = pktLines(new Uint8Array(await res.arrayBuffer())).filter((l): l is string => l !== null);
  const status = report.find((l) => l.startsWith("ok ") || l.startsWith("ng "));
  if (!report.includes("unpack ok") || !status?.startsWith("ok ")) throw new Error(`push: ${report.join("; ") || "no status report"}`);
}

/** A version 2 packfile of whole objects, deduplicated, without deltas. */
export function pack(objects: GitObject[]): Uint8Array {
  return buildPack(
    objects.map((o) => {
      const { type, body } = decode(o.raw);
      return packEntry(o.sha, type, body);
    }),
  ).pack;
}

function pkt(line: string): Uint8Array {
  const data = utf8.encode(line);
  return concat([utf8.encode((data.length + 4).toString(16).padStart(4, "0")), data]);
}

/** Splits a pkt-line stream. A flush packet comes back as null. */
function pktLines(bytes: Uint8Array): (string | null)[] {
  const out: (string | null)[] = [];
  for (let i = 0; i + 4 <= bytes.length; ) {
    const len = parseInt(fromUtf8.decode(bytes.subarray(i, i + 4)), 16);
    if (Number.isNaN(len)) break;
    if (len < 4) {
      out.push(null);
      i += 4;
      continue;
    }
    out.push(fromUtf8.decode(bytes.subarray(i + 4, i + len)).replace(/\n$/, ""));
    i += len;
  }
  return out;
}
