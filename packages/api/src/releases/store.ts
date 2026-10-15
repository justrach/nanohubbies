import type { Release, ReleaseCommand } from "./types";

/** An additive catalog; binaries live under a separate R2 prefix from Git objects. */
export class ReleaseStore {
  constructor(private sql: SqlStorage) {
    sql.exec("CREATE TABLE IF NOT EXISTS public_releases (id TEXT PRIMARY KEY, trunk TEXT NOT NULL, tag TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(trunk, tag))");
  }
  run(command: ReleaseCommand): Release[] {
    const trunk = command.op === "create" ? command.release.trunk : command.trunk;
    if (command.op === "create") {
      const all = this.list(trunk);
      if (all.length >= 100) throw new Error("Workspace release limit reached");
      if (all.some((r) => r.tag === command.release.tag)) throw new Error(`A release tagged ${command.release.tag} already exists`);
      this.sql.exec("INSERT INTO public_releases VALUES (?, ?, ?, ?)", command.release.id, trunk, command.release.tag, JSON.stringify(command.release));
    } else if (command.op !== "list") {
      const all = this.list(trunk);
      const found = all.find((r) => r.id === command.id);
      if (!found) throw new Error("No such release");
      if (command.op === "delete") {
        this.sql.exec("DELETE FROM public_releases WHERE id = ? AND trunk = ?", found.id, trunk);
        return this.list(trunk);
      }
      if (command.op === "asset") {
        if (found.state !== "draft") throw new Error("Unpublish before changing release assets");
        if (found.assets.length >= 20) throw new Error("A release can have up to 20 files");
        if (found.assets.some((a) => a.name === command.asset.name)) throw new Error("A file with this name is already attached");
        if (storedBytes(all) + command.asset.size > command.maxBytes) throw new Error(`Release files in this workspace are limited to ${Math.floor(command.maxBytes / 1024 / 1024)} MB in total`);
        found.assets.push(command.asset);
      } else {
        found.state = command.published ? "published" : "draft";
        found.published = command.published ? found.published ?? Date.now() : null;
      }
      this.sql.exec("UPDATE public_releases SET data = ? WHERE id = ? AND trunk = ?", JSON.stringify(found), found.id, trunk);
    }
    return this.list(trunk).filter((r) => command.op !== "list" || !command.publicOnly || r.state === "published");
  }
  /** Drops a deleted workspace's releases, so a later workspace of the same
   *  name starts with none, and returns their files' keys to delete. */
  forget(trunk: string): string[] {
    const keys = this.list(trunk).flatMap((r) => r.assets.map((a) => a.key));
    this.sql.exec("DELETE FROM public_releases WHERE trunk = ?", trunk);
    return keys;
  }
  private list(trunk: string): Release[] {
    return this.sql.exec<{ data: string }>("SELECT data FROM public_releases WHERE trunk = ? ORDER BY rowid DESC LIMIT 100", trunk).toArray().map((r) => JSON.parse(r.data));
  }
}

/** Bytes of every file attached to these releases. */
export const storedBytes = (releases: Release[]) => releases.reduce((sum, r) => sum + r.assets.reduce((s, a) => s + a.size, 0), 0);
