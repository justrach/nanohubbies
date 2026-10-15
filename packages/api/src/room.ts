import { DurableObject } from "cloudflare:workers";
import type { SwarmPlan } from "./driver";
import * as channel from "./room/channel";
import { refreshContext } from "./room/github-context";
import * as board from "./room/issues";
import { RoomAccess } from "./room/access";
import * as registry from "./room/registry";
import { getMeta, migrate, setMeta, type Sequenced, type Snapshot, type SwarmState } from "./room/store";
import { clashes, fold, hot, people, totals } from "./room/tallies";
import type { AgentKind, Issue, Owner, RepoInfo, RoomEvent } from "./types";

export type { AgentState, Person, Snapshot, SwarmState, Totals } from "./room/store";

const KEEP_EVENTS = 2000;
const KEEP_SECONDS = 900;
const SNAPSHOT_EVENTS = 200;
/** Watchers get events in frames, not one message per event. */
const FRAME_MS = 250;
/** Scripted agents per driver object. */
const PER_DRIVER = 50;
/** A script that says it is watching stays listed this long without another heartbeat. */
const BEAT_MS = 60_000;

/** A trunk's room: who is here and what they are doing, a running tally of how
 *  lives end, the trunk's issues and channel, and a live feed of all of it for
 *  anyone watching. It is a view of the trunk; losing it loses no trunk state.
 *  The work is in ./room/: the tables, the tallies, the issues, the channel. */
export class Room extends DurableObject<Env> {
  private sql: SqlStorage;
  private frame: Sequenced[] = [];
  private access: RoomAccess;
  private broadcasts: Promise<void> = Promise.resolve();
  private frameTimer: ReturnType<typeof setTimeout> | null = null;
  /** People watching from scripts, by id, with when their heartbeat lapses. */
  private beats = new Map<string, { who: Owner; until: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    migrate(this.sql);
    this.access = new RoomAccess(env, this.sql, ctx);
  }

  /** Folds a batch of events into the agents' states and the tallies, keeps
   *  them for replay, and sends them to everyone watching. */
  publish(events: RoomEvent[]) {
    const sum = fold(this.sql, events, {
      workedOn: (number, agent, owner, change, version, outcome, at, closes) => board.workedOn(this.sql, this.emit, number, agent, owner, change, version, outcome, at, closes),
      mention: (e) => channel.mention(this.sql, this.emit, e),
      emit: this.emit,
    });
    setMeta(this.sql, "totals", sum);
    this.trim();
  }

  snapshot(): Snapshot {
    type Row = { name: string; kind: AgentKind; state: Snapshot["agents"][number][2]; life: number; seen: number; landed: number; conflicts: number; intent: string; owner_name: string | null; issue: number | null };
    const agents = this.sql
      .exec<Row>("SELECT name, kind, state, life, seen, landed, conflicts, intent, owner_name, issue FROM agents ORDER BY owner_name, name LIMIT 20000")
      .toArray()
      .map((a) => [a.name, a.kind, a.state, a.life, a.seen, a.landed, a.conflicts, a.intent, a.owner_name, a.issue] as Snapshot["agents"][number]);
    const events = this.sql
      .exec<{ seq: number; body: string }>("SELECT seq, body FROM events ORDER BY seq DESC LIMIT ?", SNAPSHOT_EVENTS)
      .toArray()
      .reverse()
      .map((r) => ({ ...(JSON.parse(r.body) as RoomEvent), seq: r.seq }));
    const seconds = this.sql
      .exec<{ sec: number; landed: number; conflicts: number; rejected: number }>("SELECT * FROM seconds ORDER BY sec DESC LIMIT 300")
      .toArray()
      .reverse()
      .map((s) => [s.sec, s.landed, s.conflicts, s.rejected] as [number, number, number, number]);
    return {
      roster: registry.roster(this.sql),
      totals: totals(this.sql),
      agents,
      events,
      seconds,
      messages: channel.messages(this.sql, 0, null, 50),
      swarms: this.swarms(),
      hot: hot(this.sql),
      people: people(this.sql),
      clashes: clashes(this.sql),
      issues: board.listIssues(this.sql),
      repo: getMeta<RepoInfo>(this.sql, "repo") ?? null,
      watchers: this.watchers(),
      now: Date.now(),
    };
  }

