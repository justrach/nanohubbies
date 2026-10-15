import { DurableObject } from "cloudflare:workers";
import { loadSubmission, matches, saveSubmission } from "./agent/submissions";
import { isCode, symbols } from "./footprint";
import { isDir, readTree, text, type TreeEntry } from "./git";
import { laneFor } from "./lane";
import { ObjectReader } from "./objects";
import { key, type AgentKind, type ChangeRequest, type Edit, type Head, type Owner, type Pushed, type SubmitResult, type Submitted } from "./types";

/** `issue` names the issue a change works on; `closes` says landing it
 *  finishes that issue. `pushed` is the commit git pushed, if it came that way. */
export interface SubmitOptions {
  /** Pins a retry to its original life, even if a newer life has started. */
  life?: number;
  issue?: number | null;
  closes?: boolean;
  pushed?: Pushed | null;
}

interface Life {
  trunk: string;
  agent: string;
  kind: AgentKind;
  owner: Owner | null;
  life: number;
  base: number;
  commit: string;
  tree: string;
  submitted: boolean;
  /** The version the agent's last change landed as; its next life starts no earlier. */
  landed?: number;
  /** That version, when the agent holds the objects its change made there. */
  own?: Head;
}

/** How a life ended. A conflict ends a life but not the agent: it re-plans in
 *  a new life that inherits the winning change as context. */
export type Outcome = "settled" | "reborn" | "stillborn" | "unpaid";

/** One agent's workspace on one trunk. Each attempt at a change is a life: a
 *  fixed snapshot of the trunk plus a record of everything the agent read from
 *  it. The sequencer checks a change against that record, so a footprint is
 *  what the agent was seen to read, not what it claims. Agents only read
 *  immutable objects, so any number run at once without touching the trunk's
 *  state, and an agent's object cache stays warm from one life to the next. */
