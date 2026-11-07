import type { Head } from "../types";
import { versionAt } from "./store";

/** Validated stable: a protected ref that follows main, but only to published
 *  versions whose exact commit passed the workspace's check in an isolated
 *  runner. Landing is unchanged; this runs beside it. The sequencer stays the
 *  only writer, and the only way `stable` moves is `report` with a passing
 *  result for a claim this object issued, for a version it published, under
 *  the command that is configured now. See docs/validated-stable.md. */

export const STABLE = "stable";
/** How long a runner has to report before its claim can be issued again. */
export const CLAIM_MS = 15 * 60 * 1000;
const MAX_COMMAND = 2000;
const MAX_LOG = 8000;

export interface ValidationConfig { command: string; updatedAt: number }
export interface Claim { id: string; version: number; commit: string; tree: string; command: string; runner: string; issuedAt: number; expiresAt: number }
export interface ValidationResult { claim: string; version: number; commit: string; passed: boolean; exitCode: number | null; log: string; runner: string; command: string; at: number; advanced: boolean }
export interface ValidationStatus { config: ValidationConfig | null; stable: Head | null; claims: Claim[]; results: ValidationResult[] }
export interface Report { claim: string; version: number; commit: string; tree: string; passed: boolean; exitCode?: number | null; log?: string }

export class ValidationError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export function validationCommand(value: unknown): string {
  if (typeof value !== "string") throw new ValidationError("command must be a string", 400);
  const command = value.trim();
  if (!command || command.length > MAX_COMMAND || /[\0]/.test(command)) throw new ValidationError(`command must be 1-${MAX_COMMAND} characters`, 400);
  return command;
}

export class Validation {
  constructor(private sql: SqlStorage) {
    sql.exec(`CREATE TABLE IF NOT EXISTS validation_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS validation_claims (id TEXT PRIMARY KEY, version INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS validation_results (claim TEXT PRIMARY KEY, version INTEGER NOT NULL, data TEXT NOT NULL);`);
  }

  private get<T>(k: string): T | null {
    const row = this.sql.exec<{ v: string }>("SELECT v FROM validation_meta WHERE k = ?", k).toArray()[0];
    return row ? JSON.parse(row.v) as T : null;
  }
  private set(k: string, v: unknown) {
    this.sql.exec("INSERT INTO validation_meta VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", k, JSON.stringify(v));
  }

  stable(): Head | null { return this.get<Head>("stable"); }
  config(): ValidationConfig | null { return this.get<ValidationConfig>("config"); }

  configure(command: string | null, now = Date.now()): ValidationConfig | null {
    if (command === null) { this.sql.exec("DELETE FROM validation_meta WHERE k = 'config'"); return null; }
    const config = { command: validationCommand(command), updatedAt: now };
    this.set("config", config);
    return config;
  }

  status(limit = 20): ValidationStatus {
    return {
      config: this.config(),
      stable: this.stable(),
      claims: this.sql.exec<{ data: string }>("SELECT data FROM validation_claims ORDER BY version DESC LIMIT ?", limit).toArray().map((r) => JSON.parse(r.data)),
      results: this.sql.exec<{ data: string }>("SELECT data FROM validation_results ORDER BY version DESC, rowid DESC LIMIT ?", limit).toArray().map((r) => JSON.parse(r.data)),
    };
  }

