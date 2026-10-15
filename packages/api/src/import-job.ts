import { DurableObject } from "cloudflare:workers";
import { githubToken } from "./github/api";
import { importWithAccess } from "./github/import-access";
import { importGitHub, importGitHubContext } from "./importer";
import { activeImport, type ImportRequest, type ImportState, type ImportStatus } from "./import/job-state";
import type { RepoInfo } from "./types";

/** One durable import per workspace. SQLite stages source a file at a time;
 * alarms, not the browser request or a waitUntil deadline, own the work. */
export class ImportJob extends DurableObject<Env> {
  private running = false;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS import_state (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)");
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS import_files (n INTEGER PRIMARY KEY, path TEXT NOT NULL, text TEXT NOT NULL)");
  }
  private get sql() { return this.ctx.storage.sql; }
  private state(): ImportState | null {
    const row = this.sql.exec<{ body: string }>("SELECT body FROM import_state WHERE id=1").toArray()[0];
    return row ? JSON.parse(row.body) : null;
  }
  private save(job: ImportState) {
    job.status.updatedAt = Date.now();
    this.sql.exec("INSERT OR REPLACE INTO import_state (id, body) VALUES (1, ?)", JSON.stringify(job));
  }
  status(): ImportStatus | null { return this.state()?.status ?? null; }

  async start(input: ImportRequest): Promise<ImportStatus> {
    const previous = this.state();
    if (previous) throw new Error(`trunk ${input.trunk} already exists or is being created`);
    const now = Date.now();
    const job: ImportState = { ...input, commit: null, nextFile: 0, batch: 0, attempts: 0, retries: 0, resume: "queued", status: {
      trunk: input.trunk, repo: `${input.upstream.owner}/${input.upstream.repo}`, phase: "queued", ready: false,
      files: 0, bytes: 0, skipped: 0, startedAt: now, updatedAt: now, error: null, notes: [],
    } };
    this.save(job);
    // Set recovery before cross-object work: a lost response cannot orphan it.
    await this.ctx.storage.setAlarm(Date.now() + 1000);
    await this.register(job);
    return job.status;
  }

  async retry(owner: string): Promise<ImportStatus> {
    const job = this.state();
    if (!job || job.owner !== owner) throw new Error("only the workspace owner can retry this import");
    if (activeImport(job.status.phase) || job.status.phase === "complete") return job.status;
    if (job.retries >= 3) throw new Error("This import has failed repeatedly. Check GitHub access or the reported limit before creating another workspace.");
    job.retries++;
    job.attempts = 0;
    job.status.phase = job.resume;
    job.status.error = null;
    this.save(job);
    await this.ctx.storage.setAlarm(Date.now() + 1);
    return job.status;
  }

  /** Deletion cannot race a still-running initializer or context write. */
  async forget(): Promise<void> {
    const job = this.state();
    if (this.running || (job && activeImport(job.status.phase))) throw new Error("the import is still running; wait for it to finish before deleting the workspace");
    await this.ctx.storage.deleteAlarm();
    this.sql.exec("DELETE FROM import_files");
    this.sql.exec("DELETE FROM import_state");
  }

  async alarm() {
    const job = this.state();
    if (!job || !activeImport(job.status.phase) || this.running) return;
    this.running = true;
    try {
      // Each phase is replayable after eviction. A watchdog recovers an alarm
      // interrupted by a deployment or a process failure, even without traffic.
      await this.ctx.storage.setAlarm(Date.now() + 30_000);
      job.resume = job.status.phase;
      job.attempts++;
      this.save(job);
      await this.register(job);
      if (job.status.phase === "queued" || job.status.phase === "copying") await this.copy(job);
      else if (job.status.phase === "seeding") await this.seed(job);
      else if (job.status.phase === "context") await this.context(job);
      job.attempts = 0;
      job.status.error = null;
      this.save(job);
      if (activeImport(job.status.phase)) await this.ctx.storage.setAlarm(Date.now() + 1);
      else await this.ctx.storage.deleteAlarm();
    } catch (error) {
      job.status.error = error instanceof Error ? error.message : "The import could not finish. Try again.";
      if (job.attempts >= 3 || /budget|unsafe path|duplicate file|no supported|not found|already exists/i.test(job.status.error)) {
        job.resume = job.status.phase as ImportState["resume"];
        job.status.phase = "failed";
        await this.ctx.storage.deleteAlarm();
      } else await this.ctx.storage.setAlarm(Date.now() + 5000 * job.attempts);
      this.save(job);
    } finally { this.running = false; }
  }

  private async register(job: ImportState) {
    const hub = this.env.HUB.get(this.env.HUB.idFromName("hub"));
    const existing = await hub.find(job.trunk);
    if (existing) {
      if (existing.owner !== job.owner) throw new Error("workspace ownership changed during import");
      return;
    }
    const info = { name: job.trunk, owner: job.owner, source: `github:${job.status.repo}`, created: job.status.startedAt };
    if (job.ticket) await hub.complete(info, job.ticket);
    else await hub.add(info);
    await this.env.ROOM.get(this.env.ROOM.idFromName(job.trunk)).importRepo(this.repo(job), []);
  }

  private withAccess<T>(job: ImportState, run: (token: string | null) => Promise<T>) {
    return importWithAccess(job.provider === "codegraff"
      ? () => this.env.ACCOUNT.get(this.env.ACCOUNT.idFromName(job.owner)).githubToken(job.origin, [job.status.repo], true)
      : null, githubToken(this.env), run);
  }

  private async copy(job: ImportState) {
    job.status.phase = "copying";
    job.status.files = 0; job.status.bytes = 0; job.status.skipped = 0;
    this.sql.exec("DELETE FROM import_files");
    this.save(job);
    const { owner, repo, ref } = job.upstream;
    const { imported } = await this.withAccess(job, (token) => importGitHub(owner, repo, ref, token, job.maxBytes, async (file, progress) => {
      this.sql.exec("INSERT INTO import_files (n, path, text) VALUES (?, ?, ?)", progress.count - 1, file.path, file.text);
      job.status.files = progress.count; job.status.bytes = progress.bytes; job.status.skipped = progress.skipped;
      if (progress.count % 32 === 0 || Date.now() - job.status.updatedAt > 1000) this.save(job);
    }));
    job.commit = imported.commit;
    job.status.files = imported.count; job.status.bytes = imported.bytes; job.status.skipped = imported.skipped;
    job.nextFile = 0; job.batch = 0; job.status.phase = "seeding";
    this.save(job);
  }

  private async seed(job: ImportState) {
    const seq = this.env.SEQUENCER.get(this.env.SEQUENCER.idFromName(job.trunk));
    await seq.beginImport(job.trunk, job.id);
    // Bound each alarm so large repositories yield between durable batches.
    let batches = 0;
    while (job.nextFile < job.status.files && batches++ < 8) {
      const files: { path: string; text: string }[] = [];
      let bytes = 0;
      for (const row of this.sql.exec<{ n: number; path: string; text: string }>("SELECT n, path, text FROM import_files WHERE n >= ? ORDER BY n LIMIT 64", job.nextFile)) {
        const size = new TextEncoder().encode(row.text).length + new TextEncoder().encode(row.path).length;
        if (files.length && bytes + size > 512 * 1024) break;
        files.push({ path: row.path, text: row.text }); bytes += size;
      }
      if (!files.length) throw new Error("staged import files are missing");
      await seq.appendImport(job.id, job.batch, files);
      job.nextFile += files.length; job.batch++;
      this.save(job);
    }
    if (job.nextFile < job.status.files) return;
    await seq.finishImport(job.id);
    job.status.ready = true;
    const room = this.env.ROOM.get(this.env.ROOM.idFromName(job.trunk));
    const repo = this.repo(job);
    // Empty issue input never overwrites tasks created while the copy ran.
    await room.importRepo(repo, []);
    await room.refreshGitHubContext(repo, [], []);
    job.status.phase = "context";
    this.save(job);
    this.sql.exec("DELETE FROM import_files");
  }

  private async context(job: ImportState) {
    const { owner, repo } = job.upstream;
    const { imported } = await this.withAccess(job, (token) => importGitHubContext(owner, repo, token));
    const room = this.env.ROOM.get(this.env.ROOM.idFromName(job.trunk));
    // Refresh merges upstream fields while preserving conversations and local tasks.
    const result = await room.refreshGitHubContext({ ...imported.repo, commit: job.commit }, imported.issues, imported.notes);
    job.status.notes = result.contextNotes ?? imported.notes;
    job.status.phase = "complete";
  }

  private repo(job: ImportState): RepoInfo {
    return {
      fullName: job.status.repo, description: null, url: `https://github.com/${job.status.repo}`,
      stars: 0, topics: [], license: null, defaultBranch: job.upstream.ref ?? "main", commit: job.commit, pulls: [],
      ...(job.status.ready ? { importSummary: { files: job.status.files, skipped: job.status.skipped, notes: [], importedAt: Date.now() } } : {}),
    };
  }
}
