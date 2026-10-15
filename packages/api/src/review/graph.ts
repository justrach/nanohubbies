import { deflateSync } from "node:zlib";
import { commit, encode, isDir, objectKey, readTree, tree, type GitObject, type TreeEntry } from "../git";
import { parseCommit } from "../browse/objects";
import { changedFiles, entryAt, type Objects } from "../trees";
import type { Edit, Owner } from "../types";

export async function commitAt(objects: Objects, sha: string) {
  const c = parseCommit(sha, await objects.body(sha, "commit"));
  if (!/^[a-f0-9]{40}$/.test(c.tree) || c.parents.some((p) => !/^[a-f0-9]{40}$/.test(p))) throw new Error("Invalid commit");
  return c;
}

export async function ancestors(objects: Objects, sha: string, stop = new Set<string>()) {
  const found = new Map<string, string>();
  const queue = [sha];
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i];
    if (found.has(at)) continue;
    if (found.size >= 2000) throw new Error("History exceeds 2000 commits; split or rebase this branch");
    const c = await commitAt(objects, at);
    found.set(at, c.tree);
    if (!stop.has(at)) queue.push(...c.parents);
  }
  return found;
}

export async function mergeBase(objects: Objects, head: string, base: string) {
  const left = await ancestors(objects, head, new Set([base]));
  const queue = [base], seen = new Set<string>();
  for (let i = 0; i < queue.length && seen.size < 2000; i++) {
    const at = queue[i];
    if (seen.has(at)) continue;
    seen.add(at);
    if (left.has(at)) return { commit: at, tree: left.get(at)! };
    queue.push(...(await commitAt(objects, at)).parents);
  }
  throw new Error("The branches have no common ancestor within the history limit");
}

/** Conservative three-way replay: identical edits coalesce, disjoint files
 * replay, and competing edits return paths without changing either ref. */
export async function replay(objects: Objects, anchor: string, head: string, base: string) {
  const changed = await changedFiles(objects, anchor, head);
  const patches = new Map<string, TreeEntry | null>();
  const conflicts: string[] = [];
  for (const c of changed) {
    const now = await entryAt(objects, base, c.path);
    const same = (a: TreeEntry | null, b: TreeEntry | null) => a?.sha === b?.sha && a?.mode === b?.mode;
    if (same(now, c.after)) continue;
    if (!same(now, c.before)) conflicts.push(c.path);
    else patches.set(c.path, c.after);
  }
  if (conflicts.length) throw new Error(`Resolve conflicts locally and push again: ${conflicts.slice(0, 20).join(", ")}`);
  const made: GitObject[] = [];
  async function rebuild(root: string | null, prefix: string): Promise<string> {
    const entries = new Map((root ? readTree(await objects.body(root, "tree")) : []).map((e) => [e.name, e]));
    const directories = new Set<string>();
    for (const [path, after] of patches) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length), slash = rest.indexOf("/");
      if (slash >= 0) directories.add(rest.slice(0, slash));
      else if (after) entries.set(rest, { ...after, name: rest });
      else entries.delete(rest);
    }
    for (const name of directories) {
      const prev = entries.get(name);
      if (prev && !isDir(prev)) throw new Error(`Resolve file/directory conflict at ${prefix}${name}`);
      const sha = await rebuild(prev?.sha ?? null, `${prefix}${name}/`);
      const empty = tree([]).sha;
      if (sha === empty) entries.delete(name);
      else entries.set(name, { name, mode: "40000", sha });
    }
    const obj = tree([...entries.values()]); made.push(obj); return obj.sha;
  }
  const root = await rebuild(base, "");
  return { root, objects: made, patches };
}

export async function mergeEdits(objects: Objects, patches: Map<string, TreeEntry | null>, base: string): Promise<Edit[]> {
  const edits: Edit[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  for (const [path, e] of patches) {
    if (e && e.mode !== "100644") throw new Error(`${path}: main currently supports regular non-executable text files only`);
    const before = await entryAt(objects, base, path);
    edits.push(e ? { op: before ? "write" : "create", path, text: decoder.decode(await objects.body(e.sha, "blob")) } : { op: "remove", path });
  }
  return edits;
}

export function restackCommit(root: string, parent: string, owner: Owner, title: string) {
  const signature = { name: owner.name, email: `${owner.id.replace(/[^a-zA-Z0-9.-]/g, "-")}@nanohub.invalid`, time: Math.floor(Date.now() / 1000) };
  return commit({ tree: root, parents: [parent], author: signature, committer: signature, message: title });
}

export async function publishObjects(env: Env, trunk: string, objects: GitObject[]) {
  // Loose objects do not advance or interfere with the main packer's
  // contiguous publication watermark. A ref is exposed only after all writes.
  for (let i = 0; i < objects.length; i += 8) await Promise.all(objects.slice(i, i + 8)
    .map((o) => env.OBJECTS.put(objectKey(trunk, o.sha), deflateSync(o.raw))));
}

export { encode };
