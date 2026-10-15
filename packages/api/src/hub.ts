import { DurableObject } from "cloudflare:workers";
import type { AbuseLimits } from "./abuse";
import { TeamStore, type TeamBinding, type IdentityProof } from "./team/store";
import { Admission } from "./hub/admission";
import { ReleaseStore } from "./releases/store";
import type { ReleaseCommand } from "./releases/types";

export interface TrunkInfo {
  name: string;
  created: number;
  /** Where the seed came from: a template name or a git URL. */
  source: string;
  owner: string | null;
}

/** The list of trunks. One instance serves the whole deployment. */
export class Hub extends DurableObject<Env> {
  private sql: SqlStorage;
  private admission: Admission;
  private teams: TeamStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS trunks (name TEXT PRIMARY KEY, created INTEGER NOT NULL, source TEXT NOT NULL, owner TEXT)");
    this.teams = new TeamStore(this.sql);
    this.admission = new Admission(ctx.storage, this.sql);
  }

  team(trunk: string) { return this.teams.get(trunk); }
  releases(command: ReleaseCommand) { return this.ctx.storage.transactionSync(() => new ReleaseStore(this.sql).run(command)); }
  protectOwner(trunk: string, ownerId: string, origin: string) { return this.teams.protectOwner(trunk, ownerId, origin); }
  bindTeam(trunk: string, ownerId: string, binding: TeamBinding) { return this.teams.bind(trunk, ownerId, binding); }
  teamProof(trunk: string, principal: string) { return this.teams.proof(trunk, principal); }
  recordTeamProof(trunk: string, proof: IdentityProof) { this.teams.record(trunk, proof); }

  add(t: TrunkInfo) {
    this.sql.exec("INSERT OR REPLACE INTO trunks (name, created, source, owner) VALUES (?, ?, ?, ?)", t.name, t.created, t.source, t.owner);
  }

  /** Forgets a trunk and its releases; returns the release files' keys to delete. */
  remove(name: string): string[] {
    return this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM trunks WHERE name = ?", name);
      return new ReleaseStore(this.sql).forget(name);
    });
  }

  reserve(name: string, owner: string | null, creator: string, limits: AbuseLimits) {
    return this.admission.reserve(name, owner, creator, limits);
  }

  complete(t: TrunkInfo, ticket: string) {
    this.admission.complete(t, ticket);
  }

  release(name: string, ticket: string) {
    this.admission.release(name, ticket);
  }

  // Rate-only instances use the same existing DO binding, but a separate name
  // per hashed connecting address: agent traffic never serializes on the Hub.
  takeRate(bucket: "creation" | "control" | "agent", limit: number, windowMs: number) {
    return this.admission.takeRate(bucket, limit, windowMs);
  }

  /** One trunk, or null. */
  find(name: string): TrunkInfo | null {
    return this.sql.exec<{ name: string; created: number; source: string; owner: string | null }>("SELECT name, created, source, owner FROM trunks WHERE name = ?", name).toArray()[0] ?? null;
  }

  list(): TrunkInfo[] {
    return this.sql.exec<{ name: string; created: number; source: string; owner: string | null }>("SELECT name, created, source, owner FROM trunks ORDER BY created DESC LIMIT 500").toArray();
  }
}
