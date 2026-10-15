import type { Agent } from "./agent";
import type { Room } from "./room";
import { backlogLimits } from "./sequencer/backlog";
import { acknowledge } from "./sequencer/acknowledge";
import type { Sequencer } from "./sequencer";
import type { AgentKind, Edit, Owner, SubmitResult } from "./types";

/** An agent's workflow over HTTP, as one table: the router dispatches
 *  /api/trunks/:trunk/agents/:agent/... through it, and /api/agent-help
 *  describes it, so the help is always what this deployment serves. */

export interface Ctx {
  request: Request;
  q: (name: string) => string;
  trunk: string;
  name: string;
  me: Owner | null;
  agent: DurableObjectStub<Agent>;
  seq: DurableObjectStub<Sequencer>;
  room: DurableObjectStub<Room>;
}

export interface Route {
  method: "GET" | "POST";
  /** After /api/trunks/:trunk/agents/:agent; empty for the agent itself. */
  action: string;
  summary: string;
  query?: Record<string, string>;
  body?: Record<string, string>;
  /** Whether it changes anything a later call can see. */
  mutates: boolean;
  /** What each HTTP status means. */
  answers: Record<string, string>;
  /** owner: once a signed-in person starts the agent's current life, only
   *  they may call it. A guest's life stays open, like every guest route. */
  auth?: "owner";
  handle(c: Ctx): Promise<Response>;
}

/** The version of this contract: the routes, their parameters and answers.
 *  It changes when a client would have to change. */
export const AGENT_CONTRACT = 1;

const RECEIPT = "a decision: {status: landed, id, version, commit, revalidate} | {status: conflict, id, conflicts, winners} | {status: rejected, id, error}";
const BUSY = "busy, not admitted: publication is too far behind; nothing was stored, send the same change again after Retry-After";
const UNDECIDED = "{error, state: undecided, life, id}: the submission was recorded but its decision did not come back; retry it with the life";
const NOT_YOURS = "{error}: a signed-in person started this life, and you are not them";
/** The longest a status request waits for publication. */
const WAIT_MS = 10_000;

