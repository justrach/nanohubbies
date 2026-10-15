import { encode, fromHex, treeBody, type GitObject } from "../git";

/** The tip's directories, kept in memory: each directory's entries by name,
 *  and its git tree's body. A landing changes one entry in each directory on
 *  its paths, nearly always a sha, so the body keeps where each entry's sha
 *  is and takes the new one in place: rebuilding a directory's tree is then
 *  writing 20 bytes and hashing, not sorting and writing every entry again.
 *  An entry that comes, goes or changes mode sends the body to be rebuilt the
 *  next time it is asked for. */

export const FILE = "100644";
export const DIR = "40000";

export interface Dir {
  entries: Map<string, { mode: string; sha: string }>;
  built: { body: Uint8Array; at: Map<string, number> } | null;
}

export type Dirs = Map<string, Dir>;

/** The directory at `path`, made empty when it is new. */
export function dirAt(dirs: Dirs, path: string): Dir {
  let found = dirs.get(path);
  if (!found) dirs.set(path, (found = { entries: new Map(), built: null }));
  return found;
}

export function setEntry(d: Dir, name: string, mode: string, sha: string) {
  const old = d.entries.get(name);
  d.entries.set(name, { mode, sha });
  if (!d.built) return;
  if (old?.mode === mode) fromHex(sha, d.built.body, d.built.at.get(name)!);
  else d.built = null;
}

export function removeEntry(d: Dir, name: string) {
  if (d.entries.delete(name)) d.built = null;
}

/** The directory's tree object. Encoding copies the body, so changing the
 *  body later leaves objects already made as they were. */
export function treeOf(d: Dir): GitObject {
  d.built ??= treeBody([...d.entries].map(([name, e]) => ({ name, ...e })));
  return encode("tree", d.built.body);
}
