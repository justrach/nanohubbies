import { encode, isDir, readTree, type ObjectType } from "../git";
import { ObjectReader } from "../objects";
import type { Command } from "../receive";
import { ZERO } from "../receive";
import type { Unpacked } from "../unpack";
import { branchName } from "./types";
import { commitAt, mergeBase, publishObjects } from "./graph";

export async function pushBranch(env: Env, trunk: string, command: Command, pack: Map<string, Unpacked>) {
  if (!command.ref.startsWith("refs/heads/")) throw new Error("Push a branch under refs/heads/");
  const name = branchName(command.ref.slice(11));
  const seq = env.SEQUENCER.get(env.SEQUENCER.idFromName(trunk));
  const snapshot = await seq.review({ op: "snapshot" });
  const current = snapshot.branches.find((b) => b.name === name);
  if ((current?.commit ?? ZERO) !== command.old) throw new Error("Branch changed; fetch before pushing again");
  if (command.new === ZERO) {
    await seq.review({ op: "branch", name, old: command.old === ZERO ? null : command.old, next: null });
    return;
  }
  const reader = new ObjectReader(env.OBJECTS, trunk, async () => (await env.PACKER.get(env.PACKER.idFromName(trunk)).list()).packs);
  let reads = 0;
  const seen = new Set<string>(), validatedTrees = new Set<string>(), validatedBlobs = new Set<string>();
  const objects = { async body(sha: string, type: ObjectType) {
    if (++reads > 16000) throw new Error("Branch push exceeds the object traversal limit");
    const obj = pack.get(sha) ?? await reader.get(sha);
    if (!obj || obj.type !== type) throw new Error(`Missing or invalid ${type} ${sha}`);
    return obj.body;
  } };
  const known = new Set(snapshot.branches.map((b) => b.commit));
  const queue = [command.new];
  let connected = false;
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  async function validateTree(sha: string, depth = 0): Promise<void> {
    if (depth > 40) throw new Error("Tree exceeds directory depth limit");
    if (validatedTrees.has(sha)) return;
    validatedTrees.add(sha);
    seen.add(sha);
    const raw = await objects.body(sha, "tree");
    // readTree is an internal fast parser. Validate framing before calling it
    // on untrusted push bytes, so a missing terminator cannot stall its loop.
    for (let at = 0; at < raw.length;) {
      const space = raw.indexOf(32, at), nul = raw.indexOf(0, space + 1);
      if (space < at || nul <= space + 1 || nul + 21 > raw.length) throw new Error("Malformed tree object");
      at = nul + 21;
    }
    const entries = readTree(raw);
    const names = new Set<string>();
    for (const e of entries) {
      if (!e.name || /[/\\\0]/.test(e.name) || [".", "..", ".git"].includes(e.name.toLowerCase()) || names.has(e.name)) throw new Error("Unsafe or duplicate tree entry");
      names.add(e.name);
      if (isDir(e)) await validateTree(e.sha, depth + 1);
      else {
        if (!["100644", "100755"].includes(e.mode)) throw new Error("Branches support regular text files, not links or submodules");
        if (validatedBlobs.has(e.sha)) continue;
        validatedBlobs.add(e.sha);
        seen.add(e.sha);
        const bytes = await objects.body(e.sha, "blob");
        if (bytes.length > 256 * 1024 || bytes.includes(0)) throw new Error("Branch files must be text and at most 256 KiB");
        decoder.decode(bytes);
      }
    }
  }
  const commits = new Set<string>();
  for (let i = 0; i < queue.length; i++) {
    const sha = queue[i];
    if (commits.has(sha)) continue;
    commits.add(sha);
    if (known.has(sha) || (await seq.versionsOf([sha]))[sha]) { connected = true; continue; }
    if (commits.size > 200) throw new Error("Push at most 200 new commits at a time");
    const c = await commitAt(objects, sha);
    await validateTree(c.tree);
    queue.push(...c.parents);
  }
  if (!connected) throw new Error("Branch must build on a workspace commit; clone this workspace first");
  const head = await commitAt(objects, command.new);
  const rebased = [];
  for (const p of snapshot.pulls.filter((p) => p.state === "open" && p.head === name)) {
    const base = snapshot.branches.find((b) => b.name === p.base)!;
    if (base.commit !== p.anchor && (await mergeBase(objects, command.new, base.commit)).commit === base.commit) {
      rebased.push({ number: p.number, anchor: p.anchor, base });
    }
  }
  await publishObjects(env, trunk, [...pack].filter(([sha]) => commits.has(sha) || seen.has(sha)).map(([, o]) => encode(o.type, o.body)));
  await seq.review({ op: "branch", name, old: command.old === ZERO ? null : command.old, next: { commit: command.new, tree: head.tree }, rebased });
}