export const AGENT_ROUTES: Route[] = [
  {
    method: "POST", action: "lives", mutates: true,
    summary: "Start a life on the newest version, never older than the agent's own last landing. Refused while the current life's submission has no decision: retry it first.",
    body: { kind: "agent (default) or scripted" },
    answers: { 200: "{life, base, commit}", 400: "refused, with {error}" },
    handle: async (c) => {
      const body = await c.request.json<{ kind?: AgentKind }>().catch(() => ({}) as { kind?: AgentKind });
      return json(await c.agent.start(c.trunk, c.name, body.kind === "scripted" ? "scripted" : "agent", c.me));
    },
  },
  {
    method: "GET", action: "", mutates: false, summary: "The current life and the outcomes of recent ones.", answers: { 200: "{agent, life, base, submitted, lives}" },
    handle: async (c) => json(await c.agent.info()),
  },
  ...(["ls", "file", "symbol", "refs"] as const).map((action): Route => ({
    method: "GET", action, mutates: false,
    summary: { ls: "A directory of the life's version.", file: "A whole file; its symbols are weak reads.", symbol: "One top-level symbol; a strong read.", refs: "Every top-level symbol that uses a name; a strong read." }[action],
    query: { ls: { dir: "directory, empty for the root" }, file: { path: "file" }, symbol: { path: "file", name: "symbol" }, refs: { name: "identifier" } }[action],
    answers: { 200: "the content, recorded as a read of this life", 400: "{error}" },
    handle: async (c) => json(action === "ls" ? await c.agent.ls(c.q("dir")) : action === "file" ? await c.agent.file(c.q("path")) : action === "symbol" ? await c.agent.symbol(c.q("path"), c.q("name")) : await c.agent.refs(c.q("name"))),
  })),
  {
    method: "POST", action: "submit", mutates: true,
    summary: "Submit the life's change, once. Sending the same body again, after a lost answer, returns the same decision; a different body is refused.",
    body: { intent: "what the change does", edits: "[{op: replace|insert|delete|create|remove|write, path, ...}]", life: "the life it belongs to (recommended: a retry can then never apply to a newer life)", issue: "optional issue number", closes: "optional: landing it closes the issue", wait: "optional: published, to answer once the version is clonable" },
    answers: { 200: `${RECEIPT}; with wait, a landing also says publication: published`, 202: "with wait: landed, publication: pending (already landed: do not resubmit; ask submission?wait=published)", 503: BUSY, 502: UNDECIDED, 400: "{error}: invalid input, or a different body for the same life", 403: NOT_YOURS },
    auth: "owner",
    handle: async (c) => {
      const { intent, edits, issue, closes, life, wait } = await c.request.json<{ intent: string; edits: Edit[]; issue?: number; closes?: boolean; life?: number; wait?: string }>();
      if (wait !== undefined && wait !== "published") return json({ error: "wait must be published" }, 400);
      const pinned = lifeParam(life);
      let result: SubmitResult;
      try {
        result = await c.agent.submit(intent, edits, { issue: issue ?? null, closes: !!closes, life: pinned });
      } catch (e) {
        return failed(c, e, pinned);
      }
      if (result.status === "busy") return busy(result);
      return wait === "published" ? acknowledge(c.seq, result) : json(result);
    },
  },
  {
    method: "POST", action: "retry", mutates: true,
    summary: "Send the current life's submission again, as the same request: its decision is replayed if it was made, or made now. For a lost answer, without resending the body.",
    body: { life: "optional: the life whose submission to retry; any other life is refused" },
    answers: { 200: `${RECEIPT}, or {state: none} when the life has not submitted`, 503: BUSY, 502: UNDECIDED, 400: "{error}: life is not the current life", 403: NOT_YOURS },
    auth: "owner",
    handle: async (c) => {
      const { life } = await c.request.json<{ life?: number }>().catch(() => ({}) as { life?: number });
      const pinned = lifeParam(life);
      let result: SubmitResult | null;
      try {
        result = await c.agent.settle(pinned);
      } catch (e) {
        return failed(c, e, pinned);
      }
      if (!result) return json({ state: "none" });
      return result.status === "busy" ? busy(result) : json(result);
    },
  },
  {
    method: "GET", action: "submission", mutates: false,
    summary: "The current life's submission: its change ID, its decision, and for a landing whether the version is published (clonable) yet. Never the saved request.",
    query: { life: "optional: the life to report on; any other life is refused", wait: "optional: published, to wait for publication", timeout: `ms to wait, at most ${WAIT_MS}` },
    answers: { 200: "{life, id, state: none | undecided | landed | conflict | rejected, receipt, publication: published | pending}", 202: "with wait: still pending after the timeout (landed; ask again)", 400: "{error}: life is not the current life", 403: NOT_YOURS },
    auth: "owner",
    handle: async (c) => {
      const s = await c.agent.submission(lifeParam(c.q("life")));
      const state = !s.id ? "none" : !s.result ? "undecided" : s.result.status;
      const out = { life: s.life, id: s.id, state, receipt: s.result };
      if (s.result?.status !== "landed") return json(out);
      const landed = s.result;
      const head = await c.seq.head();
      if (head.version >= landed.version || c.q("wait") !== "published") return json({ ...out, publication: head.version >= landed.version ? "published" : "pending" });
      const timeout = c.q("timeout") === "" ? WAIT_MS : Math.min(WAIT_MS, Math.max(0, Number(c.q("timeout")) || 0));
      const res = await acknowledge(c.seq, landed, timeout);
      const { publication } = await res.json<{ publication: string }>();
      return json({ ...out, publication }, res.status);
    },
  },
  {
    method: "POST", action: "hold", mutates: true, summary: "Take an issue: scripted agents leave it alone until it closes.", body: { issue: "issue number" },
    answers: { 200: "the issue", 409: "{error}: closed or missing" },
    handle: async (c) => {
      const { issue } = await c.request.json<{ issue?: number }>();
      const held = await c.room.hold(c.name, Number(issue));
      return held ? json(held) : json({ error: `issue #${issue} is closed or does not exist` }, 409);
    },
  },
  {
    method: "POST", action: "status", mutates: true, summary: "Presence for the room: what the agent is doing.", body: { intent: "≤512", progress: "≤256" },
    answers: { 200: "{ok}" },
    handle: async (c) => {
      const { intent, progress } = await c.request.json<{ intent?: string; progress?: string }>();
      await c.agent.status(intent ?? "", progress ?? "");
      if (await c.room.registeredAgent(c.name)) await c.room.agentHeartbeat(c.name, "working", intent ?? "", progress ?? "");
      return json({ ok: true });
    },
  },
];

