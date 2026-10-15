import { decode } from "../git";
import type { PackInfo } from "../objects";
import { buildPack, PackIndex, packEntry, packKey, type PackEntry } from "../packfile";
import { getMeta, setMeta } from "../sequencer/store";

/** A trunk's packs in R2. Each batch the sequencer sends becomes one pack, so
 *  a busy trunk writes two objects per batch instead of several per landing,
 *  and a clone fetches a few packs instead of every object one by one. Eight
 *  packs of one level merge into one a level up, so even a long history is a
 *  few dozen packs. Batches go first: a batch holds back the published head,
 *  a merge only tidies, and both draw on the same upload bandwidth. */

/** Packs of one level merged at once. */
const FANIN = 8;
/** No merged pack is bigger: a merge holds its sources and its result in
 *  memory, well inside a Durable Object's. Bigger packs move up as they are. */
const MAX_MERGE = 16 * 1024 * 1024;
/** How long a merged-away pack stays in R2, for clones that listed it. */
const GRACE = 15 * 60_000;
/** Bytes of batch packs whose entries are kept in memory, so merging them
 *  reads nothing back. */
const RECENT_BYTES = 32 * 1024 * 1024;
/** Batch packs left unmerged before merges go on even while batches wait. */
const BACKLOG = 64;

// meta   the trunk, and `through`: every version up to it is in listed packs
// packs  level 0 for a batch, one more per merge; a merged-away pack is
//        dropped, and deleted a while later
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS packs (
    name TEXT PRIMARY KEY, level INTEGER NOT NULL, first INTEGER NOT NULL, last INTEGER NOT NULL,
    objects INTEGER NOT NULL, bytes INTEGER NOT NULL, dropped INTEGER
  )
