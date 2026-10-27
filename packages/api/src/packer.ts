import { DurableObject } from "cloudflare:workers";
import type { PackInfo } from "./objects";
import { migratePacks, PackStore, type PackRow, type Raw } from "./packer/store";
import { forget } from "./sequencer/store";
import { decode, type GitObject } from "./git";
import { buildPack, compressedPackEntry, packKey } from "./packfile";

/** One per trunk, beside its sequencer: writes the objects the sequencer lands
 *  to R2 as packs, merges them, deletes merged-away ones after a while, and
 *  lists them for readers and clones. Compressing, hashing and uploading all
 *  happen here, so the sequencer, the one part that cannot run in parallel,
 *  only lands changes. */
export class Packer extends DurableObject<Env> {
  private sql: SqlStorage;
  private store: PackStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    migratePacks(this.sql);
    this.store = new PackStore(this.sql, env.OBJECTS, (at) => void this.wake(at));
  }

  /** A batch of landed objects, written as one pack. Returns once it is in R2. */
  async publish(trunk: string, rows: Raw[], through: number): Promise<void> {
    await this.store.write(trunk, rows, through);
  }

  /** Durable Git objects without advancing the swarm publication watermark. */
  async publishGit(trunk: string, objects: GitObject[]) {
    if (!objects.length) return;
    const built = buildPack(objects.map(o => {
      const { type, body } = decode(o.raw);
      return compressedPackEntry(o.sha, type, body);
    }));
    await Promise.all([
      this.env.OBJECTS.put(packKey(trunk, built.name, "pack"), built.pack),
      this.env.OBJECTS.put(packKey(trunk, built.name, "idx"), built.idx),
    ]);
    this.store.adopt(trunk, [{ name: built.name, level: 0, first: 0, last: 0, objects: objects.length, bytes: built.pack.length, dropped: null }], 0);
    // Keep migration batches without duplicating a large repository during
    // background compaction. The regular swarm writer compacts its own packs.
  }

  list(): { packs: PackInfo[]; through: number } {
    return this.store.list();
  }


  adopt(trunk: string, rows: PackRow[], through: number) {
    this.store.adopt(trunk, rows, through);
  }

  /** Deletes packs merged away long enough ago. */
  async alarm() {
    const next = await this.store.sweep();
    if (next !== null) await this.wake(next);
  }

  /** Forgets the trunk's packs; the sequencer deletes their files with the
   *  rest of the trunk's objects in R2. */
  async destroy() {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    forget(this.sql);
    this.store.forget();
    migratePacks(this.sql);
  }

  /** Sets the alarm for `at`, unless it is already set for sooner. */
  private async wake(at: number) {
    const set = await this.ctx.storage.getAlarm();
    if (set === null || set <= Date.now() || at < set) await this.ctx.storage.setAlarm(at);
  }
}
