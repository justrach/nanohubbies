import type { Packer } from "../packer";
import type { PackRow } from "../packer/store";
import type { Head } from "../types";
import type { Backlog } from "./backlog";
import { getMeta, lastVersion, setMeta, versionAt } from "./store";

/** How landed objects leave the sequencer: in batches, in landing order, to
 *  the trunk's packer, which writes each batch to R2 as one pack. The
 *  published head moves past every version whose objects are all there.
 *  Packing happens in the packer, so the sequencer stays free to land. Every
 *  bound here comes from the tables, never from the tip in memory, which runs
 *  ahead of them while a batch of landings is still being decided. */

/** The most objects, and about the most bytes, one batch takes. */
const BATCH = 4000;
const BATCH_BYTES = 4 * 1024 * 1024;
/** Batches out to the packer at once: R2 takes uploads fastest a few at a time. */
const IN_FLIGHT = 4;

export class Publisher {
  /** The published version as this object last set it. */
  private shown = 0;
  private adopted = false;
  /** Set while the trunk is being deleted: no new batches go out. */
  private stopped = false;

  constructor(
    private sql: SqlStorage,
    /** Told what leaves the pending table (./backlog). */
    private backlog: Backlog,
    private packer: () => DurableObjectStub<Packer>,
    /** Called each time the published head moves on. */
    private moved: () => void,
  ) {}

  /** Hands pending objects to the packer until none are left. Up to
   *  IN_FLIGHT batches are out at once, so one batch's upload does not wait
   *  for the last; they are confirmed, and the published head moves, in
   *  order. They go through one stub, the only way calls arrive in the order
   *  they were made. A failed batch stops the drain; the next drain, with a
   *  new stub, sends it again. */
  async drain(trunk: string) {
    const packer = this.packer();
    if (!this.adopted) await this.adopt(trunk, packer);
    const out: { last: number; done: Promise<void>; bytes: number }[] = [];
    let sent = 0;
    for (;;) {
      while (!this.stopped && out.length < IN_FLIGHT) {
        const rows = this.take(sent);
        if (!rows.length) break;
        const last = rows[rows.length - 1];
        // Once this batch and those before it are in, every version before
        // the oldest one still waiting is complete; the packer records that.
        const after = this.sql.exec<{ v: number | null }>("SELECT MIN(version) AS v FROM pending WHERE seq > ?", last.seq).one().v;
        const through = after === null ? lastVersion(this.sql) : after - 1;
        const done = packer.publish(
          trunk,
          rows.map((r) => ({ version: r.version, sha: r.sha, raw: r.raw })),
          through,
        );
        // Its failure is handled when its turn comes.
        done.catch(() => {});
        sent = last.seq;
        out.push({ last: last.seq, done, bytes: rows.reduce((n, r) => n + r.raw.byteLength, 0) });
      }
      const next = out.shift();
      if (!next) return this.advance();
      try {
        await next.done;
      } catch (e) {
        await Promise.allSettled(out.map((o) => o.done));
        throw e;
      }
      this.sql.exec("DELETE FROM pending WHERE seq <= ?", next.last);
      this.backlog.removed(next.bytes);
      this.advance();
    }
  }

  /** The next batch of pending objects after `seq`, in landing order. */
  private take(seq: number) {
    const rows: { seq: number; version: number; sha: string; raw: ArrayBuffer }[] = [];
    let bytes = 0;
    for (const row of this.sql.exec<(typeof rows)[number]>("SELECT seq, version, sha, raw FROM pending WHERE seq > ? ORDER BY seq LIMIT ?", seq, BATCH)) {
      rows.push(row);
      if ((bytes += row.raw.byteLength) >= BATCH_BYTES) break;
    }
    return rows;
  }

  /** Moves the published head past every version whose objects are all in. */
  private advance() {
    const waiting = this.sql.exec<{ v: number | null }>("SELECT MIN(version) AS v FROM pending").one().v;
    const done = versionAt(this.sql, waiting === null ? lastVersion(this.sql) : waiting - 1);
    if (done && done.version > this.shown) {
      setMeta(this.sql, "published", done);
      this.shown = done.version;
      this.moved();
    }
  }

  /** Sends no more batches; those out already finish. */
  stop() {
    this.stopped = true;
  }

  /** Forgets what it kept in memory, for a deleted trunk. */
  forget() {
    this.shown = 0;
    this.adopted = false;
    this.stopped = false;
  }

  /** Packs this sequencer recorded itself, before trunks had a packer: handed
   *  over once, so readers find them where they find the rest. */
  private async adopt(trunk: string, packer: DurableObjectStub<Packer>) {
    const rows = this.sql.exec<PackRow>("SELECT name, level, first, last, objects, bytes, dropped FROM packs").toArray();
    if (rows.length) {
      await packer.adopt(trunk, rows, getMeta<Head>(this.sql, "published")?.version ?? 0);
      this.sql.exec("DELETE FROM packs");
    }
    this.adopted = true;
  }
}
