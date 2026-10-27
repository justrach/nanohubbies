export type Namespace = { name: string; owner: string; created: number };
export type RepositoryAddress = {
  id: string;
  namespace: string;
  name: string;
  created: number;
};
const OWNER = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/;
const REPO = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const reserved = new Set([
  "api",
  "git",
  "t",
  "pr",
  "start",
  "dashboard",
  "invite",
  "auth",
  "settings",
  "login",
  "logout",
  "new",
  "assets",
  "_next",
]);
export function address(namespace: string, name?: string) {
  if (
    typeof namespace !== "string" ||
    !OWNER.test(namespace) ||
    reserved.has(namespace)
  )
    throw new Error(
      "Use a lowercase owner handle (1–39 letters, digits or hyphens)",
    );
  if (
    name !== undefined &&
    (typeof name !== "string" || !REPO.test(name) || name.endsWith(".git"))
  )
    throw new Error(
      "Use a lowercase repository name (1–100 letters, digits, dots, underscores or hyphens), without .git",
    );
}
const canonical = (name: string) => {
  if (typeof name !== "string") throw new Error("Invalid repository address");
  return name.toLowerCase();
};
export class Namespaces {
  constructor(private sql: SqlStorage) {
    sql.exec(
      "CREATE TABLE IF NOT EXISTS namespaces(name TEXT PRIMARY KEY, owner TEXT NOT NULL UNIQUE, created INTEGER NOT NULL)",
    );
    sql.exec(
      "CREATE TABLE IF NOT EXISTS repository_addresses(id TEXT PRIMARY KEY, namespace TEXT NOT NULL, name TEXT NOT NULL, created INTEGER NOT NULL, UNIQUE(namespace,name))",
    );
    // Retain old names as aliases, including after deletion: a clone URL must
    // never silently switch to another repository or principal.
    sql.exec(
      "CREATE TABLE IF NOT EXISTS repository_aliases(namespace TEXT, name TEXT, repository TEXT NOT NULL, PRIMARY KEY(namespace,name))",
    );
  }
  claim(name: string, owner: string) {
    name = canonical(name);
    address(name);
    const existing = this.sql
      .exec<Namespace>("SELECT * FROM namespaces WHERE owner = ?", owner)
      .toArray()[0];
    if (existing) {
      if (existing.name !== name)
        throw new Error("This account already has an owner namespace");
      return existing;
    }
    if (
      this.sql
        .exec("SELECT name FROM namespaces WHERE name = ?", name)
        .toArray().length
    )
      throw new Error("Owner handle unavailable");
    const created = Date.now();
    this.sql.exec("INSERT INTO namespaces VALUES(?,?,?)", name, owner, created);
    return { name, owner, created };
  }
  exists(name: string) {
    name = canonical(name);
    address(name);
    return !!this.sql
      .exec("SELECT name FROM namespaces WHERE name = ?", name)
      .toArray().length;
  }
  owned(owner: string) {
    return (
      this.sql
        .exec<Namespace>("SELECT * FROM namespaces WHERE owner = ?", owner)
        .toArray()[0] ?? null
    );
  }
  ownerForHandle(name: string) {
    name=canonical(name);try {address(name);}catch{return null;}
    return this.sql.exec<Namespace>("SELECT * FROM namespaces WHERE name = ?",name).toArray()[0]?.owner ?? null;
  }
  owns(namespace: string, actor: string) {
    if (
      this.sql
        .exec<Namespace>("SELECT * FROM namespaces WHERE name = ?", namespace)
        .toArray()[0]?.owner !== actor
    )
      throw new Error(
        "Only this namespace's owner can create or rename its repositories",
      );
  }
  resolve(namespace: string, name: string) {
    namespace = canonical(namespace);
    name = canonical(name);
    address(namespace, name);
    return (
      this.sql
        .exec<RepositoryAddress>(
          "SELECT * FROM repository_addresses WHERE namespace = ? AND name = ? UNION ALL SELECT a.* FROM repository_addresses a JOIN repository_aliases r ON r.repository = a.id WHERE r.namespace = ? AND r.name = ? LIMIT 1",
          namespace,
          name,
          namespace,
          name,
        )
        .toArray()[0] ?? null
    );
  }
  byId(id: string) {
    return (
      this.sql
        .exec<RepositoryAddress>(
          "SELECT * FROM repository_addresses WHERE id = ?",
          id,
        )
        .toArray()[0] ?? null
    );
  }
  reserve(namespace: string, name: string, actor: string, existingId?: string) {
    namespace = canonical(namespace);
    name = canonical(name);
    address(namespace, name);
    this.owns(namespace, actor);
    if (
      this.sql
        .exec<{
          n: number;
        }>("SELECT count(*) AS n FROM repository_addresses WHERE namespace = ?", namespace)
        .toArray()[0].n >= 100
    )
      throw new Error("Namespace repository capacity reached");
    if (this.resolve(namespace, name))
      throw new Error("Repository address already reserved");
    const id = existingId ?? "repo-" + crypto.randomUUID().replaceAll("-", "");
    if (existingId) {
      const t = this.sql
        .exec<{
          owner: string;
        }>("SELECT owner FROM trunks WHERE name = ?", existingId)
        .toArray()[0];
      const b = this.sql
        .exec<{
          body: string;
        }>("SELECT body FROM team_bindings WHERE trunk = ?", existingId)
        .toArray()[0];
      if (
        !t ||
        t.owner !== actor ||
        !b ||
        JSON.parse(b.body).kind !== "owner" ||
        JSON.parse(b.body).boundBy !== actor
      )
        throw new Error(
          "Only your independently managed private repositories can be addressed here",
        );
      if (this.byId(existingId))
        throw new Error("Repository already has an owner/repo address");
    }
    const result = { id, namespace, name, created: Date.now() };
    this.sql.exec(
      "INSERT INTO repository_addresses VALUES(?,?,?,?)",
      id,
      namespace,
      name,
      result.created,
    );
    return result;
  }
  rename(id: string, name: string, actor: string) {
    name = canonical(name);
    const row = this.byId(id);
    if (!row) throw new Error("Repository address unavailable");
    address(row.namespace, name);
    this.owns(row.namespace, actor);
    if (row.name === name) return row;
    const existing = this.resolve(row.namespace, name);
    if (existing && existing.id !== id)
      throw new Error("Repository address already reserved");
    this.sql.exec(
      "DELETE FROM repository_aliases WHERE namespace = ? AND name = ? AND repository = ?",
      row.namespace,
      name,
      id,
    );
    this.sql.exec(
      "INSERT OR IGNORE INTO repository_aliases VALUES(?,?,?)",
      row.namespace,
      row.name,
      id,
    );
    this.sql.exec(
      "UPDATE repository_addresses SET name = ? WHERE id = ?",
      name,
      id,
    );
    return { ...row, name };
  }
}
