import type { AbuseLimits } from "../abuse";
import type { TrunkInfo } from "../hub";

export type AdmissionResult = { ok: true; ticket: string } | { ok: false; status: 409 | 429 | 503; error: string };

/** Quota checks and reservations share the Hub's SQL and transaction owner.
 *  Reserving before an import/seed prevents concurrent Workers from all seeing
 *  the same free slot. A reservation has no timer: expiring it while init is
 *  still running would allow a late initializer to evade the deployment cap.
 *  Interrupted initializations therefore fail closed, not open. */
export class Admission {
  constructor(private storage: DurableObjectStorage, private sql: SqlStorage) {
    if (!sql.exec<{ name: string }>("PRAGMA table_info(trunks)").toArray().some((c) => c.name === "admission_ip")) {
      sql.exec("ALTER TABLE trunks ADD COLUMN admission_ip TEXT");
    }
    sql.exec(`CREATE TABLE IF NOT EXISTS admissions (
      name TEXT PRIMARY KEY, ticket TEXT NOT NULL, owner TEXT, creator TEXT NOT NULL
    )`);
    sql.exec("CREATE INDEX IF NOT EXISTS trunks_owner ON trunks(owner)");
    sql.exec("CREATE INDEX IF NOT EXISTS trunks_ip ON trunks(admission_ip)");
    sql.exec("CREATE TABLE IF NOT EXISTS rates (bucket TEXT PRIMARY KEY, used INTEGER NOT NULL, expires INTEGER NOT NULL)");
  }

  reserve(name: string, owner: string | null, creator: string, limits: AbuseLimits): AdmissionResult {
    return this.storage.transactionSync(() => {
      if (this.sql.exec("SELECT 1 FROM trunks WHERE name = ? UNION ALL SELECT 1 FROM admissions WHERE name = ?", name, name).toArray().length) {
        return { ok: false, status: 409, error: "trunk already exists or is being created" };
      }
      if (this.count("SELECT count(*) AS n FROM trunks") + this.count("SELECT count(*) AS n FROM admissions") >= limits.total) {
        return { ok: false, status: 503, error: "deployment trunk capacity reached" };
      }
      if (owner && this.count("SELECT count(*) AS n FROM trunks WHERE owner = ?", owner) + this.count("SELECT count(*) AS n FROM admissions WHERE owner = ?", owner) >= limits.owner) {
        return { ok: false, status: 429, error: "your trunk quota is reached" };
      }
      if (this.count("SELECT count(*) AS n FROM trunks WHERE admission_ip = ?", creator) + this.count("SELECT count(*) AS n FROM admissions WHERE creator = ?", creator) >= limits.ip) {
        return { ok: false, status: 429, error: "this address's trunk quota is reached" };
      }
      const ticket = crypto.randomUUID();
      this.sql.exec("INSERT INTO admissions (name, ticket, owner, creator) VALUES (?, ?, ?, ?)", name, ticket, owner, creator);
      return { ok: true, ticket };
    });
  }

  complete(t: TrunkInfo, ticket: string) {
    this.storage.transactionSync(() => {
      const pending = this.sql.exec<{ creator: string; owner: string | null }>("SELECT creator, owner FROM admissions WHERE name = ? AND ticket = ?", t.name, ticket).toArray()[0];
      if (!pending || pending.owner !== t.owner) throw new Error("trunk admission no longer belongs to this request");
      this.sql.exec("INSERT INTO trunks (name, created, source, owner, admission_ip) VALUES (?, ?, ?, ?, ?)", t.name, t.created, t.source, t.owner, pending.creator);
      this.release(t.name, ticket);
    });
  }

  release(name: string, ticket: string) {
    this.sql.exec("DELETE FROM admissions WHERE name = ? AND ticket = ?", name, ticket);
  }

  /** Fixed windows start with the first request; rejected attempts do not
   *  extend them. Persisted counters survive isolate/DO restarts. */
  takeRate(bucket: "creation" | "control" | "agent", limit: number, windowMs: number): { ok: boolean; retryAfter: number } {
    return this.storage.transactionSync(() => {
      const now = Date.now();
      const row = this.sql.exec<{ used: number; expires: number }>("SELECT used, expires FROM rates WHERE bucket = ?", bucket).toArray()[0];
      if (row && row.expires > now && row.used >= limit) return { ok: false, retryAfter: Math.max(1, Math.ceil((row.expires - now) / 1000)) };
      const live = row && row.expires > now;
      this.sql.exec("INSERT OR REPLACE INTO rates (bucket, used, expires) VALUES (?, ?, ?)", bucket, live ? row.used + 1 : 1, live ? row.expires : now + windowMs);
      return { ok: true, retryAfter: 0 };
    });
  }

  private count(query: string, value?: string): number {
    return this.sql.exec<{ n: number }>(query, ...(value === undefined ? [] : [value])).one().n;
  }
}
