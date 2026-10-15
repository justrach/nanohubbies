import { DurableObject } from "cloudflare:workers";
import { ReviewStore } from "./review/store";
import { CodeComments, type CommentCommand } from "./review/comments";
import type { ReviewCommand } from "./review/types";
import { listTargets } from "./sequencer/queries";
import { applyEdits, EditError, isCode, symbols, targets, type Applied } from "./footprint";
import { objectKey, type GitObject } from "./git";
import type { Landed, Started } from "./lane";
import { backToBack, dataCenter, repeat } from "./sequencer/bench";
import { landingCommit, type Landing } from "./sequencer/commit";
import { forgetLeases, forgive, leased, starve } from "./sequencer/leases";
import { MirrorPusher, repoToken, type Mirror } from "./sequencer/mirror";
import { add, beginBatch, beginLanding, endBatch, endLanding, held as heldRow, heldBytes, put } from "./sequencer/held";
import { Initializer, recordSeed } from "./sequencer/initialize";
import { Publisher } from "./sequencer/publish";
import { Backlog, backlogLimits } from "./sequencer/backlog";
import { Feed } from "./sequencer/feed";
import { decideOnce } from "./sequencer/receipts";
import { changeById, forget, getMeta, lastWrites, LAST_WRITE, migrate, OUTBOX, PENDING, PUSHED, putFile, rebuildTrees, recentChanges, record, setMeta, tipText, unseen, versionAt, versionsFrom, VERSIONS } from "./sequencer/store";
import type { ChangeRecord, ChangeRequest, Head, Made, Overlap, SubmitResult, Submitted } from "./types";

/** The trunk's only writer. It does the cheap part of landing a change:
 *  look up each footprint key's last write, apply the edits, commit. Reading,
 *  planning and testing happen in sessions and agents, never in here. Its
 *  tables live in ./sequencer/store, the writes a batch holds in
 *  ./sequencer/held, its commits in ./sequencer/commit, leases in
 *  ./sequencer/leases, the hand-off to the trunk's packer in
 *  ./sequencer/publish, and the Artifacts mirror in ./sequencer/mirror. */
