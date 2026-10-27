import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { encode, toHex, type ObjectType } from "./git";

/** Reading a version 2 or 3 packfile, as `git push` sends one. The client is
 *  told `no-thin`, so every delta's base is in the pack and everything
 *  resolves from the pack alone. */

export interface Unpacked {
  type: ObjectType;
  body: Uint8Array;
}

const TYPES: Record<number, ObjectType> = { 1: "commit", 2: "tree", 3: "blob", 4: "tag" };
const OFS_DELTA = 6;
const REF_DELTA = 7;

/** Every object in the pack, by sha. */
export function unpack(data: Uint8Array, limits = { objectBytes: 16 << 20, totalBytes: 48 << 20, objects: 100_000 }): Map<string, Unpacked> {
  if (data.length < 32 || String.fromCharCode(...data.subarray(0, 4)) !== "PACK") throw new Error("not a packfile");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const version = view.getUint32(4);
  if (version !== 2 && version !== 3) throw new Error(`packfile version ${version} is not supported`);
  const count = view.getUint32(8);
  if (count > limits.objects) throw new Error("Too many objects in pack");
  if (createHash("sha1").update(data.subarray(0, -20)).digest("hex") !== toHex(data.subarray(-20))) throw new Error("Pack checksum mismatch");
  let expanded = 0;
  const account = (size: number) => {
    expanded += size;
    if (size > limits.objectBytes || expanded > limits.totalBytes) throw new Error("Expanded pack exceeds configured limits");
  };

  const byOffset = new Map<number, Unpacked>();
  const bySha = new Map<string, Unpacked>();
  const deltas: { offset: number; base: number | string; delta: Uint8Array }[] = [];
  const keep = (offset: number, obj: Unpacked) => {
    account(obj.body.length);
    byOffset.set(offset, obj);
    bySha.set(encode(obj.type, obj.body).sha, obj);
  };

  let pos = 12;
  for (let i = 0; i < count; i++) {
    const start = pos;
    if (pos >= data.length - 20) throw new Error("Truncated pack");
    // Type in bits 4-6 of the first byte; size 4 bits then 7 at a time.
    let byte = data[pos++];
    const type = (byte >> 4) & 7;
    let size = byte & 0x0f;
    for (let shift = 4; byte & 0x80; shift += 7) {
      if (shift > 28 || pos >= data.length - 20) throw new Error("Invalid object size");
      byte = data[pos++];
      size += (byte & 0x7f) * 2 ** shift;
    }
    let base: number | string | null = null;
    if (type === OFS_DELTA) {
      byte = data[pos++];
      let back = byte & 0x7f;
      while (byte & 0x80) {
        if (pos >= data.length - 20 || back > data.length) throw new Error("Invalid delta offset");
        byte = data[pos++];
        back = (back + 1) * 128 + (byte & 0x7f);
      }
      base = start - back;
    } else if (type === REF_DELTA) {
      base = toHex(data, pos, pos + 20);
      pos += 20;
    }
    if (size > limits.objectBytes) throw new Error("Object exceeds configured limit");
    // zlib says how much of the input the object used, which is where the next one starts.
    const { buffer, engine } = inflateSync(data.subarray(pos), { info: true, maxOutputLength: limits.objectBytes }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
    pos += engine.bytesWritten;
    if (pos > data.length - 20) throw new Error("Truncated compressed object");
    const body = new Uint8Array(buffer);
    if (body.length !== size) throw new Error("packfile object has the wrong size");
    if (base !== null) { account(body.length); deltas.push({ offset: start, base, delta: body }); }
    else if (TYPES[type]) keep(start, { type: TYPES[type], body });
    else throw new Error(`packfile object type ${type} is not supported`);
  }

  if (pos !== data.length - 20) throw new Error("Unexpected bytes after pack objects");
  // A delta's base can itself be a delta: resolve in rounds until none are left.
  for (let left = deltas; left.length; ) {
    const next = left.filter((d) => {
      const base = typeof d.base === "number" ? byOffset.get(d.base) : bySha.get(d.base);
      if (!base) return true;
      keep(d.offset, { type: base.type, body: applyDelta(base.body, d.delta, limits.objectBytes) });
      return false;
    });
    if (next.length === left.length) throw new Error("packfile has deltas against objects it does not carry; push without a thin pack");
    left = next;
  }
  return bySha;
}

/** Git's delta format: the base and result sizes, then instructions that
 *  either copy a span of the base or insert literal bytes. */
function applyDelta(base: Uint8Array, delta: Uint8Array, max: number): Uint8Array {
  let pos = 0;
  const varint = () => {
    let n = 0;
    for (let shift = 0, byte = 0x80; byte & 0x80; shift += 7) {
      if (pos >= delta.length || shift > 28) throw new Error("Invalid delta size");
      byte = delta[pos++];
      n += (byte & 0x7f) * 2 ** shift;
    }
    return n;
  };
  if (varint() !== base.length) throw new Error("delta does not match its base");
  const size = varint();
  if (size > max) throw new Error("Delta exceeds object limit");
  const out = new Uint8Array(size);
  let at = 0;
  while (pos < delta.length) {
    const op = delta[pos++];
    if (op & 0x80) {
      let offset = 0;
      let length = 0;
      for (let i = 0; i < 4; i++) if (op & (1 << i)) offset += delta[pos++] * 2 ** (8 * i);
      for (let i = 0; i < 3; i++) if (op & (1 << (4 + i))) length += delta[pos++] * 2 ** (8 * i);
      if (length === 0) length = 0x10000;
      if (pos > delta.length || offset + length > base.length || at + length > out.length) throw new Error("Invalid delta copy");
      out.set(base.subarray(offset, offset + length), at);
      at += length;
    } else if (op) {
      if (pos + op > delta.length || at + op > out.length) throw new Error("Invalid delta insert");
      out.set(delta.subarray(pos, pos + op), at);
      at += op;
      pos += op;
    } else {
      throw new Error("delta has an empty instruction");
    }
  }
  if (at !== out.length) throw new Error("delta produced the wrong size");
  return out;
}
