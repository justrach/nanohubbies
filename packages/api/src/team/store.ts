import type { Membership } from "./provider";

export interface TeamBinding {
  /** Older records are Codegraff team bindings. */
  kind?: "team" | "owner";
  roomId: string;
  name: string;
  issuer: string;
  boundBy: string;
  boundAt: number;
}
export interface IdentityProof {
  ownerId: string;
  subject: string;
  issuer: string;
  audience: string;
  roomId: string;
  role: Membership["role"];
  agentId: string | null;
  credentialId: string | null;
  verifiedAt: number;
}

export class TeamStore {
  constructor(private sql: SqlStorage) {
    sql.exec(
      "CREATE TABLE IF NOT EXISTS team_bindings (trunk TEXT PRIMARY KEY, body TEXT NOT NULL)",
    );
    sql.exec(
      "CREATE TABLE IF NOT EXISTS team_identity_proofs (trunk TEXT NOT NULL, principal TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (trunk, principal))",
    );
  }
  get(trunk: string): TeamBinding | null {
    const row = this.sql
      .exec<{
        body: string;
      }>("SELECT body FROM team_bindings WHERE trunk = ?", trunk)
      .toArray()[0];
    return row ? JSON.parse(row.body) : null;
  }
  bind(trunk: string, ownerId: string, binding: TeamBinding) {
    const owner = this.sql
      .exec<{
        owner: string | null;
      }>("SELECT owner FROM trunks WHERE name = ?", trunk)
      .toArray()[0]?.owner;
    if (!owner || owner !== ownerId || binding.boundBy !== ownerId)
      throw new Error("only the workspace creator can connect a team");
    const existing = this.get(trunk);
    if (existing && existing.kind !== "owner") {
      if (
        existing.roomId !== binding.roomId ||
        existing.issuer !== binding.issuer
      )
        throw new Error(
          "a team workspace cannot be made public or moved to another room",
        );
      return existing;
    }
    this.sql.exec(
      "INSERT OR REPLACE INTO team_bindings (trunk, body) VALUES (?, ?)",
      trunk,
      JSON.stringify(binding),
    );
    return binding;
  }
  /** Establish privacy before the first object is written, including while
   * an import is downloading. Retained after deletion, just like team access. */
  protectOwner(trunk: string, ownerId: string, origin: string) {
    const existing = this.get(trunk);
    if (existing) {
      if (existing.boundBy !== ownerId)
        throw new Error("only the workspace creator can initialize this workspace");
      return existing;
    }
    const made = this.sql.exec<{ owner: string | null }>(
      "SELECT owner FROM trunks WHERE name = ?", trunk,
    ).toArray()[0];
    if (made && made.owner !== ownerId)
      throw new Error("only the workspace creator can protect this workspace");
    const binding: TeamBinding = {
      kind: "owner", roomId: "owner", name: "workspace owner", issuer: origin,
      boundBy: ownerId, boundAt: Date.now(),
    };
    this.sql.exec("INSERT INTO team_bindings (trunk, body) VALUES (?, ?)", trunk, JSON.stringify(binding));
    return binding;
  }
  proof(trunk: string, principal: string): IdentityProof | null {
    const row = this.sql
      .exec<{
        body: string;
      }>("SELECT body FROM team_identity_proofs WHERE trunk = ? AND principal = ?", trunk, principal)
      .toArray()[0];
    return row ? JSON.parse(row.body) : null;
  }
  record(trunk: string, proof: IdentityProof) {
    const binding = this.get(trunk);
    if (
      !binding ||
      binding.roomId !== proof.roomId ||
      binding.issuer !== proof.issuer
    )
      throw new Error("proof does not match this workspace");
    this.sql.exec(
      "INSERT OR REPLACE INTO team_identity_proofs (trunk, principal, body) VALUES (?, ?, ?)",
      trunk,
      proof.agentId ?? proof.ownerId,
      JSON.stringify(proof),
    );
  }
}
