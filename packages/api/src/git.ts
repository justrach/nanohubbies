import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { sha1Hex } from "./sha1";

/** Git's object format: enough to publish a trunk that plain `git clone` can
 *  fetch. Hashing is synchronous on purpose. The sequencer builds a commit in
 *  one uninterrupted step, so no other change can land in between. */

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder();

export type ObjectType = "blob" | "tree" | "commit";

/** An object in loose form, `<type> <size>\0<body>`, before compression. */
export interface GitObject {
  sha: string;
  raw: Uint8Array;
}

export interface TreeEntry {
  mode: string;
  name: string;
  sha: string;
}

export interface Signature {
  name: string;
  email: string;
  /** Unix seconds. */
  time: number;
}

const DIR = "40000";

export function encode(type: ObjectType, body: Uint8Array): GitObject {
  // The header is ASCII, so it is written byte by byte: each TextEncoder call
  // costs more in the Workers runtime than the bytes it writes.
  const head = `${type} ${body.length}\0`;
  const raw = new Uint8Array(head.length + body.length);
  for (let i = 0; i < head.length; i++) raw[i] = head.charCodeAt(i);
  raw.set(body, head.length);
  // Small objects hash faster in plain JavaScript than through node:crypto,
  // whose setup costs about what hashing 500 bytes does (./sha1).
  return { sha: raw.length <= 512 ? sha1Hex(raw) : createHash("sha1").update(raw).digest("hex"), raw };
}

export const blob = (text: string) => encode("blob", utf8.encode(text));

export const tree = (entries: TreeEntry[]): GitObject => encode("tree", treeBody(entries).body);

/** A tree's body, and where in it each entry's sha is, by name: a caller
 *  that keeps the body can change an entry's sha by writing those 20 bytes. */
export function treeBody(entries: TreeEntry[]): { body: Uint8Array; at: Map<string, number> } {
  // Git orders entries by the bytes of their names, a directory's as if it
  // ended in "/". For ASCII names that is plain string order, and their
  // bytes are written one by one, with no encoder call per entry.
  const keyed = entries.map((e) => {
    const key = e.mode === DIR ? `${e.name}/` : e.name;
    return { e, key, bytes: ASCII.test(key) ? null : utf8.encode(key) };
  });
  keyed.sort((a, b) => (a.bytes || b.bytes ? compareBytes(a.bytes ?? utf8.encode(a.key), b.bytes ?? utf8.encode(b.key)) : a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const names = keyed.map(({ e, bytes }) => (bytes ? utf8.encode(e.name) : e.name));
  let size = 0;
  keyed.forEach(({ e }, i) => (size += e.mode.length + names[i].length + 22));
  const body = new Uint8Array(size);
  const shas = new Map<string, number>();
  let at = 0;
  keyed.forEach(({ e }, i) => {
    for (let j = 0; j < e.mode.length; j++) body[at++] = e.mode.charCodeAt(j);
    body[at++] = 0x20;
    const name = names[i];
    if (typeof name === "string") for (let j = 0; j < name.length; j++) body[at++] = name.charCodeAt(j);
    else {
      body.set(name, at);
      at += name.length;
    }
    body[at++] = 0;
    fromHex(e.sha, body, at);
    shas.set(e.name, at);
    at += 20;
  });
  return { body, at: shas };
}

export function commit(c: { tree: string; parents: string[]; author: Signature; committer: Signature; message: string }): GitObject {
  const sig = (s: Signature) => `${clean(s.name)} <${clean(s.email)}> ${s.time} +0000`;
  const head = [`tree ${c.tree}`, ...c.parents.map((p) => `parent ${p}`), `author ${sig(c.author)}`, `committer ${sig(c.committer)}`];
  return encode("commit", utf8.encode(`${head.join("\n")}\n\n${c.message.replace(/\n*$/, "\n")}`));
}

/** Builds every tree for a set of files given as path → blob sha. */
export function buildTree(files: Map<string, string>): { root: string; objects: GitObject[] } {
  interface Dir {
    files: Map<string, string>;
    dirs: Map<string, Dir>;
  }
  const newDir = (): Dir => ({ files: new Map(), dirs: new Map() });
  const top = newDir();
  for (const [path, sha] of files) {
    const parts = path.split("/");
    let dir = top;
    for (const part of parts.slice(0, -1)) {
      let next = dir.dirs.get(part);
      if (!next) dir.dirs.set(part, (next = newDir()));
      dir = next;
    }
    dir.files.set(parts[parts.length - 1], sha);
  }
  const objects: GitObject[] = [];
  const write = (dir: Dir): string => {
    const entries: TreeEntry[] = [...dir.files].map(([name, sha]) => ({ mode: "100644", name, sha }));
    for (const [name, sub] of dir.dirs) entries.push({ mode: DIR, name, sha: write(sub) });
    const obj = tree(entries);
    objects.push(obj);
    return obj.sha;
  };
  return { root: write(top), objects };
}

export function decode(raw: Uint8Array): { type: ObjectType; body: Uint8Array } {
  // The type is told by its first letters, without a decoder call per object.
  const type: ObjectType | null = raw[0] === 0x62 ? "blob" : raw[0] === 0x63 ? "commit" : raw[0] === 0x74 && raw[1] === 0x72 ? "tree" : null;
  const nul = raw.indexOf(0);
  if (!type || nul < 0) throw new Error("not a blob, tree or commit in loose form");
  return { type, body: raw.subarray(nul + 1) };
}

export function readTree(body: Uint8Array): TreeEntry[] {
  const entries: TreeEntry[] = [];
  for (let i = 0; i < body.length; ) {
    const space = body.indexOf(0x20, i);
    const nul = body.indexOf(0, space);
    entries.push({
      mode: fromUtf8.decode(body.subarray(i, space)),
      name: fromUtf8.decode(body.subarray(space + 1, nul)),
      sha: toHex(body, nul + 1, nul + 21),
    });
    i = nul + 21;
  }
  return entries;
}

export const isDir = (e: TreeEntry) => e.mode === DIR;
export const text = (body: Uint8Array) => fromUtf8.decode(body);
/** A loose object as trunks from before packs stored it in R2. */
export const decompress = (stored: Uint8Array) => new Uint8Array(inflateSync(stored));

/** Where a trunk's loose objects lived in R2, before packs; its packs sit under
 *  the same prefix. Content-addressed, so never overwritten. */
export const objectKey = (trunk: string, sha: string) => `objects/${trunk}/${sha}`;

function clean(s: string) {
  return s.replace(/[<>\n]/g, "");
}

// Hex and byte order without Buffer, which in the Workers runtime costs far
// more per call than a table lookup, and is called for every tree entry.
const ASCII = /^[\x00-\x7f]*$/;
const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
const NIBBLE = new Uint8Array(128);
for (let i = 0; i < 16; i++) NIBBLE["0123456789abcdef".charCodeAt(i)] = NIBBLE["0123456789ABCDEF".charCodeAt(i)] = i;

/** Bytes `start` to `end` as lowercase hex. */
export function toHex(bytes: Uint8Array, start = 0, end = bytes.length): string {
  let s = "";
  for (let i = start; i < end; i++) s += HEX[bytes[i]];
  return s;
}

/** Hex as bytes, written into `out` from `at`. */
export function fromHex(hex: string, out: Uint8Array = new Uint8Array(hex.length >> 1), at = 0): Uint8Array {
  for (let i = 0; i < hex.length; i += 2) out[at + (i >> 1)] = (NIBBLE[hex.charCodeAt(i)] << 4) | NIBBLE[hex.charCodeAt(i + 1)];
  return out;
}

export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