  /** The newest published version still to check, claimed for one runner.
   *  Older unchecked versions are skipped: stable only needs the newest pass. */
  claim(published: Head, runner: string, now = Date.now()): Claim | null {
    const config = this.config();
    if (!config) return null;
    const stable = this.stable();
    if (stable && stable.version >= published.version) return null;
    const settled = this.sql.exec<{ data: string }>("SELECT data FROM validation_results WHERE version = ?", published.version).toArray()
      .some((r) => (JSON.parse(r.data) as ValidationResult).command === config.command);
    if (settled) return null;
    const open = this.sql.exec<{ data: string }>("SELECT data FROM validation_claims WHERE version = ?", published.version).toArray()
      .map((r) => JSON.parse(r.data) as Claim)
      .filter((c) => c.expiresAt > now && c.command === config.command && !this.resultFor(c.id));
    if (open.length) return null;
    const claim: Claim = { id: crypto.randomUUID(), version: published.version, commit: published.commit, tree: published.tree, command: config.command, runner: runner.slice(0, 80), issuedAt: now, expiresAt: now + CLAIM_MS };
    this.sql.exec("INSERT INTO validation_claims VALUES (?, ?, ?)", claim.id, claim.version, JSON.stringify(claim));
    // Keep the table bounded: settled or expired claims older than the newest 200.
    this.sql.exec("DELETE FROM validation_claims WHERE id NOT IN (SELECT id FROM validation_claims ORDER BY version DESC LIMIT 200)");
    return claim;
  }

  private resultFor(claim: string): ValidationResult | null {
    const row = this.sql.exec<{ data: string }>("SELECT data FROM validation_results WHERE claim = ?", claim).toArray()[0];
    return row ? JSON.parse(row.data) : null;
  }

  /** Records one runner's verdict. Retrying the same verdict returns the same
   *  result; a different verdict for a settled claim is refused. Stable only
   *  moves forward, and only for a pass on the exact published commit under
   *  the command configured now. */
  report(r: Report, published: Head, now = Date.now()): { result: ValidationResult; stable: Head | null; replayed: boolean } {
    if (typeof r.claim !== "string" || typeof r.passed !== "boolean" || !Number.isInteger(r.version)) throw new ValidationError("claim, version and passed are required", 400);
    const row = this.sql.exec<{ data: string }>("SELECT data FROM validation_claims WHERE id = ?", r.claim).toArray()[0];
    if (!row) throw new ValidationError("unknown claim", 404);
    const claim = JSON.parse(row.data) as Claim;
    if (claim.version !== r.version || claim.commit !== r.commit || claim.tree !== r.tree) throw new ValidationError("the report does not name the claimed commit", 409);
    const exitCode = r.exitCode === undefined || r.exitCode === null ? null : Number(r.exitCode);
    const prior = this.resultFor(claim.id);
    if (prior) {
      if (prior.passed !== r.passed || prior.exitCode !== exitCode) throw new ValidationError("this claim already has a different result", 409);
      return { result: prior, stable: this.stable(), replayed: true };
    }
    if (claim.expiresAt <= now) {
      const newer = this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM validation_claims WHERE version = ? AND id != ?", claim.version, claim.id).one().n;
      if (newer) throw new ValidationError("this claim expired and was issued again", 409);
    }
    const head = versionAt(this.sql, claim.version);
    if (!head || head.commit !== claim.commit || head.tree !== claim.tree || claim.version > published.version) throw new ValidationError("the claimed version is not a published version of this trunk", 409);
    const config = this.config();
    const current = !!config && config.command === claim.command;
    const stable = this.stable();
    const advanced = r.passed && current && (!stable || claim.version > stable.version);
    const result: ValidationResult = { claim: claim.id, version: claim.version, commit: claim.commit, passed: r.passed, exitCode, log: String(r.log ?? "").slice(-MAX_LOG), runner: claim.runner, command: claim.command, at: now, advanced };
    this.sql.exec("INSERT INTO validation_results VALUES (?, ?, ?)", claim.id, claim.version, JSON.stringify(result));
    this.sql.exec("DELETE FROM validation_results WHERE claim NOT IN (SELECT claim FROM validation_results ORDER BY version DESC LIMIT 200)");
    if (advanced) this.set("stable", head);
    return { result, stable: this.stable(), replayed: false };
  }

  forget() { this.sql.exec("DELETE FROM validation_meta; DELETE FROM validation_claims; DELETE FROM validation_results;"); }
}
