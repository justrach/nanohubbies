import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { fromHex, toHex, type ObjectType } from "./git";

/** Git's packfile and its index (version 2), as the trunk publishes them:
 *  every object whole, never a delta, so packs merge by copying entries. A
 *  pack is named by its checksum, as git names its own, so a client that
 *  already fetched one recognises it.
 *
 *  Each entry's zlib stream is made of stored blocks: the object as it is,
 *  framed and checksummed. A zlib call per object costs several times what
 *  the rest of packing it does, and packing has to keep up with landing;
 *  packs come out bigger, and git reads them as it reads any other. */

const TYPE = { commit: 1, tree: 2, blob: 3 } as const;
const TYPES: Record<number, ObjectType> = { 1: "commit", 2: "tree", 3: "blob" };
const utf8 = new TextEncoder();
/** An index's header and fan-out table, before its object names. */
const NAMES = 8 + 256 * 4;

/** One object as a pack stores it: a header and the compressed body, with the
 *  CRC-32 of those bytes, which the index records. */
export interface PackEntry {
  sha: string;
  crc: number;
  data: Uint8Array;
}

export function packEntry(sha: string, type: ObjectType, body: Uint8Array): PackEntry {
  const head = objectHeader(TYPE[type], body.length);
  const blocks = Math.max(1, Math.ceil(body.length / STORED));
  const data = new Uint8Array(head.length + 2 + blocks * 5 + body.length + 4);
  data.set(head);
  let at = head.length;
  // A zlib header: deflate, no preset dictionary, check bits that make it a
  // multiple of 31.
  data[at++] = 0x78;
  data[at++] = 0x01;
  for (let i = 0; i < blocks; i++) {
    const start = i * STORED;
    const len = Math.min(STORED, body.length - start);
    // A stored block: final or not, then its length and the length's complement.
    data[at++] = i === blocks - 1 ? 1 : 0;
    data[at++] = len & 0xff;
    data[at++] = len >>> 8;
    data[at++] = ~len & 0xff;
    data[at++] = (~len >>> 8) & 0xff;
    data.set(body.subarray(start, start + len), at);
    at += len;
  }
  const sum = adler32(body);
  data[at++] = sum >>> 24;
  data[at++] = (sum >>> 16) & 0xff;
  data[at++] = (sum >>> 8) & 0xff;
  data[at] = sum & 0xff;
  return { sha, crc: crc32(data), data };
}

/** A pack of `entries`, in their order, and its index. The pack is written
 *  into one buffer: a merge of big packs holds no second copy. */
export function buildPack(entries: PackEntry[]): { name: string; pack: Uint8Array; idx: Uint8Array } {
  const seen = new Set<string>();
  const unique = entries.filter((e) => !seen.has(e.sha) && !!seen.add(e.sha));
  const pack = new Uint8Array(12 + unique.reduce((n, e) => n + e.data.length, 0) + 20);
  const head = new DataView(pack.buffer);
  pack.set(utf8.encode("PACK"));
  head.setUint32(4, 2);
  head.setUint32(8, unique.length);
  const rows: { sha: string; crc: number; offset: number }[] = [];
  let at = 12;
  for (const e of unique) {
    rows.push({ sha: e.sha, crc: e.crc, offset: at });
    pack.set(e.data, at);
    at += e.data.length;
  }
  const checksum = createHash("sha1").update(pack.subarray(0, at)).digest();
  pack.set(checksum, at);
  // Lowercase hex sorts as its bytes do.
  rows.sort((a, b) => (a.sha < b.sha ? -1 : a.sha > b.sha ? 1 : 0));
  const n = rows.length;
  const idx = new Uint8Array(NAMES + n * 28 + 40);
  const view = new DataView(idx.buffer);
  view.setUint32(0, 0xff744f63);
  view.setUint32(4, 2);
  rows.forEach((r, i) => {
    fromHex(r.sha, idx, NAMES + i * 20);
    view.setUint32(NAMES + n * 20 + i * 4, r.crc);
    view.setUint32(NAMES + n * 24 + i * 4, r.offset);
  });
  // Fan-out: how many objects have a first byte at or below each value.
  for (let b = 0, k = 0; b < 256; b++) {
    while (k < n && idx[NAMES + k * 20] <= b) k++;
    view.setUint32(8 + b * 4, k);
  }
  idx.set(checksum, NAMES + n * 28);
  idx.set(createHash("sha1").update(idx.subarray(0, NAMES + n * 28 + 20)).digest(), NAMES + n * 28 + 20);
  return { name: toHex(checksum), pack, idx };
}

/** A pack's index, for finding one object without reading the whole pack. */
export class PackIndex {
  readonly count: number;
  private view: DataView;
  /** Every entry's offset, ascending: an entry ends where the next begins. */
  private starts: Uint32Array;

