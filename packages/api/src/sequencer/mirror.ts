import { push } from "../pack";
import { getMeta, setMeta, versionAt } from "./store";

/** A trunk's Cloudflare Artifacts repo, kept in step by pushes. */
export interface Mirror {
  repo: string;
  remote: string;
  /** The newest version pushed so far. */
  pushed: number;
}

/** The most versions one push carries, to bound the request size. */
const PUSH_BATCH = 1000;

/** Creates the trunk's Artifacts repo. The sequencer mints its own
 *  short-lived tokens, so the creation token is revoked, not left valid. */
export async function createMirror(artifacts: Artifacts, trunk: string): Promise<Mirror> {
  let made: ArtifactsCreateRepoResult;
  try {
    made = await artifacts.create(trunk, { setDefaultBranch: "main", description: "nanohub swarm trunk" });
  } catch (e) {
    throw new Error(`could not create the Artifacts repo ${trunk}: ${e instanceof Error ? e.message : String(e)}`);
  }
  await withRepo(artifacts, made.name, (repo) => repo.revokeToken(made.token)).catch(() => {});
  return { repo: made.name, remote: made.remote, pushed: 0 };
}

export function repoToken(artifacts: Artifacts, repo: string, scope: "read" | "write", ttl: number): Promise<ArtifactsCreateTokenResult> {
  return withRepo(artifacts, repo, (r) => r.createToken(scope, ttl));
}

/** Pushes landed commits to the mirror over git's receive-pack. Each push
 *  carries every commit that landed since the last one, so pushes batch
 *  themselves when changes land faster than a push takes. */
export class MirrorPusher {
  private writeToken: { value: string; expires: number } | null = null;

  constructor(
    private sql: SqlStorage,
    private artifacts: () => Artifacts | undefined,
  ) {}

  async pushOutbox() {
    for (;;) {
      const mirror = getMeta<Mirror>(this.sql, "mirror");
      const artifacts = this.artifacts();
      if (!mirror || !artifacts) return;
      const top = this.sql.exec<{ v: number | null }>("SELECT MAX(version) AS v FROM outbox").one().v;
      if (top === null) return;
      const through = Math.min(top, mirror.pushed + PUSH_BATCH);
      const rows = this.sql.exec<{ sha: string; raw: ArrayBuffer }>("SELECT sha, raw FROM outbox WHERE version <= ? ORDER BY seq", through).toArray();
      await push(
        { remote: mirror.remote, token: await this.token(artifacts, mirror.repo) },
        "refs/heads/main",
        versionAt(this.sql, through)!.commit,
        rows.map((r) => ({ sha: r.sha, raw: new Uint8Array(r.raw) })),
        (sha) => this.sql.exec("SELECT 1 FROM versions WHERE commit_sha = ?", sha).toArray().length > 0,
        mirror.pushed === 0,
      );
      this.sql.exec("DELETE FROM outbox WHERE version <= ?", through);
      setMeta(this.sql, "mirror", { ...mirror, pushed: through });
    }
  }

  /** Drops the cached token, for a deleted trunk. */
  forget() {
    this.writeToken = null;
  }

  private async token(artifacts: Artifacts, repo: string): Promise<string> {
    if (!this.writeToken || this.writeToken.expires - Date.now() < 5 * 60_000) {
      const t = await repoToken(artifacts, repo, "write", 3600);
      this.writeToken = { value: t.plaintext, expires: Date.parse(t.expiresAt) };
    }
    return this.writeToken.value;
  }
}

async function withRepo<T>(artifacts: Artifacts, name: string, fn: (repo: ArtifactsRepo) => Promise<T>): Promise<T> {
  const repo = await artifacts.get(name);
  try {
    return await fn(repo);
  } finally {
    repo[Symbol.dispose]();
  }
}