  // ---- the channel ----

  post(from: string, body: string, context: { replyTo?: number; handoffTo?: string } = {}): RoomEvent {
    return channel.post(this.sql, this.emit, from, body, context);
  }

  registerAgent(owner: Owner, handle: string, type: string) {
    const agent = registry.register(this.sql, owner, handle, type);
    this.scheduleFrame();
    return agent;
  }
  registeredAgent(handle: string) { return registry.lookup(this.sql, handle); }
  roster() { return registry.roster(this.sql); }
  agentAllowed(handle: string, id?: string) {
    const agent = registry.lookup(this.sql, handle);
    return agent ? agent.id === id : !id;
  }
  agentHeartbeat(handle: string, status: registry.Presence, task: string, progress: string) {
    const agent = registry.heartbeat(this.sql, handle, status, task, progress);
    this.scheduleFrame();
    return agent;
  }
  acknowledgeMessage(id: number, handle: string) { return channel.acknowledge(this.sql, this.emit, id, handle); }

  messages(after = 0, forAgent: string | null = null, limit = 100): RoomEvent[] {
    return channel.messages(this.sql, after, forAgent, limit);
  }

  // ---- issues ----

  importRepo(repo: RepoInfo, issues: Parameters<typeof board.importRepo>[2]) {
    board.importRepo(this.sql, repo, issues);
  }

  refreshGitHubContext(repo: RepoInfo, issues: Parameters<typeof board.importRepo>[2], notes: string[]) {
    const result = this.ctx.storage.transactionSync(() => refreshContext(this.sql, repo, issues, notes));
    const frame = JSON.stringify({ type: "snapshot", ...this.snapshot() });
    this.broadcasts = this.broadcasts.then(async () => {
      await Promise.all(this.ctx.getWebSockets().map(async (ws) => {
        if (!await this.access.check(ws)) return;
        try { ws.send(frame); } catch { /* closed */ }
      }));
    }).catch(() => {});
    return result;
  }

  /** The GitHub repository the trunk was imported from, if it was. */
  repo(): RepoInfo | null {
    return getMeta<RepoInfo>(this.sql, "repo") ?? null;
  }

  openIssue(title: string, body: string, author: string, labels: Issue["labels"] = []): Issue {
    return board.openIssue(this.sql, this.emit, title, body, author, labels);
  }

  issues(): Issue[] {
    return board.listIssues(this.sql);
  }

  issue(number: number) {
    return board.issueDetail(this.sql, number);
  }

  agenda(limit = 50) {
    return board.agenda(this.sql, limit);
  }

  hold(agent: string, number: number): Issue | null {
    return board.hold(this.sql, this.emit, agent, number);
  }

  claim(agent: string, owner: string | null, cap: number) {
    return board.claim(this.sql, agent, owner, cap);
  }

  // ---- swarms ----

