/** Trusted operator policy, never taken from a workflow or runner request. */
export interface ActionsLimits { total: number; perAccount: number }
export function actionsLimits(env: Env): ActionsLimits {
  const vars = env as Env & Record<string, string | undefined>;
  const read = (key: string, fallback: number) => {
    if (vars[key] === undefined) return fallback;
    const value = Number(vars[key]);
    if (!Number.isSafeInteger(value) || value < 1 || value > 10000) throw Error("Invalid Actions capacity policy");
    return value;
  };
  return { total: read("ACTIONS_MAX_SANDBOXES", 64), perAccount: read("ACTIONS_MAX_SANDBOXES_PER_ACCOUNT", 16) };
}
export type SandboxReservation = {
  id: string; trunk: string; account: string; runId: string; attempt: number; job: string;
  state: "reserved" | "allocated" | "released"; sandboxId: string | null;
  createdAt: number; releasedAt: number | null;
};
export interface ReserveSandbox { id: string; runId: string; attempt: number; job: string }
export const reservationId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
export const sandboxId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,160}$/.test(value);
export function validReservation(input: ReserveSandbox): boolean {
  return !!input && reservationId(input.id) && reservationId(input.runId) && Number.isSafeInteger(input.attempt) && input.attempt > 0
    && typeof input.job === "string" && /^[\w.-]{1,50}\/[A-Za-z_][\w-]{0,47}$/.test(input.job);
}

/** Called inside the Hub's synchronous transaction. Outstanding reservations
 * never expire: a dead controller or expired CI lease does not prove a VM died.
 * Released tombstones reject delayed allocation/replay of the same job. */
export class ActionsCapacity {
  constructor(private sql: SqlStorage) {
    sql.exec(`CREATE TABLE IF NOT EXISTS actions_capacity (
      id TEXT PRIMARY KEY, trunk TEXT NOT NULL, account TEXT NOT NULL, run_id TEXT NOT NULL,
      attempt INTEGER NOT NULL, job TEXT NOT NULL, state TEXT NOT NULL,
      sandbox_id TEXT, created_at INTEGER NOT NULL, released_at INTEGER,
      UNIQUE(trunk,run_id,attempt,job)
    )`);
    sql.exec("CREATE INDEX IF NOT EXISTS actions_capacity_active ON actions_capacity(state,account)");
  }
  private row(id: string): SandboxReservation | null {
    return this.sql.exec<SandboxReservation>(`SELECT id,trunk,account,run_id AS runId,attempt,job,state,
      sandbox_id AS sandboxId,created_at AS createdAt,released_at AS releasedAt FROM actions_capacity WHERE id=?`, id).toArray()[0] ?? null;
  }
  inspect(trunk: string, id: string) {
    const row = this.row(id);
    if (!row || row.trunk !== trunk) throw Error("Sandbox reservation not found");
    return row;
  }
  reserve(trunk: string, account: string, input: ReserveSandbox, limits: ActionsLimits, now = Date.now()) {
    if (!validReservation(input) || !account) throw Error("Invalid sandbox reservation");
    const prior = this.row(input.id);
    if (prior) {
      if (prior.trunk !== trunk || prior.runId !== input.runId || prior.attempt !== input.attempt || prior.job !== input.job) throw Error("Conflicting sandbox reservation");
      return { admitted: true as const, reservation: prior };
    }
    if (this.sql.exec("SELECT 1 FROM actions_capacity WHERE trunk=? AND run_id=? AND attempt=? AND job=?", trunk, input.runId, input.attempt, input.job).toArray().length) throw Error("This job already has a sandbox reservation; reconcile it before restarting");
    const counts = this.usage(account);
    if (counts.total >= limits.total || counts.account >= limits.perAccount) return { admitted: false as const, retryAfter: 30 };
    this.sql.exec("INSERT INTO actions_capacity VALUES (?,?,?,?,?,?,'reserved',NULL,?,NULL)", input.id, trunk, account, input.runId, input.attempt, input.job, now);
    return { admitted: true as const, reservation: this.inspect(trunk, input.id) };
  }
  attach(trunk: string, id: string, sandbox: string) {
    if (!sandboxId(sandbox)) throw Error("Invalid sandbox ID");
    const row = this.inspect(trunk, id);
    if (row.state === "released" || row.sandboxId && row.sandboxId !== sandbox) throw Error("Conflicting or released sandbox reservation");
    this.sql.exec("UPDATE actions_capacity SET state='allocated',sandbox_id=? WHERE id=?", sandbox, id);
    return this.inspect(trunk, id);
  }
  release(trunk: string, id: string, evidence: { reason: "not-created" | "destroyed"; sandboxId?: string }, now = Date.now()) {
    const row = this.inspect(trunk, id);
    if (evidence.reason === "destroyed" ? !sandboxId(evidence.sandboxId) || !!row.sandboxId && row.sandboxId !== evidence.sandboxId : evidence.reason !== "not-created" || row.sandboxId !== null || evidence.sandboxId !== undefined) throw Error("Sandbox cleanup evidence does not match the reservation");
    // Destruction can succeed even if the earlier attach acknowledgement was
    // lost. Record its exact ID on release, including in the replay tombstone.
    if (row.state === "released") {
      if (row.sandboxId !== (evidence.sandboxId ?? null)) throw Error("Conflicting sandbox cleanup retry");
      return row;
    }
    this.sql.exec("UPDATE actions_capacity SET state='released',sandbox_id=?,released_at=? WHERE id=?", evidence.sandboxId ?? null, now, id);
    return this.inspect(trunk, id);
  }
  usage(account: string) {
    const rows = this.sql.exec<{ total: number; account: number }>("SELECT count(*) AS total,COALESCE(sum(account=?),0) AS account FROM actions_capacity WHERE state<>'released'", account).toArray()[0];
    return rows;
  }
}