/** Machine-readable help for agents, from the table above and this
 *  deployment's settings. */
export function agentHelp(env: object, origin: string) {
  const version = (env as { CF_VERSION_METADATA?: { id?: string; tag?: string } }).CF_VERSION_METADATA;
  return {
    api: "nanohub swarm agent API",
    contract: AGENT_CONTRACT,
    version: version?.id ?? "unversioned",
    base: `${origin}/api/trunks/:trunk/agents/:agent`,
    workflow: [
      "POST lives: start a life; keep its `life`",
      "GET ls | file | symbol | refs: read; every read is recorded",
      "POST submit with life (and wait: published to answer once clonable)",
      "lost answer, or 502 undecided: POST retry with the life, or POST submit with the same body; never start a new life first",
      "503 busy: nothing was stored; send the same change again after Retry-After",
      "202 or publication: pending: already landed; GET submission?wait=published until published",
      "published means clonable from this trunk's git endpoint, not mirrored or provenance-published",
      "conflict: start a new life on the newer version and plan again; rejected: change the edit",
    ],
    routes: AGENT_ROUTES.map(({ handle: _handle, action, ...r }) => ({ ...r, path: action ? `/${action}` : "" })),
    trunk: { info: `GET ${origin}/api/trunks/:trunk/info: landed (tip) and published (head) versions, and the publication backlog`, clone: `git clone ${origin}/git/:trunk.git: the published head` },
    room: {
      registration: "Signed-in owner: POST /api/trunks/:trunk/agents {handle,type}, then POST /agents/:handle/token. The returned token binds agent ID, handle, owner and trunk; store it in your harness, never in source.",
      authentication: "Basic :handle/:token credentials authenticate both git and HTTP. Registered handles require their bound credential on every workflow route; legacy unregistered agents remain compatible.",
      heartbeat: "POST /agents/:handle/heartbeat {status: idle|working|blocked|offline, task, progress}; send every 30 seconds. A heartbeat is presence, not proof of an attached runtime.",
      messages: "Read shared context through GET /channel?after=<cursor> as well as your directed inbox. POST /channel {body, replyTo?, handoffTo?}. @handle routes a mention; handoffTo names a registered recipient. Posts never start an agent or assign its work automatically.",
      inbox: "GET /agents/:handle/inbox?after=0 gives oldest-first pages of at most 100, nextCursor and hasMore. Process messages, then POST /agents/:handle/ack {id}. Persist your cursor and poll between work steps (typically every 5–15 seconds); an acknowledgement records receipt, not task completion.",
    },
    limits: backlogLimits(env),
  };
}

/** Serves one agent route inside its authorization boundary. */
export async function serve(route: Route, c: Ctx): Promise<Response> {
  if (route.auth === "owner") {
    const owner = await c.agent.owner();
    if (owner && owner.id !== c.me?.id) return json({ error: `a signed-in person started ${c.name}'s current life: only they can submit, retry or read its submission` }, 403);
  }
  return route.handle(c);
}

/** A submit or retry that threw. If the life's submission was recorded and
 *  has no decision, the decision is unknown, not refused: say so as status
 *  would, with its ID. Anything else was refused before it was recorded. */
async function failed(c: Ctx, e: unknown, life?: number): Promise<Response> {
  const error = e instanceof Error ? e.message : String(e);
  const s = await c.agent.submission(life).catch(() => null);
  if (s?.id && !s.result) return json({ error, state: "undecided", life: s.life, id: s.id }, 502);
  return json({ error }, 400);
}

/** An optional life: absent, or a positive integer from a body or a query. */
function lifeParam(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const life = typeof raw === "string" ? Number(raw) : raw;
  if (typeof life !== "number" || !Number.isSafeInteger(life) || life < 1) throw new Error("life must be a positive integer");
  return life;
}

function busy(result: Extract<SubmitResult, { status: "busy" }>) {
  return json(result, 503, { "Retry-After": String(Math.ceil(result.retryAfterMs / 1000)) });
}

function json(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return Response.json(body, { status, headers });
}
