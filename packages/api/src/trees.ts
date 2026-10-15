import { isDir, readTree, type ObjectType, type TreeEntry } from "./git";

/** Where a tree walk reads objects from: a trunk's objects in R2, or a push's
 *  pack and then the trunk's. */
export interface Objects {
  body(sha: string, type: ObjectType): Promise<Uint8Array>;
}

/** A file that differs between two trees: missing before when added, missing
 *  after when removed. */
export interface Change {
  path: string;
  before: TreeEntry | null;
  after: TreeEntry | null;
}

/** Files that differ between two trees. Unchanged subtrees are skipped whole. */
export async function changedFiles(objects: Objects, a: string | null, b: string | null, prefix = "", out: Change[] = []): Promise<Change[]> {
  if (a === b) return out;
  const left = new Map(a ? readTree(await objects.body(a, "tree")).map((e) => [e.name, e]) : []);
  const right = new Map(b ? readTree(await objects.body(b, "tree")).map((e) => [e.name, e]) : []);
  for (const name of new Set([...left.keys(), ...right.keys()])) {
    const x = left.get(name) ?? null;
    const y = right.get(name) ?? null;
    if (x && y && x.sha === y.sha && x.mode === y.mode) continue;
    const path = prefix + name;
    const xDir = !!x && isDir(x);
    const yDir = !!y && isDir(y);
    if (xDir || yDir) await changedFiles(objects, xDir ? x!.sha : null, yDir ? y!.sha : null, `${path}/`, out);
    const xFile = x && !xDir ? x : null;
    const yFile = y && !yDir ? y : null;
    if (xFile || yFile) out.push({ path, before: xFile, after: yFile });
  }
  return out;
}

/** The entry at `path` under the tree `root`; the root itself for "". Null
 *  when nothing is there. */
export async function entryAt(objects: Objects, root: string, path: string): Promise<TreeEntry | null> {
  if (!path) return { mode: "40000", name: "", sha: root };
  let tree = root;
  const parts = path.split("/");
  for (const [i, part] of parts.entries()) {
    const entry = readTree(await objects.body(tree, "tree")).find((e) => e.name === part);
    if (!entry || i === parts.length - 1) return entry ?? null;
    if (!isDir(entry)) return null;
    tree = entry.sha;
  }
  return null;
}
