import {assertRepositoryWritable} from "../repository/archive";
export type RepoRole = "reader" | "writer" | "admin" | "owner";
export interface Collaborator {
  userId: string;
  role: RepoRole;
  addedAt: number;
  addedBy: string;
}
export const hashToken = async (token: string) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
export class Collaborators {
  constructor(private sql: SqlStorage) {
    sql.exec(
      "CREATE TABLE IF NOT EXISTS collaborators (trunk TEXT, user_id TEXT, role TEXT NOT NULL, added_at INTEGER, added_by TEXT, PRIMARY KEY(trunk,user_id))",
    );
    sql.exec(
      "CREATE TABLE IF NOT EXISTS repo_invitations (id TEXT PRIMARY KEY, trunk TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, token_hash TEXT NOT NULL, expires INTEGER NOT NULL, created_by TEXT NOT NULL)",
    );
    sql.exec(
      "CREATE TABLE IF NOT EXISTS access_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, trunk TEXT, actor TEXT, action TEXT, target TEXT, at INTEGER)",
    );
  }
  private owner(trunk: string) {
    const row = this.sql
      .exec<{
        body: string;
      }>("SELECT body FROM team_bindings WHERE trunk = ?", trunk)
      .toArray()[0];
    const binding = row ? JSON.parse(row.body) : null;
    if (!binding || binding.kind !== "owner")
      throw new Error(
        "Direct collaborators require an independently managed private repository",
      );
    return binding.boundBy as string;
  }
  role(trunk: string, userId: string): RepoRole | null {
    if (this.owner(trunk) === userId) return "owner";
    return (
      this.sql
        .exec<{
          role: RepoRole;
        }>("SELECT role FROM collaborators WHERE trunk = ? AND user_id = ?", trunk, userId)
        .toArray()[0]?.role ?? null
    );
  }
  private manage(trunk: string, actor: string, role?: RepoRole) {
    const own = this.role(trunk, actor);
    if (
      own !== "owner" &&
      (own !== "admin" || role === "admin" || role === "owner")
    )
      throw new Error(
        "Only the owner can manage admins; owners and admins manage other collaborators",
      );
  }
  private audit(trunk: string, actor: string, action: string, target: string) {
    this.sql.exec(
      "INSERT INTO access_audit(trunk,actor,action,target,at) VALUES(?,?,?,?,?)",
      trunk,
      actor,
      action,
      target,
      Date.now(),
    );
  }
  list(trunk: string) {
    const owner = this.owner(trunk);
    return {
      members: [
        {
          userId: owner,
          role: "owner" as RepoRole,
          addedAt: 0,
          addedBy: owner,
        },
        ...this.sql
          .exec<{
            user_id: string;
            role: RepoRole;
            added_at: number;
            added_by: string;
          }>(
            "SELECT * FROM collaborators WHERE trunk = ? ORDER BY added_at",
            trunk,
          )
          .toArray()
          .map((r) => ({
            userId: r.user_id,
            role: r.role,
            addedAt: r.added_at,
            addedBy: r.added_by,
          })),
      ],
      invitations: this.sql
        .exec<{ id: string; user_id: string; role: RepoRole; expires: number }>(
          "SELECT id,user_id,role,expires FROM repo_invitations WHERE trunk = ? AND expires > ?",
          trunk,
          Date.now(),
        )
        .toArray()
        .map((r) => ({
          id: r.id,
          userId: r.user_id,
          role: r.role,
          expires: r.expires,
        })),
    };
  }
  invite(
    trunk: string,
    actor: string,
    userId: string,
    role: RepoRole,
    tokenHash: string,
  ) {
    if (!["reader", "writer", "admin"].includes(role))
      throw new Error("Choose reader, writer or admin");
    this.manage(trunk, actor, role);
    if (
      typeof userId !== "string" ||
      !/^(codegraff|dev):[^\s]{1,200}$/.test(userId)
    )
      throw new Error("Enter the recipient's exact Nanohub account ID");
    if (this.role(trunk, userId))
      throw new Error("Already a collaborator; update their role instead");
    this.sql.exec(
      "DELETE FROM repo_invitations WHERE expires <= ?",
      Date.now(),
    );
    if (
      this.sql
        .exec<{
          n: number;
        }>("SELECT count(*) AS n FROM repo_invitations WHERE trunk = ?", trunk)
        .toArray()[0].n >= 100
    )
      throw new Error("Too many pending invitations");
    const id = crypto.randomUUID(),
      expires = Date.now() + 7 * 86400000;
    this.sql.exec(
      "INSERT INTO repo_invitations VALUES(?,?,?,?,?,?,?)",
      id,
      trunk,
      userId,
      role,
      tokenHash,
      expires,
      actor,
    );
    this.audit(trunk, actor, "invite", userId);
    return { id, userId, role, expires };
  }
  accept(trunk: string, userId: string, tokenHash: string) {
    const invite = this.sql
      .exec<{
        id: string;
        user_id: string;
        role: RepoRole;
        expires: number;
        created_by: string;
      }>("SELECT * FROM repo_invitations WHERE trunk = ? AND token_hash = ?", trunk, tokenHash)
      .toArray()[0];
    if (!invite || invite.user_id !== userId || invite.expires <= Date.now())
      throw new Error("Invitation unavailable for this account");
    // Recheck the inviter's current authority, including demotion or removal.
    this.manage(trunk, invite.created_by, invite.role);
    if (this.role(trunk, userId)) throw new Error("Already a collaborator");
    assertRepositoryWritable(this.sql,trunk);
    this.sql.exec(
      "INSERT INTO collaborators VALUES(?,?,?,?,?)",
      trunk,
      userId,
      invite.role,
      Date.now(),
      invite.created_by,
    );
    this.sql.exec(
      "DELETE FROM repo_invitations WHERE trunk = ? AND user_id = ?",
      trunk,
      userId,
    );
    this.audit(trunk, userId, "accept", userId);
    return { trunk, role: invite.role };
  }
  change(trunk: string, actor: string, userId: string, role: RepoRole | null) {
    const current = this.role(trunk, userId);
    if (!current || current === "owner")
      throw new Error("The repository owner cannot be changed or removed here");
    this.manage(trunk, actor, current);
    if (role) {
      if (!["reader", "writer", "admin"].includes(role))
        throw new Error("Invalid role");
      this.manage(trunk, actor, role);
    }
    if (role)
      this.sql.exec(
        "UPDATE collaborators SET role = ? WHERE trunk = ? AND user_id = ?",
        role,
        trunk,
        userId,
      );
    else
      this.sql.exec(
        "DELETE FROM collaborators WHERE trunk = ? AND user_id = ?",
        trunk,
        userId,
      );
    this.sql.exec(
      "DELETE FROM repo_invitations WHERE trunk = ? AND (user_id = ? OR created_by = ?)",
      trunk,
      userId,
      userId,
    );
    this.audit(trunk, actor, role ? "role:" + role : "remove", userId);
  }
  cancel(trunk: string, actor: string, id: string) {
    const invite = this.sql
      .exec<{
        role: RepoRole;
      }>("SELECT role FROM repo_invitations WHERE trunk = ? AND id = ?", trunk, id)
      .toArray()[0];
    if (!invite) throw new Error("Invitation unavailable");
    this.manage(trunk, actor, invite.role);
    this.sql.exec("DELETE FROM repo_invitations WHERE id = ?", id);
    this.audit(trunk, actor, "cancel-invitation", id);
  }
}