  /** Starts a person's scripted agents on the trunk, split across driver
   *  objects. Several people can each run a swarm at once. */
  async startSwarm(
    trunk: string,
    who: Owner,
    opts: { agents: number; seconds: number; shared: number; skew: number; think: [number, number] },
  ): Promise<SwarmState> {
    const mine = this.swarms().find((s) => s.owner.id === who.id);
    if (mine?.running) throw new Error(`${who.name} already has a swarm running on this trunk`);
    const targets = await this.env.SEQUENCER.get(this.env.SEQUENCER.idFromName(trunk)).targets(200);
    if (!targets.length) throw new Error("the trunk has no JavaScript functions for agents to share");
    const agents = Math.max(1, Math.min(20_000, Math.floor(opts.agents)));
    const drivers = Math.ceil(agents / PER_DRIVER);
    const started = Date.now();
    const until = started + Math.max(5, Math.min(3600, opts.seconds)) * 1000;
    const prefix = this.prefixFor(who);
    await Promise.all(
      Array.from({ length: drivers }, (_, d) => {
        const bots = Array.from({ length: Math.min(PER_DRIVER, agents - d * PER_DRIVER) }, (_, i) => `${prefix}-${String(d * PER_DRIVER + i).padStart(4, "0")}`);
        const plan: SwarmPlan = { trunk, owner: who, bots, until, shared: opts.shared, skew: opts.skew, think: opts.think, targets };
        return this.driver(trunk, who, d).start(plan);
      }),
    );
    this.sql.exec(
      `INSERT OR REPLACE INTO swarms (owner_id, owner_name, prefix, agents, drivers, shared, started, until) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      who.id,
      who.name,
      prefix,
      agents,
      drivers,
      opts.shared,
      started,
      until,
    );
    this.publish([{ t: "swarm", state: "running", agents, owner: who, at: started }]);
    return this.swarms().find((s) => s.owner.id === who.id)!;
  }

  /** Stops one person's swarm, or every swarm when `ownerId` is null. */
  async stopSwarm(trunk: string, ownerId: string | null): Promise<SwarmState[]> {
    const stopping = this.swarms().filter((s) => s.running && (ownerId === null || s.owner.id === ownerId));
    for (const s of stopping) {
      await Promise.all(Array.from({ length: s.drivers }, (_, d) => this.driver(trunk, s.owner, d).stop()));
      this.sql.exec("UPDATE swarms SET until = ? WHERE owner_id = ?", Date.now(), s.owner.id);
      this.publish([{ t: "swarm", state: "stopped", agents: s.agents, owner: s.owner, at: Date.now() }]);
    }
    return this.swarms();
  }

  restrictTeam(trunk: string) { this.access.restrict(trunk); }

  // ---- watchers ----

  /** A script (or a tab that cannot hold a socket) says someone is watching. */
  heartbeat(who: Owner) {
    const fresh = !this.beats.has(who.id);
    this.beats.set(who.id, { who, until: Date.now() + BEAT_MS });
    if (fresh) this.scheduleFrame();
    return { watchers: this.watchers() };
  }

  /** Forgets everything, for a deleted trunk. */
  async reset() {
    for (const ws of this.ctx.getWebSockets()) ws.close(1001, "trunk deleted");
    await this.ctx.storage.deleteAll();
    migrate(this.sql);
  }

  /** The live feed: a snapshot first, then frames of new events. The Worker
   *  passes the signed-in person, if any, so the room knows who is watching. */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected a websocket upgrade", { status: 426 });
    const who = parseOwner(request.headers.get("X-Swarm-User"));
    const identity = this.access.fromRequest(request, who);
    if (!await this.access.allowed(identity)) return new Response("Workspace access unavailable", { status: 403 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(identity);
    server.send(JSON.stringify({ type: "snapshot", ...this.snapshot() }));
    this.scheduleFrame();
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Watchers can talk in the channel: {"type":"post","body":"…"}. A signed-in
   *  watcher posts as themselves; anyone else posts as a guest. */
  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    try {
      const msg = JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data)) as { type?: string; body?: string };
      if (!await this.access.check(ws)) return;
      const who = this.access.attachment(ws).who;
      if (msg.type === "post" && msg.body) this.post(who ? `person:${who.name}` : "guest", String(msg.body));
    } catch {
      // A malformed frame from a watcher is ignored, not fatal.
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    // 1005 and 1006 mean the watcher left without a close code; they cannot be
    // sent back, and a socket that is already gone cannot be closed again.
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    } catch {
      // Nothing to close.
    }
    this.scheduleFrame();
  }

  // ---- internals ----

  /** Adds an event to the feed: kept for replay, sent in the next frame. */
  private emit = (e: RoomEvent) => {
    const seq = this.sql.exec<{ seq: number }>("INSERT INTO events (body) VALUES (?) RETURNING seq", JSON.stringify(e)).one().seq;
    this.frame.push({ ...e, seq });
    this.scheduleFrame();
  };

  private scheduleFrame() {
    this.frameTimer ??= setTimeout(() => this.sendFrame(), FRAME_MS);
  }

  /** One frame: new events plus the small things that change often. */
  private sendFrame() {
    this.frameTimer = null;
    const events = this.frame.splice(0);
    const frame = JSON.stringify({
      type: "events",
      roster: registry.roster(this.sql),
      events,
      totals: totals(this.sql),
      swarms: this.swarms(),
      hot: hot(this.sql),
      people: people(this.sql),
      clashes: clashes(this.sql),
      watchers: this.watchers(),
      now: Date.now(),
    });
    // Serialize broadcasts so slow provider checks cannot reorder messages.
    this.broadcasts = this.broadcasts.then(async () => {
      await Promise.all(this.ctx.getWebSockets().map(async (ws) => {
        if (!await this.access.check(ws)) return;
        try { ws.send(frame); } catch { /* already closed */ }
      }));
    }).catch(() => {});
  }

  private watchers(): Owner[] {
    const now = Date.now();
    const out = new Map<string, Owner>();
    for (const ws of this.ctx.getWebSockets()) {
      const who = this.access.attachment(ws).who;
      if (who) out.set(who.id, who);
    }
    for (const [id, b] of this.beats) {
      if (b.until < now) this.beats.delete(id);
      else out.set(id, b.who);
    }
    return [...out.values()];
  }

  private swarms(): SwarmState[] {
    const now = Date.now();
    return this.sql
      .exec<{ owner_id: string; owner_name: string; prefix: string; agents: number; drivers: number; shared: number; started: number; until: number }>(
        "SELECT * FROM swarms ORDER BY started",
      )
      .toArray()
      .map((s) => ({
        owner: { id: s.owner_id, name: s.owner_name },
        prefix: s.prefix,
        running: s.until > now,
        agents: s.agents,
        drivers: s.drivers,
        shared: s.shared,
        started: s.started,
        until: s.until,
      }));
  }

  /** Bot names start with their owner's name, kept unique on the trunk. */
  private prefixFor(who: Owner): string {
    const mine = this.sql.exec<{ prefix: string }>("SELECT prefix FROM swarms WHERE owner_id = ?", who.id).toArray()[0];
    const reserved = registry.roster(this.sql).map((a) => a.handle);
    if (mine && !reserved.some((h) => h.startsWith(`${mine.prefix}-`))) return mine.prefix;
    const base = who.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20) || "bot";
    const taken = new Set(this.sql.exec<{ prefix: string }>("SELECT prefix FROM swarms").toArray().map((r) => r.prefix));
    let prefix = base;
    for (let n = 2; taken.has(prefix) || reserved.some((h) => h.startsWith(`${prefix}-`)); n++) prefix = `${base}${n}`;
    return prefix;
  }

  private trim() {
    this.sql.exec("DELETE FROM events WHERE seq <= (SELECT MAX(seq) FROM events) - ?", KEEP_EVENTS);
    this.sql.exec("DELETE FROM seconds WHERE sec < ?", Math.floor(Date.now() / 1000) - KEEP_SECONDS);
  }

  private driver(trunk: string, who: Owner, index: number) {
    return this.env.DRIVER.get(this.env.DRIVER.idFromName(`${trunk}#${who.id}#${index}`));
  }
}

function parseOwner(header: string | null): Owner | null {
  if (!header) return null;
  try {
    const o = JSON.parse(header) as Owner;
    return typeof o?.id === "string" && typeof o?.name === "string" ? { id: o.id, name: o.name } : null;
  } catch {
    return null;
  }
}