`;

export function migratePacks(sql: SqlStorage) {
  for (const stmt of SCHEMA.split(";")) if (stmt.trim()) sql.exec(stmt);
}

/** One object the sequencer landed, in loose form, and its version. */
export interface Raw {
  version: number;
  sha: string;
  raw: ArrayBuffer;
}

export type PackRow = {
  name: string;
  level: number;
  first: number;
  last: number;
  objects: number;
  bytes: number;
  dropped: number | null;
};

export class PackStore {
  private merging: Promise<void> | null = null;
  private recent = new Map<string, { entries: PackEntry[]; bytes: number }>();
  private recentBytes = 0;
  /** Batches between arriving and being recorded. */
  private writing = 0;
  /** Batches are recorded one after another, in the order they came. */
  private order: Promise<void> = Promise.resolve();
  /** The first version of a batch that failed to upload, until it is sent again. */
  private gap: number | null = null;

  constructor(
    private sql: SqlStorage,
    private bucket: R2Bucket,
    /** Asks for `sweep` to run at a time: a merged-away pack is due then. */
    private sweepAt: (at: number) => void,
  ) {}

  /** Writes a batch as one pack, then records that every version up to
   *  `through` is in listed packs. Several batches can be uploading at once;
   *  they are recorded in the order they came, so the pack list never claims
   *  a version an earlier batch still holds back. Merges wait for them. */
  write(trunk: string, rows: Raw[], through: number): Promise<void> {
    setMeta(this.sql, "trunk", trunk);
    const entries = rows.map((r) => {
      const { type, body } = decode(new Uint8Array(r.raw));
      return packEntry(r.sha, type, body);
    });
    const first = rows[0].version;
    const uploaded = this.put(trunk, entries);
    // Its failure is handled when its turn comes.
    uploaded.catch(() => {});
    this.writing++;
    const recorded = this.order.then(async () => {
      let built;
      try {
        built = await uploaded;
      } catch (e) {
        // Until the sequencer sends this batch again, later ones may not
        // claim the versions it holds.
        this.gap = Math.min(this.gap ?? first, first);
        throw e;
      }
      this.add(built, 0, first, rows[rows.length - 1].version, entries.length);
      this.keep(built.name, entries, built.pack.length);
      if (this.gap !== null && first <= this.gap) this.gap = null;
      if (this.gap === null && through > (getMeta<number>(this.sql, "through") ?? 0)) setMeta(this.sql, "through", through);
    });
    // A failed batch fails its own caller, not the batches after it.
    this.order = recorded
      .catch(() => {})
      .finally(() => {
        this.writing--;
        void this.compact(trunk);
      });
    return recorded;
  }

  /** The packs a reader or a clone needs, newest first, and the version up to
   *  which they hold every object. */
  list(): { packs: PackInfo[]; through: number } {
    const packs = this.sql.exec<{ name: string; bytes: number }>("SELECT name, bytes FROM packs WHERE dropped IS NULL ORDER BY last DESC, level").toArray();
    return { packs, through: getMeta<number>(this.sql, "through") ?? 0 };
  }

  /** Packs a sequencer recorded before packs had an object of their own. */
  adopt(trunk: string, rows: PackRow[], through: number) {
    setMeta(this.sql, "trunk", trunk);
    for (const p of rows) {
      this.sql.exec(
        "INSERT OR IGNORE INTO packs (name, level, first, last, objects, bytes, dropped) VALUES (?, ?, ?, ?, ?, ?, ?)",
        p.name,
        p.level,
        p.first,
        p.last,
        p.objects,
        p.bytes,
        p.dropped,
      );
    }
    if (through > (getMeta<number>(this.sql, "through") ?? 0)) setMeta(this.sql, "through", through);
    if (rows.some((p) => p.dropped !== null)) this.sweepAt(Date.now() + GRACE);
  }

  /** Merges full levels, one merge at a time. */
  compact(trunk: string): Promise<void> {
    this.merging ??= this.mergeFull(trunk)
      .catch((e) => console.error(`merging packs failed: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => {
        this.merging = null;
      });
    return this.merging;
  }

  /** Deletes packs merged away long enough ago. Returns when the next one is
   *  due, or null when none is waiting. */
  async sweep(): Promise<number | null> {
    const trunk = getMeta<string>(this.sql, "trunk");
    if (!trunk) return null;
    const due = this.sql.exec<{ name: string }>("SELECT name FROM packs WHERE dropped <= ? LIMIT 400", Date.now() - GRACE).toArray();
    if (due.length) {
      await this.bucket.delete(due.flatMap((p) => [packKey(trunk, p.name, "pack"), packKey(trunk, p.name, "idx")]));
      for (const p of due) this.sql.exec("DELETE FROM packs WHERE name = ?", p.name);
    }
    const next = this.sql.exec<{ t: number | null }>("SELECT MIN(dropped) AS t FROM packs").one().t;
    return next === null ? null : next + GRACE;
  }

  /** Forgets what it kept in memory, for a deleted trunk. */
  forget() {
    this.recent.clear();
    this.recentBytes = 0;
    this.gap = null;
  }

  /** A batch's entries, for merging it later, within RECENT_BYTES. */
  private keep(name: string, entries: PackEntry[], bytes: number) {
    this.recent.set(name, { entries, bytes });
    this.recentBytes += bytes;
    for (const [old, kept] of this.recent) {
      if (this.recentBytes <= RECENT_BYTES) break;
      this.drop(old, kept.bytes);
    }
  }

  private drop(name: string, bytes = this.recent.get(name)?.bytes ?? 0) {
    if (this.recent.delete(name)) this.recentBytes -= bytes;
  }

  private async mergeFull(trunk: string) {
    for (;;) {
      // Batches waiting to be written go first, until unmerged ones pile up.
      if (this.writing > 0 && this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM packs WHERE dropped IS NULL AND level = 0").one().n < BACKLOG) return;
      const full = this.sql
        .exec<{ level: number }>("SELECT level FROM packs WHERE dropped IS NULL GROUP BY level HAVING COUNT(*) >= ? ORDER BY level LIMIT 1", FANIN)
        .toArray()[0];
      if (!full) return;
      await this.merge(trunk, full.level);
    }
  }

  /** Merges the oldest packs of a level into one pack a level up. */
  private async merge(trunk: string, level: number) {
    const packs = this.sql
      .exec<PackRow>("SELECT name, level, first, last, objects, bytes, dropped FROM packs WHERE dropped IS NULL AND level = ? ORDER BY first LIMIT ?", level, FANIN)
      .toArray();
    let bytes = 0;
    const take = packs.filter((p) => (bytes += p.bytes) <= MAX_MERGE);
    if (take.length < 2) {
      this.sql.exec("UPDATE packs SET level = level + 1 WHERE name = ?", packs[0].name);
      return;
    }
    const entries: PackEntry[] = [];
    for (const p of take) entries.push(...(this.recent.get(p.name)?.entries ?? (await this.entries(trunk, p))));
    const built = await this.put(trunk, entries);
    // The trunk was deleted while this merge ran.
    if (getMeta<string>(this.sql, "trunk") !== trunk) {
      await this.bucket.delete([packKey(trunk, built.name, "pack"), packKey(trunk, built.name, "idx")]);
      return;
    }
    const now = Date.now();
    for (const p of take) {
      this.sql.exec("UPDATE packs SET dropped = ? WHERE name = ?", now, p.name);
      this.drop(p.name);
    }
    this.add(built, level + 1, take[0].first, take[take.length - 1].last, entries.length);
    this.sweepAt(now + GRACE);
  }

  /** A pack's entries, read back from R2. */
  private async entries(trunk: string, p: PackRow): Promise<PackEntry[]> {
    const [pack, idx] = await Promise.all([this.bucket.get(packKey(trunk, p.name, "pack")), this.bucket.get(packKey(trunk, p.name, "idx"))]);
    if (!pack || !idx) throw new Error(`pack ${p.name} is missing from R2`);
    return new PackIndex(new Uint8Array(await idx.arrayBuffer()), p.bytes).entries(new Uint8Array(await pack.arrayBuffer()));
  }

  private async put(trunk: string, entries: PackEntry[]) {
    const built = buildPack(entries);
    await retry(() =>
      Promise.all([this.bucket.put(packKey(trunk, built.name, "pack"), built.pack), this.bucket.put(packKey(trunk, built.name, "idx"), built.idx)]),
    );
    return built;
  }

  /** Records a pack as live. One written again is live again, never left
   *  dropped, which would have its files deleted. */
  private add(built: { name: string; pack: Uint8Array }, level: number, first: number, last: number, objects: number) {
    this.sql.exec(
      `INSERT INTO packs (name, level, first, last, objects, bytes) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (name) DO UPDATE SET dropped = NULL`,
      built.name,
      level,
      first,
      last,
      objects,
      built.pack.length,
    );
  }
}

async function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts) throw e;
      await new Promise((r) => setTimeout(r, 100 * 2 ** i));
    }
  }
}
