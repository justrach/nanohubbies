import { decode, decompress, objectKey, type ObjectType } from "./git";
import { PackIndex, packKey, readEntry } from "./packfile";

/** A pack the sequencer lists: its name and its size in bytes. */
export interface PackInfo {
  name: string;
  bytes: number;
}

export interface StoredObject {
  type: ObjectType;
  body: Uint8Array;
}

/** A pack this small is fetched whole on first use; a bigger one is read an
 *  object at a time. */
const WHOLE = 256 * 1024;
const MAX_WHOLE = 32;
/** Bytes of objects kept in memory, the oldest dropped first: many agents'
 *  readers can share one isolate's memory. */
const CACHED_BYTES = 4 * 1024 * 1024;

/** Reads a trunk's objects from R2: out of the packs the sequencer published,
 *  or loose, as trunks stored them before packs. Objects never change, so
 *  anything read stays good; only the list of packs moves on, as batches land
 *  and small packs merge into bigger ones. */
export class ObjectReader {
  private cache = new Map<string, StoredObject>();
  private cachedBytes = 0;
  /** Listed packs, newest first, with their indexes. */
  private packs: (PackInfo & { index: PackIndex })[] = [];
  private whole = new Map<string, Uint8Array>();
  /** Whether the pack list was read since `stale()`. */
  private fresh = false;

  constructor(
    private bucket: R2Bucket,
    private trunk: string,
    private list: () => Promise<PackInfo[]>,
  ) {}

  /** The next object not found asks for the pack list again. A reader that
   *  moves on to a newer version calls this first. */
  stale() {
    this.fresh = false;
  }

  /** An object already in memory: read before, or handed over with `hold`. */
  held(sha: string): StoredObject | undefined {
    return this.cache.get(sha);
  }

  /** Keeps objects given in loose form as if they had been read. */
  hold(objects: { sha: string; raw: Uint8Array }[]) {
    for (const o of objects) this.keep(o.sha, decode(o.raw));
  }

  async get(sha: string): Promise<StoredObject | null> {
    const hit = this.cache.get(sha);
    if (hit) return hit;
    for (let i = 0; i < 3; i++) {
      for (const pack of this.packs) {
        const at = pack.index.find(sha);
        if (!at) continue;
        const entry = await this.entry(pack, at);
        if (entry) return this.keep(sha, readEntry(entry));
        // Merged into a bigger pack and deleted since it was listed.
        this.fresh = false;
        break;
      }
      if (this.fresh) break;
      await this.refresh();
    }
    const loose = await this.bucket.get(objectKey(this.trunk, sha));
    return loose ? this.keep(sha, decode(decompress(new Uint8Array(await loose.arrayBuffer())))) : null;
  }

  /** Refresh once before a request fans out concurrent cold reads. The caller
   * owns the promise: platform I/O must not be shared across HTTP requests. */
  async prepare() {
    await this.refresh();
  }

  private async refresh() {
    const listed = await this.list();
    const have = new Map(this.packs.map((p) => [p.name, p]));
    const loaded = await Promise.all(
      listed.map(async (p) => {
        const known = have.get(p.name);
        if (known) return known;
        const idx = await this.bucket.get(packKey(this.trunk, p.name, "idx"));
        return idx ? { ...p, index: new PackIndex(new Uint8Array(await idx.arrayBuffer()), p.bytes) } : null;
      }),
    );
    this.packs = loaded.filter((p) => p !== null);
    for (const name of this.whole.keys()) if (!this.packs.some((p) => p.name === name)) this.whole.delete(name);
    this.fresh = true;
  }

  /** An entry's bytes, or null when the pack is gone. */
  private async entry(pack: PackInfo, at: { offset: number; end: number }): Promise<Uint8Array | null> {
    if (pack.bytes > WHOLE) {
      const got = await this.bucket.get(packKey(this.trunk, pack.name, "pack"), { range: { offset: at.offset, length: at.end - at.offset } });
      return got ? new Uint8Array(await got.arrayBuffer()) : null;
    }
    let bytes = this.whole.get(pack.name);
    if (!bytes) {
      const got = await this.bucket.get(packKey(this.trunk, pack.name, "pack"));
      if (!got) return null;
      bytes = new Uint8Array(await got.arrayBuffer());
      if (this.whole.size >= MAX_WHOLE) this.whole.delete(this.whole.keys().next().value!);
      this.whole.set(pack.name, bytes);
    }
    return bytes.subarray(at.offset, at.end);
  }

  private keep(sha: string, obj: StoredObject): StoredObject {
    if (this.cache.has(sha)) return obj;
    this.cache.set(sha, obj);
    this.cachedBytes += obj.body.length;
    for (const [old, kept] of this.cache) {
      if (this.cachedBytes <= CACHED_BYTES) break;
      this.cache.delete(old);
      this.cachedBytes -= kept.body.length;
    }
    return obj;
  }
}