export class Sequencer extends DurableObject<Env> {
  private sql: SqlStorage;
  private uploading: Promise<void> | null = null;
  private mirroring: Promise<void> | null = null;
  private pusher: MirrorPusher;
  private publisher: Publisher;
  private initializer: Initializer;
  /** Settles, and is replaced, each time the published head moves. */
  private moved = signal();
  /** Events for the room (./sequencer/feed). */
  private feed: Feed;
  /** How far publishing is behind, and whether new changes are decided (./sequencer/backlog). */
  private backlog: Backlog;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    migrate(this.sql);
    this.pusher = new MirrorPusher(this.sql, () => this.env.ARTIFACTS);
    this.feed = new Feed(async (events) => {
      const trunk = this.meta<string>("trunk");
      if (trunk) await this.env.ROOM.get(this.env.ROOM.idFromName(trunk)).publish(events);
    });
    this.backlog = new Backlog(this.sql, backlogLimits(env));
    this.publisher = new Publisher(
      this.sql,
      this.backlog,
      () => this.packer(),
      () => {
        this.moved.fire();
        this.moved = signal();
      },
    );
    this.initializer = new Initializer(ctx, env, (objects, root) => {
      const head = this.commitTip(1, objects, root, { id: "seed", agent: "seed", intent: "Seed the trunk", base: 0 }, [], null);
      recordSeed(this.sql, head);
      return head;
    }, async () => { this.backlog.recount(); void this.mirrorPush(); await this.publishedThrough(1); });
    // Finish publishing objects that an eviction interrupted.
    void this.upload().catch(() => {});
  }

  init(trunk: string, files: { path: string; text: string }[]): Promise<Head> {
    return this.initializer.initialize(trunk, files);
  }
  beginImport(trunk: string, id: string) { return this.initializer.begin(trunk, id); }
  appendImport(id: string, batch: number, files: { path: string; text: string }[]) { return this.initializer.append(id, batch, files); }
  finishImport(id: string) { return this.initializer.finish(id); }

  /** The newest version whose objects are all in R2. Sessions read from it and
   *  clones fetch it, so it never names an object that is not there yet. */
  head(): Head {
    const head = this.meta<Head>("published");
    if (!head) throw new Error("no such trunk");
    return head;
  }

  /** A lane's batch in one call: each change landed in order, as `submit`
   *  lands it, and the lives the lane started, for the room. Returns where the
   *  trunk got to, so the lane can start lives without asking again. */
  async land(reqs: ChangeRequest[], lives: Started[]): Promise<Landed> {
    for (const life of lives) this.feed.emit({ t: "life", ...life });
    const results = this.landAll(reqs);
    return { results, tip: this.meta<Head>("tip")!, published: this.head() };
  }

  /** The heads, the mirror, and the publishing backlog, from this object's own state. */
  info(): { head: Head; tip: Head; mirror: Mirror | null; backlog: ReturnType<Backlog["snapshot"]> } {
    return { head: this.head(), tip: this.meta<Head>("tip")!, mirror: this.meta<Mirror>("mirror") ?? null, backlog: this.backlog.snapshot() };
  }

  /** The ref list for git's dumb HTTP protocol. */
  refs(): string {
    return new ReviewStore(this.sql, () => this.head()).branches().map((b) => `${b.commit}\trefs/heads/${b.name}\n`).join("");
  }

  review(command: ReviewCommand) {
    if (command.op === "merge" && this.info().tip.commit !== command.base.commit) throw new Error("Main changed; refresh and retry");
    const mark = this.feed.mark();
    try {
      const result = this.ctx.storage.transactionSync(() => new ReviewStore(this.sql, () => this.head()).run(command, (req) => this.landAll([req], false)[0]));
      if (command.op === "merge") { void this.mirrorPush(); void this.upload().catch(() => {}); }
      return result;
    } catch (error) {
      forget(this.sql); forgetLeases(this.sql);
      this.feed.back(mark); this.backlog.recount();
      throw error;
    }
  }

  codeComments(command: CommentCommand) {
    return this.ctx.storage.transactionSync(() => new CodeComments(this.sql).run(command));
  }

  /** Commits a pushing client may already have: the newest 32 versions, then
   *  every power of two further back, so even an agent far behind finds one
   *  near what it cloned and sends only what is new. */
  haves(): string[] {
    const tip = this.head().version;
    const wanted = new Set<number>();
    for (let v = tip; v > 0 && v > tip - 32; v--) wanted.add(v);
    for (let back = 64; tip - back > 0; back *= 2) wanted.add(tip - back);
    wanted.add(1);
    return [...wanted].flatMap((v) => versionAt(this.sql, v)?.commit ?? []);
  }

  /** For each sha, the published version it is the commit of, or the version
   *  an earlier push of it landed as. A push is diffed against the newest
   *  version among its commits' ancestors. */
  versionsOf(shas: string[]): Record<string, { head: Head } | { pushedAs: number }> {
    const out: Record<string, { head: Head } | { pushedAs: number }> = {};
    const published = this.head().version;
    for (const sha of shas.slice(0, 500)) {
      const row = this.sql.exec<{ version: number }>("SELECT version FROM versions WHERE commit_sha = ?", sha).toArray()[0];
      const head = row && row.version <= published ? versionAt(this.sql, row.version) : undefined;
      if (head) out[sha] = { head };
      else {
        const pushed = this.sql.exec<{ version: number }>("SELECT version FROM pushed WHERE sha = ?", sha).toArray()[0];
        if (pushed) out[sha] = { pushedAs: pushed.version };
      }
    }
    return out;
  }

  log(limit = 50): ChangeRecord[] {
    return recentChanges(this.sql, limit);
  }

  /** Published versions from `from` down, newest first: the trunk's history. */
  heads(from: number, limit: number): Head[] {
    return versionsFrom(this.sql, Math.min(from, this.head().version), Math.min(Math.max(1, limit), 101));
  }

  /** Top-level symbols at the tip that scripted agents can share edits on,
   *  leaving out imports and the swarm's own per-agent files. */
  targets(limit = 200): { path: string; name: string }[] {
    return listTargets(this.sql, limit);
  }

  /** The tip's files, for browsing. */
  files(limit = 5000): { path: string; size: number }[] {
    return this.sql.exec<{ path: string; size: number }>("SELECT path, length(text) AS size FROM files ORDER BY path LIMIT ?", limit).toArray();
  }

  /** One file at the tip, for browsing. */
  read(path: string): { path: string; text: string } {
    const text = tipText(this.sql, path);
    if (text === undefined) throw new Error(`no such file: ${path}`);
    return { path, text };
  }

  /** A short-lived read token for cloning the Artifacts mirror with plain git. */
  async cloneToken(): Promise<{ remote: string; token: string; expiresAt: string }> {
    const mirror = this.meta<Mirror>("mirror");
    if (!mirror || !this.env.ARTIFACTS) throw new Error("this trunk has no Artifacts mirror");
    const t = await repoToken(this.env.ARTIFACTS, mirror.repo, "read", 600);
    return { remote: mirror.remote, token: t.plaintext, expiresAt: t.expiresAt };
  }

  /** Deletes the trunk: its Artifacts repo, its objects in R2, and its state. */
  async destroy(): Promise<{ deleted: string }> {
    const trunk = this.meta<string>("trunk");
    if (!trunk) throw new Error("no such trunk");
    const mirror = this.meta<Mirror>("mirror");
    if (mirror && this.env.ARTIFACTS) await this.env.ARTIFACTS.delete(mirror.repo);
    // Publishing stops and the packer forgets the trunk before its objects go,
    // so no pack is written after them; a merge that finishes later finds the
    // trunk gone and deletes its own pack.
    this.publisher.stop();
    await this.uploading?.catch(() => {});
    await this.packer().destroy();
    for (let cursor: string | undefined; ; ) {
      const page = await this.env.OBJECTS.list({ prefix: objectKey(trunk, ""), cursor, limit: 1000 });
      if (page.objects.length) await this.env.OBJECTS.delete(page.objects.map((o) => o.key));
      if (!page.truncated) break;
      cursor = page.cursor;
    }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    forget(this.sql);
    forgetLeases(this.sql);
    this.pusher.forget();
    this.publisher.forget();
    migrate(this.sql);
    this.backlog.recount();
    return { deleted: trunk };
  }

  /** Retries publication or a mirror push without needing another landing. */
  async alarm() {
    await Promise.all([this.mirrorPush(), this.upload()]);
  }

  async submit(req: ChangeRequest): Promise<Submitted> {
    return this.landAll([req])[0];
  }

  /** Lands changes one after another in this turn, each decided once
   *  (./sequencer/receipts). Their writes, receipts with them, are held and go
   *  in together, in one transaction, once the last is decided
   *  (./sequencer/held). Until then they are provisional: nothing that
   *  answers for a change, publishes it or mirrors it runs before. A change
   *  that throws leaves no writes and no events, and the batch's earlier
   *  changes still go in; if the batch's write fails, none of it goes in and
   *  none of its events go out. Either way the caches are read again from the
   *  tables, and the error reaches the caller, whose retries replay receipts. */
  private landAll(reqs: ChangeRequest[], publish = true): Submitted[] {
    const results: Submitted[] = [];
    const queued = this.feed.mark();
    const started = Date.now();
    let failed = false;
    beginBatch(this.sql);
    try {
      for (const req of reqs) {
        const before = this.feed.mark();
        beginLanding(this.sql);
        try {
          results.push(decideOnce(this.ctx.storage, req, () => this.decide(req), () => this.backlog.admits(heldBytes(this.sql, PENDING, 2))));
        } catch (e) {
          this.feed.back(before);
          failed = true;
          throw e;
        } finally {
          endLanding(this.sql, !failed);
        }
      }
    } finally {
      const bytes = heldBytes(this.sql, PENDING, 2);
      try {
        this.ctx.storage.transactionSync(() => endBatch(this.sql));
        this.backlog.added(bytes, started);
      } catch (e) {
        this.feed.back(queued);
        failed = true;
        throw e;
      } finally {
        if (failed) {
          forget(this.sql);
          forgetLeases(this.sql);
        }
      }
    }
    if (publish && results.some((r) => r.status === "landed")) {
      void this.mirrorPush();
      // Landed is landed once it is in this object's storage: packing its git
      // objects into R2 goes on in the background, and the published head follows.
      void this.upload().catch(() => {});
    }
    return results;
  }

  private decide(req: ChangeRequest): Submitted {
    const tip = this.meta<Head>("tip");
    if (!tip) throw new Error("no such trunk");
    if (req.base > tip.version) return this.reject(req, `base v${req.base} is ahead of the trunk (v${tip.version})`);
    const strong = new Set(req.reads.strong);
    const weak = new Set(req.reads.weak);

    const named = targets(req.edits);
    const held = leased(this.sql, req.agent, named.writes, tip.version);
    if (held.length) return this.conflict(req, held);
    // Keys looked up for the first check are not looked up again for the second.
    const known = new Map<string, { version: number; change_id: string } | null>();
    const early = this.overlaps(req.base, named.writes, union(strong, named.reads), weak, known);
    if (early.hard.length) return this.conflict(req, early.hard);

    let applied: Applied;
    try {
      applied = applyEdits(req.edits, (path) => tipText(this.sql, path));
    } catch (e) {
      if (e instanceof EditError) return this.reject(req, e.message);
      throw e;
    }
    const late = leased(this.sql, req.agent, applied.writes, tip.version);
    if (late.length) return this.conflict(req, late);
    const { hard, soft } = this.overlaps(req.base, applied.writes, union(strong, applied.reads), weak, known);
    if (hard.length) return this.conflict(req, hard);
    if (applied.collisions.length) return this.reject(req, `already defined: ${applied.collisions.join(", ")}`);
    const size = [...applied.files.values()].reduce((n, text) => n + (text?.length ?? 0), 0);
    if (size > this.backlog.limits.changeBytes) return this.reject(req, `the change writes ${size} bytes of files; at most ${this.backlog.limits.changeBytes} land at once`);

    // Land. Nothing from the first check to here awaits, so changes land one
    // at a time and every check sees the tip it lands on.
    const version = tip.version + 1;
    const blobs = [...applied.files].flatMap(([path, text]) => putFile(this.sql, path, text) ?? []);
    const trees = rebuildTrees(this.sql, applied.files.keys());
    for (const k of applied.writes) put(this.sql, LAST_WRITE, k, [k, version, req.id]);
    const head = this.commitTip(version, [...blobs, ...trees.objects], trees.root, req, soft, tip.commit);
    if (req.pushed && heldRow(this.sql, PUSHED, req.pushed.sha) === undefined) put(this.sql, PUSHED, req.pushed.sha, [req.pushed.sha, version]);
    forgive(this.sql, req.agent);
    const at = Date.now();
    record(this.sql, { ...about(req), status: "landed", version, commit: head.commit, overlaps: soft, at });
    this.feed.emit({
      t: "landed",
      agent: req.agent,
      kind: req.kind,
      owner: req.owner ?? null,
      life: req.life,
      change: req.id,
      intent: req.intent,
      base: req.base,
      version,
      revalidate: soft.map((o) => o.key),
      issue: req.issue ?? null,
      closes: !!req.closes,
      at,
    });
    return { status: "landed", id: req.id, version, commit: head.commit, revalidate: soft, made: handBack(head.tree, [...blobs, ...trees.objects]) };
  }

  /** Changes landed back to back, for benchmarks (./sequencer/bench). */
  benchmark(n: number, prefix: string, apart = false, shape = "files", bots = 1000, batch = 1): Promise<number> {
    return backToBack(this, n, prefix, apart, shape, bots, batch);
  }

  /** The data center this object runs in. */
  colo(): Promise<string | null> {
    return dataCenter();
  }

  /** One kind of operation, `n` times, for timing (./sequencer/bench). */
  repeat(op: string, n: number): number {
    return repeat(this.sql, op, n);
  }

  /** Waits until `version`'s objects are in R2, for a client that reads it or
   *  builds on it next: a git push, or a life about to read. */
  async whenPublished(version: number): Promise<void> {
    await this.publishedThrough(version);
  }

  /** Every key the change touched that a later-landed change wrote. Writes and
   *  strong reads are hard: the change was planned on something that is gone.
   *  Weak reads are soft: the agent saw the symbol but may not depend on it. */
  private overlaps(base: number, writes: Set<string>, strong: Set<string>, weak: Set<string>, known: Map<string, { version: number; change_id: string } | null>) {
    const hard: Overlap[] = [];
    const soft: Overlap[] = [];
    const last = lastWrites(this.sql, new Set([...writes, ...strong, ...weak]), known);
    const check = (k: string, kind: Overlap["kind"], into: Overlap[]) => {
      const row = last.get(k);
      if (row && row.version > base) into.push({ key: k, kind, by: row.change_id, version: row.version });
    };
    for (const k of writes) check(k, "write", hard);
    for (const k of strong) if (!writes.has(k)) check(k, "read", hard);
    for (const k of weak) if (!writes.has(k) && !strong.has(k)) check(k, "weak", soft);
    return { hard, soft };
  }

  private conflict(req: ChangeRequest, conflicts: Overlap[]): SubmitResult {
    const at = Date.now();
    record(this.sql, { ...about(req), status: "conflict", version: null, commit: null, overlaps: conflicts, at });
    const winners = [...new Set(conflicts.filter((c) => c.kind !== "leased").map((c) => c.by))].flatMap((id) => changeById(this.sql, id) ?? []);
    const holders = [...new Set(conflicts.filter((c) => c.kind === "leased").map((c) => c.by))];
    const granted = starve(this.sql, req, conflicts, at);
    this.feed.emit({
      t: "conflict",
      agent: req.agent,
      kind: req.kind,
      owner: req.owner ?? null,
      life: req.life,
      change: req.id,
      intent: req.intent,
      base: req.base,
      keys: conflicts.map((c) => c.key),
      winners: [
        ...winners.map((w) => ({ agent: w.agent, change: w.id, intent: w.intent, version: w.version })),
        ...holders.map((agent) => ({ agent, change: "", intent: "", version: null })),
      ],
      ...(granted.length ? { leased: granted } : {}),
      issue: req.issue ?? null,
      at,
    });
    return { status: "conflict", id: req.id, conflicts, winners };
  }

  private reject(req: ChangeRequest, error: string): SubmitResult {
    const at = Date.now();
    record(this.sql, { ...about(req), status: "rejected", version: null, commit: null, overlaps: [], at });
    this.feed.emit({ t: "rejected", agent: req.agent, kind: req.kind, owner: req.owner ?? null, life: req.life, change: req.id, error, issue: req.issue ?? null, at });
    return { status: "rejected", id: req.id, error };
  }

  /** Builds the commit for the tip and queues its new objects for R2 and,
   *  when there is one, the Artifacts mirror. */
  private commitTip(version: number, objects: GitObject[], root: string, c: Landing, soft: Overlap[], parent: string | null): Head {
    const made = landingCommit(version, root, c, soft, parent);
    // Objects a recent version already made are published already.
    const all = [...new Map([...objects, made].map((o) => [o.sha, o])).values()];
    const fresh = unseen(this.sql, all.map((o) => o.sha));
    const rows = all.filter((o) => fresh.has(o.sha)).map((o) => [version, o.sha, buffer(o.raw)]);
    const at = Date.now();
    add(this.sql, PENDING, rows.map((r) => [...r, at]));
    if (this.meta<Mirror>("mirror") !== undefined) add(this.sql, OUTBOX, rows);
    put(this.sql, VERSIONS, String(version), [version, made.sha, root]);
    const head = { version, commit: made.sha, tree: root };
    setMeta(this.sql, "tip", head);
    return head;
  }

  /** Publishes pending objects to R2, one pack per batch, one drain at a time. */
  private upload(): Promise<void> {
    const trunk = this.meta<string>("trunk");
    if (!trunk) return Promise.resolve();
    this.uploading ??= this.publisher.drain(trunk).catch(async (error) => {
      await this.wake(Date.now() + 5_000);
      throw error;
    }).finally(() => {
      this.uploading = null;
    });
    return this.uploading;
  }

  /** Waits until `version` is published, and no longer: under a steady load
   *  the publisher never runs dry, so waiting for it to finish could take as
   *  long as the load lasts. */
  private async publishedThrough(version: number) {
    for (let i = 0; (this.meta<Head>("published")?.version ?? 0) < version; i++) {
      if (i > 1000) throw new Error(`v${version} landed but could not be published`);
      await Promise.race([this.upload(), this.moved.settled]);
    }
  }

  /** Pushes landed commits to the Artifacts mirror, one push at a time; a
   *  failed push is retried from an alarm. */
  private mirrorPush(): Promise<void> {
    this.mirroring ??= this.pusher
      .pushOutbox()
      .catch(async (e) => {
        console.error(`Artifacts push failed; retrying in 5s: ${e instanceof Error ? e.message : String(e)}`);
        await this.wake(Date.now() + 5_000);
      })
      .finally(() => {
        this.mirroring = null;
      });
    return this.mirroring;
  }

  /** Sets the alarm for `at`, unless it is already set for sooner. */
  private async wake(at: number) {
    const set = await this.ctx.storage.getAlarm();
    if (set === null || set <= Date.now() || at < set) await this.ctx.storage.setAlarm(at);
  }

  private meta<T>(k: string): T | undefined {
    return getMeta<T>(this.sql, k);
  }

  private packer() {
    return this.env.PACKER.get(this.env.PACKER.idFromName(this.meta<string>("trunk") ?? ""));
  }
}

const about = (req: ChangeRequest) => ({ id: req.id, agent: req.agent, intent: req.intent, base: req.base });

/** The most bytes of objects handed back with one landing. A change in a
 *  very big directory hands back none, and its agent reads them from R2. */
const MADE_BYTES = 64 * 1024;

function handBack(tree: string, objects: { sha: string; raw: Uint8Array }[]): Made {
  let bytes = 0;
  for (const o of objects) bytes += o.raw.length;
  return { tree, objects: bytes <= MADE_BYTES ? objects.map((o) => ({ sha: o.sha, raw: o.raw })) : [] };
}
const union = (a: Set<string>, b: Set<string>) => new Set([...a, ...b]);
const buffer = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

/** A promise settled from outside, once. */
function signal() {
  let fire!: () => void;
  const settled = new Promise<void>((resolve) => (fire = resolve));
  return { settled, fire };
}