  constructor(
    private bytes: Uint8Array,
    /** The pack's size in bytes: its last entry ends before the checksum. */
    private packSize: number,
  ) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < NAMES + 40 || this.view.getUint32(0) !== 0xff744f63 || this.view.getUint32(4) !== 2) throw new Error("not a version 2 pack index");
    this.count = this.view.getUint32(8 + 255 * 4);
    if (bytes.length < NAMES + this.count * 28 + 40) throw new Error("pack index is cut short");
    this.starts = Uint32Array.from({ length: this.count }, (_, i) => this.offset(i)).sort();
  }

  /** Where an object's entry is in the pack, or null when it is not in it. */
  find(sha: string): { offset: number; end: number } | null {
    const key = fromHex(sha);
    let lo = key[0] ? this.view.getUint32(8 + (key[0] - 1) * 4) : 0;
    let hi = this.view.getUint32(8 + key[0] * 4);
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      let c = 0;
      for (let j = 0, at = NAMES + mid * 20; c === 0 && j < 20; j++) c = this.bytes[at + j] - key[j];
      if (c === 0) return this.span(this.offset(mid));
      if (c < 0) lo = mid + 1;
      else hi = mid;
    }
    return null;
  }

  /** Every entry of `pack`, in pack order: what merging packs copies. */
  entries(pack: Uint8Array): PackEntry[] {
    const n = this.count;
    const out = Array.from({ length: n }, (_, i) => {
      const { offset, end } = this.span(this.offset(i));
      const sha = toHex(this.bytes, NAMES + i * 20, NAMES + i * 20 + 20);
      return { sha, crc: this.view.getUint32(NAMES + n * 20 + i * 4), data: pack.subarray(offset, end), offset };
    });
    return out.sort((a, b) => a.offset - b.offset).map(({ sha, crc, data }) => ({ sha, crc, data }));
  }

  private offset(i: number): number {
    const at = this.view.getUint32(NAMES + this.count * 24 + i * 4);
    // Set high bits point into a table of large offsets, which only packs
    // over 2 GB need; the trunk never writes one.
    if (at & 0x80000000) throw new Error("pack index has large offsets");
    return at;
  }

  private span(offset: number): { offset: number; end: number } {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.starts[mid] < offset) lo = mid + 1;
      else hi = mid;
    }
    return { offset, end: lo + 1 < this.starts.length ? this.starts[lo + 1] : this.packSize - 20 };
  }
}

/** One whole object from its entry's bytes. */
export function readEntry(data: Uint8Array): { type: ObjectType; body: Uint8Array } {
  let pos = 0;
  let byte = data[pos++];
  const type = TYPES[(byte >> 4) & 7];
  let size = byte & 0x0f;
  for (let shift = 4; byte & 0x80; shift += 7) {
    byte = data[pos++];
    size += (byte & 0x7f) * 2 ** shift;
  }
  if (!type) throw new Error("pack entry is a delta or of an unknown type");
  const body = unstored(data, pos, size) ?? new Uint8Array(inflateSync(data.subarray(pos)));
  if (body.length !== size) throw new Error("pack entry has the wrong size");
  return { type, body };
}

/** The bytes of a zlib stream made only of stored blocks, as this trunk
 *  writes them, without inflating; null for any other stream. */
function unstored(data: Uint8Array, pos: number, size: number): Uint8Array | null {
  if (data[pos] !== 0x78) return null;
  const body = new Uint8Array(size);
  let at = pos + 2;
  let got = 0;
  for (;;) {
    const head = data[at];
    // Compressed blocks: inflate the whole stream instead.
    if (head === undefined || (head & 0x06) !== 0) return null;
    const len = data[at + 1] | (data[at + 2] << 8);
    if (got + len > size || at + 5 + len > data.length) return null;
    body.set(data.subarray(at + 5, at + 5 + len), got);
    got += len;
    at += 5 + len;
    if (head & 1) break;
  }
  return got === size ? body : null;
}

/** Where a trunk's pack and its index live in R2, beside its loose objects. */
export const packKey = (trunk: string, name: string, ext: "pack" | "idx") => `objects/${trunk}/pack/pack-${name}.${ext}`;

/** Type and inflated size, 4 bits then 7 bits at a time, low bits first. */
function objectHeader(type: number, size: number): Uint8Array {
  const bytes = [(type << 4) | (size & 0x0f)];
  for (let rest = Math.floor(size / 16); rest > 0; rest = Math.floor(rest / 128)) {
    bytes[bytes.length - 1] |= 0x80;
    bytes.push(rest & 0x7f);
  }
  return Uint8Array.from(bytes);
}

/** The most bytes one stored block holds. */
const STORED = 65535;

/** Adler-32, the checksum that ends a zlib stream. */
function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; ) {
    // 5552 bytes is the most that can be summed before the sums overflow.
    const end = Math.min(i + 5552, data.length);
    for (; i < end; i++) {
      a += data[i];
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