export class Agent extends DurableObject<Env> {
  private sql: SqlStorage;
  private reader: ObjectReader | null = null;
  private cached: Life | null = null;
  /** The life whose version is known to be published, so reads can begin. */
  private readable = 0;
  private submitting: Promise<SubmitResult> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS reads (key TEXT PRIMARY KEY, strong INTEGER NOT NULL)");
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS lives (life INTEGER PRIMARY KEY, base INTEGER NOT NULL, change TEXT, outcome TEXT, version INTEGER, at INTEGER NOT NULL)",
    );
  }

  /** Starts a new life on the trunk's newest version, never older than the
   *  agent's own last landing. A previous life that never submitted a change
   *  ends unpaid. */
  async start(trunk: string, agent: string, kind: AgentKind = "agent", owner: Owner | null = null): Promise<{ life: number; base: number; commit: string }> {
    // The agent's lane knows the newest version from its last batch, so most
    // lives start without a call to the sequencer. A real agent's life goes
    // to the room with the lane's next batch; scripted agents are counted
    // from their outcomes, so theirs go unannounced.
    const prev = this.loaded();
    const life = (prev?.life ?? 0) + 1;
    const announce = kind === "agent" ? { agent, kind, owner, life, at: Date.now() } : null;
    const head = await laneFor(this.env, trunk, agent).startLife(trunk, announce, prev?.landed ?? 0, prev?.own ?? null);
    return this.begin(trunk, agent, kind, owner, head);
  }

  /** A change pushed with git: a life on the version the pushed commits build
   *  on, submitted at once. The agent read outside this object, so only what
   *  it wrote can conflict. */
  async pushed(trunk: string, agent: string, owner: Owner | null, base: Head, intent: string, edits: Edit[], opts: SubmitOptions): Promise<SubmitResult> {
    await this.begin(trunk, agent, "agent", owner, base);
    return this.submit(intent, edits, opts);
  }

  private async begin(trunk: string, agent: string, kind: AgentKind, owner: Owner | null, head: Head) {
    const prev = this.loaded();
    const pending = prev && loadSubmission(this.sql, prev.life);
    if (pending && !pending.result) throw new Error("the current life has an unresolved submission; retry it before starting another life");
    if (prev && !prev.submitted) this.sql.exec("UPDATE lives SET outcome = 'unpaid' WHERE life = ?", prev.life);
    const life = (prev?.life ?? 0) + 1;
    const at = Date.now();
    this.sql.exec("DELETE FROM reads");
    this.sql.exec("INSERT INTO lives (life, base, at) VALUES (?, ?, ?)", life, head.version, at);
    this.sql.exec("DELETE FROM lives WHERE life <= ?", life - 100);
    this.save({ trunk, agent, kind, owner, life, base: head.version, commit: head.commit, tree: head.tree, submitted: false, landed: prev?.landed, own: prev?.own });
    // A newer version can be in packs this reader has not seen.
    this.reader?.stale();
    return { life, base: head.version, commit: head.commit };
  }

  async ls(dir: string) {
    const entry = dir ? await this.resolve(dir) : { mode: "40000", name: "", sha: this.life().tree };
    if (!entry || !isDir(entry)) throw new Error(`no such directory: ${dir}`);
    const entries = readTree(await this.body(entry.sha, "tree"));
    return { dir, entries: entries.map((e) => ({ name: e.name, type: isDir(e) ? "dir" : "file" })) };
  }

  /** A whole file. The agent sees every symbol in it but may depend on few
   *  of them, so its reads of those symbols are weak. */
  async file(path: string) {
    const found = await this.fileIfAny(path);
    if (!found) throw new Error(`no such file: ${path}`);
    return found;
  }

  /** Like `file`, but null when the file does not exist. The read is still
   *  recorded: the agent may rely on the file not being there. */
  async fileIfAny(path: string) {
    this.saw(key.path(path), true);
    const entry = await this.resolve(path);
    if (!entry || isDir(entry)) return null;
    const src = text(await this.body(entry.sha, "blob"));
    const syms = symbols(path, src);
    for (const s of syms) this.saw(key.def(path, s.name), false);
    return { path, text: src, symbols: syms.map((s) => ({ name: s.name, kind: s.kind, line: s.line })) };
  }

  /** One symbol. Recorded even when it is missing, because an agent can rely
   *  on a symbol not existing yet. */
  async symbol(path: string, name: string) {
    this.saw(key.path(path), true);
    this.saw(key.def(path, name), true);
    const found = symbols(path, await this.read(path)).find((s) => s.name === name);
    if (!found) throw new Error(`${path} has no symbol ${name}`);
    return { path, name, kind: found.kind, text: found.text };
  }

  /** Every top-level symbol that uses `name`. */
  async refs(name: string) {
    this.saw(key.refs(name), true);
    const hits: { path: string; symbol: string }[] = [];
    for (const path of await this.paths()) {
      if (!isCode(path)) continue;
      for (const s of symbols(path, await this.read(path))) if (s.refs.has(name)) hits.push({ path, symbol: s.name });
    }
    return { name, hits };
  }

  /** Submits the life's change. `issue` names the issue it works on; `closes`
   *  says landing it finishes that issue. */
  async submit(intent: string, edits: Edit[], opts: SubmitOptions = {}): Promise<SubmitResult> {
    const life = this.life();
    if (opts.life !== undefined && opts.life !== life.life) throw new Error("submission belongs to a different life");
    const saved = loadSubmission(this.sql, life.life);
    if (saved) {
      if (!matches(saved.request, intent, edits, opts)) throw new Error("this life already submitted a different request");
      if (saved.result) return saved.result;
      return this.dispatch(life, saved.request);
    }
    if (life.submitted) throw new Error("this life predates retry receipts; inspect its recorded outcome");
    const rows = this.sql.exec<{ key: string; strong: number }>("SELECT key, strong FROM reads").toArray();
    const request: ChangeRequest = {
      id: `c${crypto.randomUUID().replaceAll("-", "")}`,
      agent: life.agent,
      kind: life.kind,
      owner: life.owner ?? null,
      life: life.life,
      intent,
      base: life.base,
      issue: opts.issue ?? null,
      closes: !!opts.closes && opts.issue != null,
      reads: { strong: rows.filter((r) => r.strong).map((r) => r.key), weak: rows.filter((r) => !r.strong).map((r) => r.key) },
      edits,
      pushed: opts.pushed ?? null,
    };
    saveSubmission(this.sql, request, null);
    this.save({ ...life, submitted: true });
    return this.dispatch(life, request);
  }

  /** The current life's submission as a client may see it: its change ID and
   *  its decision, never the saved request. No ID when the life has not
   *  submitted; no decision while its answer is lost (send it again). */
  submission(pinned?: number): { life: number; id: string | null; result: SubmitResult | null } {
    const life = this.current(pinned);
    const saved = life && loadSubmission(this.sql, life.life);
    return { life: life?.life ?? 0, id: saved?.request.id ?? null, result: saved?.result ?? null };
  }

  /** The current life's submission, decided. One whose answer was lost is
   *  sent again, as the same request, so the sequencer replays its decision
   *  if it made one. Null when the life has not submitted. */
  async settle(pinned?: number): Promise<SubmitResult | null> {
    const life = this.current(pinned);
    const saved = life && loadSubmission(this.sql, life.life);
    if (!life || !saved) return null;
    return saved.result ?? this.dispatch(life, saved.request);
  }

  /** Who started the current life, when a signed-in person did. */
  owner(): Owner | null {
    return this.loaded()?.owner ?? null;
  }

  /** The current life. A caller that names another one is refused, so a
   *  stale retry or status never reaches a newer life. */
  private current(pinned?: number): Life | null {
    const life = this.loaded();
    if (pinned !== undefined && pinned !== (life?.life ?? 0)) {
      throw new Error(`life ${pinned} is not the current life (${life?.life ?? 0}): only the current life's submission is retried or reported`);
    }
    return life;
  }

  private dispatch(life: Life, request: ChangeRequest): Promise<SubmitResult> {
    this.submitting ??= this.sendSubmission(life, request).finally(() => { this.submitting = null; });
    return this.submitting;
  }

  private async sendSubmission(life: Life, request: ChangeRequest): Promise<SubmitResult> {
    const submitted: Submitted = await laneFor(this.env, life.trunk, life.agent).submit(life.trunk, request);
    if (submitted.status === "busy") {
      // Not admitted: the trunk stored nothing, and neither does this life,
      // which can submit again.
      this.sql.exec("DELETE FROM meta WHERE k = 'submission'");
      this.save({ ...this.life(), submitted: false });
      return submitted;
    }
    // What the landing made stays here, for the next life to start on and
    // read at once. It is this object's alone, so it goes no further.
    const made = submitted.made;
    delete submitted.made;
    const result: SubmitResult = submitted;
    if (result.status === "landed") {
      if (made) this.objects(life).hold(made.objects);
      this.save({ ...this.life(), landed: result.version, own: made?.objects.length ? { version: result.version, commit: result.commit, tree: made.tree } : undefined });
    }
    const outcome: Outcome = result.status === "landed" ? "settled" : result.status === "conflict" ? "reborn" : "stillborn";
    this.sql.exec(
      "UPDATE lives SET change = ?, outcome = ?, version = ? WHERE life = ?",
      request.id,
      outcome,
      result.status === "landed" ? result.version : null,
      life.life,
    );
    saveSubmission(this.sql, request, result);
    return result;
  }

  /** Presence for the room: what the agent is doing right now. */
  async status(intent: string, progress = "") {
    const life = this.life();
    await this.room(life.trunk).publish([{ t: "status", agent: life.agent, intent: intent.slice(0, 512), progress: progress.slice(0, 256), at: Date.now() }]);
  }

  /** The current life and the outcomes of recent ones, newest first. */
  info() {
    const life = this.loaded();
    const lives = this.sql
      .exec<{ life: number; base: number; change: string | null; outcome: string | null; version: number | null; at: number }>(
        "SELECT * FROM lives ORDER BY life DESC LIMIT 20",
      )
      .toArray();
    return {
      agent: life?.agent ?? null,
      kind: life?.kind ?? null,
      owner: life?.owner ?? null,
      life: life?.life ?? 0,
      base: life?.base ?? null,
      submitted: life?.submitted ?? null,
      lives,
    };
  }

  private saw(k: string, strong: boolean) {
    this.sql.exec(
      "INSERT INTO reads (key, strong) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET strong = max(strong, excluded.strong)",
      k,
      strong ? 1 : 0,
    );
  }

  private async read(path: string): Promise<string> {
    const entry = await this.resolve(path);
    if (!entry || isDir(entry)) throw new Error(`no such file: ${path}`);
    return text(await this.body(entry.sha, "blob"));
  }

  private async resolve(path: string): Promise<TreeEntry | null> {
    let dir = this.life().tree;
    const parts = path.split("/").filter(Boolean);
    for (const [i, part] of parts.entries()) {
      const entry = readTree(await this.body(dir, "tree")).find((e) => e.name === part);
      if (!entry || i === parts.length - 1) return entry ?? null;
      if (!isDir(entry)) return null;
      dir = entry.sha;
    }
    return null;
  }

  private async paths(dir = this.life().tree, prefix = ""): Promise<string[]> {
    const out: string[] = [];
    for (const e of readTree(await this.body(dir, "tree"))) {
      if (isDir(e)) out.push(...(await this.paths(e.sha, `${prefix}${e.name}/`)));
      else out.push(prefix + e.name);
    }
    return out;
  }

  /** An object's body. Objects never change, so the reader's cache never goes stale. */
  private async body(sha: string, type: string): Promise<Uint8Array> {
    const life = this.life();
    const objects = this.objects(life);
    // What the agent's own landing made is here already. Anything else may
    // be in a version still being published: the life's first read of it
    // waits until the version's objects are all in R2.
    let obj = objects.held(sha) ?? null;
    if (!obj) {
      if (this.readable !== life.life) {
        await laneFor(this.env, life.trunk, life.agent).published(life.trunk, life.base);
        this.readable = life.life;
      }
      obj = await objects.get(sha);
    }
    if (!obj) throw new Error(`missing object ${sha}`);
    if (obj.type !== type) throw new Error(`object ${sha} is a ${obj.type}, not a ${type}`);
    return obj.body;
  }

  private objects(life: Life): ObjectReader {
    const lane = laneFor(this.env, life.trunk, life.agent);
    return (this.reader ??= new ObjectReader(this.env.OBJECTS, life.trunk, () => lane.packs(life.trunk, this.life().base)));
  }

  private life(): Life {
    const life = this.loaded();
    if (!life) throw new Error("this agent has no life yet; start one first");
    return life;
  }

  private loaded(): Life | null {
    if (!this.cached) {
      const row = this.sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = 'life'").toArray()[0];
      this.cached = row ? (JSON.parse(row.v) as Life) : null;
    }
    return this.cached;
  }

  private save(life: Life) {
    this.sql.exec("INSERT INTO meta (k, v) VALUES ('life', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", JSON.stringify(life));
    this.cached = life;
  }

  private room(trunk: string) {
    return this.env.ROOM.get(this.env.ROOM.idFromName(trunk));
  }
}
