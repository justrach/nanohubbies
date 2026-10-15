/** How far publishing is behind, kept from the pending table, and whether the
 *  trunk decides new changes. Landing outruns publishing whenever R2 is slow,
 *  and a landed version is not clonable until its objects are out, so once
 *  either limit is passed (bytes of objects waiting, or how long the oldest
 *  landed version has waited) the trunk stops deciding new changes. It starts
 *  again only below half of both, so it does not flap. Each change is checked
 *  before it is decided, so the queue passes the byte limit by at most one
 *  change: its files, up to the change limit, and the trees on their paths.
 *  A request that already has a decision replays it whatever the backlog. */

export interface Limits {
  /** Bytes of objects waiting to be published. */
  bytes: number;
  /** How long the oldest landed version may wait to be published, in ms. */
  ageMs: number;
  /** Bytes of files one change may write. */
  changeBytes: number;
}

const DEFAULTS: Limits = { bytes: 64 * 1024 * 1024, ageMs: 30_000, changeBytes: 8 * 1024 * 1024 };

/** The limits, from PUBLISH_BACKLOG_BYTES, PUBLISH_BACKLOG_MS and
 *  CHANGE_MAX_BYTES where they are set. */
export function backlogLimits(env: object): Limits {
  const vars = env as Record<string, unknown>;
  const n = (k: string, d: number) => {
    const v = Number(vars[k]);
    return Number.isFinite(v) && v > 0 ? v : d;
  };
  return { bytes: n("PUBLISH_BACKLOG_BYTES", DEFAULTS.bytes), ageMs: n("PUBLISH_BACKLOG_MS", DEFAULTS.ageMs), changeBytes: n("CHANGE_MAX_BYTES", DEFAULTS.changeBytes) };
}

export class Backlog {
  private bytes = 0;
  /** When the oldest version still waiting landed, or null when none waits. */
  private oldest: number | null = null;
  private admitting = true;

  constructor(
    private sql: SqlStorage,
    readonly limits: Limits,
  ) {
    this.recount();
  }

  /** Reads the backlog from the table: at start, and after rows were written
   *  around the counts (a new or deleted trunk). */
  recount() {
    const row = this.sql.exec<{ bytes: number; at: number | null; n: number }>("SELECT COALESCE(SUM(length(raw)), 0) AS bytes, MIN(at) AS at, COUNT(*) AS n FROM pending").one();
    this.bytes = row.bytes;
    // Rows from before landing times were kept are counted from now.
    this.oldest = row.n ? (row.at ?? Date.now()) : null;
  }

  /** A batch's objects went in, landed at `at`. */
  added(bytes: number, at: number) {
    if (!bytes) return;
    this.bytes += bytes;
    this.oldest ??= at;
  }

  /** The packer confirmed `bytes` of objects, which left the table. */
  removed(bytes: number) {
    this.bytes = Math.max(0, this.bytes - bytes);
    const next = this.sql.exec<{ at: number | null }>("SELECT at FROM pending ORDER BY seq LIMIT 1").toArray()[0];
    this.oldest = next ? (next.at ?? this.oldest ?? Date.now()) : null;
  }

  /** Whether a change may be decided now, `held` bytes having been decided
   *  in the batch so far. */
  admits(held = 0): boolean {
    const age = this.oldest === null ? 0 : Date.now() - this.oldest;
    const bytes = this.bytes + held;
    this.admitting = this.admitting ? bytes < this.limits.bytes && age < this.limits.ageMs : bytes <= this.limits.bytes / 2 && age <= this.limits.ageMs / 2;
    return this.admitting;
  }

  snapshot() {
    return { queuedBytes: this.bytes, oldestPendingMs: this.oldest === null ? 0 : Date.now() - this.oldest, admitting: this.admits(), limits: this.limits };
  }
}
