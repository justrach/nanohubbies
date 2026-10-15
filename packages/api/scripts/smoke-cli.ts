// The nanohub CLI's swarm commands against local Workers: real SQLite DOs and
// R2 behind a proxy that can drop an answer after the server acted on it.
// Covers discovery and filtering, a lost answer and a lost lane reply
// recovered as the same decision, replay and changed-payload refusal, a
// stale life, delayed publication, and busy (not admitted) versus landed
// (publication pending). Every --json output must parse, whatever the exit.
// Build the CLI first (zig build at the repository root; NANOHUB_BIN names
// another binary). Run from packages/api: node scripts/smoke-cli.ts.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const exec = promisify(execFile);
const here = dirname(new URL(import.meta.url).pathname);
const bin = process.env.NANOHUB_BIN ?? resolve(here, "../../../../zig-out/bin/nanohub");
const dir = await mkdtemp(join(tmpdir(), "swarm-cli-"));
const trunk = "cli-smoke";
const base = `/api/trunks/${trunk}`;
// Small backlog limits, so a few changes fill it for the busy case.
const LIMITS = { PUBLISH_BACKLOG_BYTES: "6000", PUBLISH_BACKLOG_MS: "600000", CHANGE_MAX_BYTES: "1500" };
let mf: Miniflare | undefined;
let origin = "";
const servers: Server[] = [];

const bundle = await build({ entryPoints: [join(here, "receipts/worker.ts")], bundle: true, platform: "neutral", format: "esm", conditions: ["workerd", "worker", "browser"], external: ["cloudflare:workers", "node:*"], write: false });
async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(origin + path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.ok(res.ok, `${method} ${path}: HTTP ${res.status}`);
  return (await res.json()) as any;
}
const fault = (action: string, extra: object) => api("POST", `/__test/${action}`, { trunk, ...extra });
const info = () => api("GET", `${base}/info`);

function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  return new Promise((done) => server.listen(0, "127.0.0.1", () => done(`http://127.0.0.1:${(server.address() as { port: number }).port}`)));
}

// The proxy forwards everything; armed, it drops the next submit's answer
// after the server has handled the request.
let dropNextSubmit = false;
const proxy = await listen(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const upstream = await fetch(origin + req.url, { method: req.method, headers: { "content-type": "application/json" }, body: chunks.length ? Buffer.concat(chunks) : undefined });
  const body = Buffer.from(await upstream.arrayBuffer());
  if (dropNextSubmit && req.url?.endsWith("/submit")) {
    dropNextSubmit = false;
    req.socket.destroy();
    return;
  }
  const headers: Record<string, string> = { "content-type": upstream.headers.get("content-type") ?? "application/json" };
  const retryAfter = upstream.headers.get("retry-after");
  if (retryAfter) headers["retry-after"] = retryAfter;
  res.writeHead(upstream.status, headers).end(body);
});

// An older server: its help lists only some routes, or there is no help at all.
let stubHelp: object | null = null;
const stub = await listen((req, res) => {
  if (req.url === "/api/agent-help" && stubHelp) res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(stubHelp));
  else res.writeHead(404, { "content-type": "application/json" }).end('{"error":"not found"}');
});

/** Runs `nanohub swarm ... --json`; its stdout must be one JSON object. */
async function cli(args: string[], agent: string, server = proxy): Promise<{ code: number; out: any }> {
  const env = { ...process.env, NANOHUB_SWARM: server, NANOHUB_TRUNK: trunk, NANOHUB_AGENT: agent };
  let code = 0;
  let stdout = "";
  try {
    stdout = (await exec(bin, ["swarm", ...args, "--json"], { env })).stdout;
  } catch (e: any) {
    if (typeof e.code !== "number") throw e;
    code = e.code;
    stdout = e.stdout;
  }
  const lines = stdout.trim().split("\n");
  assert.equal(lines.length, 1, `one JSON line: ${stdout}`);
  const out = JSON.parse(lines[0]);
  if ("exit" in out) assert.equal(out.exit, code, "the JSON names the exit code");
  // On every result path: exit 0 means landed and published, and a landing
  // whose publication is not confirmed says pending and exits 75.
  if (["submit", "retry", "status", "wait"].includes(args[0])) {
    if (code === 0) assert.deepEqual([out.state, out.publication], ["landed", "published"], `${args[0]} exited 0 unpublished`);
    if (out.state === "landed" && out.publication !== "published") assert.deepEqual([code, out.publication], [75, "pending"]);
  }
  return { code, out };
}
async function edits(name: string, text = `${name}\n`) {
  const file = join(dir, `${name}.json`);
  await writeFile(file, JSON.stringify([{ op: "create", path: `${name}.txt`, text }]));
  return file;
}
const submitArgs = async (life: number, name: string) => ["submit", "--life", String(life), "--intent", `Add ${name}`, "--edits", await edits(name)];

/** The runtime, on persistent storage: booting again is a restart. */
async function boot() {
  await mf?.dispose();
  mf = new Miniflare({ ...convertV4MiniflareOptions({
    name: "cli-test", modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-09-01", compatibilityFlags: ["nodejs_compat"],
    durableObjects: Object.fromEntries(["Sequencer", "Agent", "Lane", "Packer", "Room", "Driver", "Hub", "Account"].map((className) => [className.toUpperCase(), { className, useSQLite: true }])),
    r2Buckets: ["OBJECTS"], d1Databases: ["AUTH_DB"], bindings: { APP_ORIGIN: "http://localhost:3000", ...LIMITS },
  }), resourcePersistencePath: join(dir, "storage"), isolatedResourcePersistencePath: join(dir, "isolated") });
  origin = (await mf.ready).origin;
}

try {
  await boot();
  await api("POST", base, { files: [{ path: "base.txt", text: "base\n" }] });

  // Discovery: the installed command table, checked against this server.
  const help = await cli(["help"], "cli");
  const served = await api("GET", "/api/agent-help");
  assert.equal(help.code, 0);
  assert.deepEqual([help.out.server.described, help.out.server.contract, help.out.server.version], [true, served.contract, served.version]);
  assert.deepEqual(help.out.commands.map((c: any) => [c.name, c.available]), ["help", "start", "submit", "retry", "status", "wait"].map((n) => [n, true]));
  assert.ok(JSON.stringify(help.out).length < 32 * 1024, "help is bounded");
  assert.ok(help.out.commands.find((c: any) => c.name === "submit").flags.some((f: any) => f.name === "--edits" && f.required));
  assert.deepEqual(help.out.exit_codes.find((e: any) => e.code === 0).name, "published");
  // An older server: no status route, and a retry that does not take life,
  // so it could reach a newer life. Both are filtered.
  stubHelp = { api: "older", version: "old", routes: [{ method: "POST", path: "/lives" }, { method: "POST", path: "/submit", body: { life: "" } }, { method: "POST", path: "/retry" }] };
  const older = await cli(["help"], "cli", stub);
  assert.deepEqual([older.out.commands.map((c: any) => c.name), older.out.unavailable], [["help", "start", "submit"], ["retry", "status", "wait"]]);
  assert.equal((await cli(["help", "--all"], "cli", stub)).out.commands.find((c: any) => c.name === "retry").available, false);
  stubHelp = null;
  const silent = await cli(["help"], "cli", stub);
  assert.ok(silent.out.commands.length === 6 && silent.out.commands.every((c: any) => c.name === "help" || c.available === null));
  assert.equal((await cli(["help"], "cli", "http://127.0.0.1:1")).out.server.reachable, false);
  const usage = await cli(["submit", "--intent", "x"], "cli");
  assert.deepEqual([usage.code, usage.out.state], [2, "usage"]);
  console.log("ok: help is the command table, checked against the server: older servers filter, unknown ones do not; usage errors are JSON too");

  // A lost answer: the server decided, the reply never arrived.
  const tip0 = (await info()).tip.version;
  const life1 = (await cli(["start"], "lost-answer")).out.life;
  dropNextSubmit = true;
  const lost = await cli(await submitArgs(life1, "lost-answer"), "lost-answer");
  assert.deepEqual([lost.code, lost.out.state, lost.out.next], [1, "unknown", "retry"]);
  const recorded = await cli(["status", "--life", String(life1)], "lost-answer");
  assert.equal(recorded.out.state, "landed");
  const recovered = await cli(["retry", "--life", String(life1), "--wait"], "lost-answer");
  assert.deepEqual([recovered.code, recovered.out.state, recovered.out.publication, recovered.out.id, recovered.out.version], [0, "landed", "published", recorded.out.id, tip0 + 1]);
  // An unwaited replay of the same submit: the same decision, published by now.
  const replayed = await cli(await submitArgs(life1, "lost-answer"), "lost-answer");
  assert.deepEqual([replayed.code, replayed.out.id, replayed.out.version, replayed.out.publication], [0, recorded.out.id, tip0 + 1, "published"]);
  const changed = await cli(["submit", "--life", String(life1), "--intent", "Something else", "--edits", await edits("lost-answer")], "lost-answer");
  assert.deepEqual([changed.code, changed.out.state], [1, "refused"]);
  assert.match(changed.out.error, /different request/);
  assert.equal((await info()).tip.version, tip0 + 1);
  console.log("ok: a dropped answer recovers by retry as the same decision; the same submit replays it; a changed one is refused");

  // A lost lane reply: the trunk decided, the agent never heard. Undecided,
  // never refused or busy, and still undecided after a restart.
  const life2 = (await cli(["start"], "lost-reply")).out.life;
  await fault("lose", { agent: "lost-reply" });
  const failed = await cli(await submitArgs(life2, "lost-reply"), "lost-reply");
  assert.deepEqual([failed.code, failed.out.state, failed.out.next, failed.out.life], [4, "undecided", "retry", life2]);
  await boot();
  const undecided = await cli(["status"], "lost-reply");
  assert.deepEqual([undecided.code, undecided.out.state, undecided.out.id, undecided.out.life], [4, "undecided", failed.out.id, life2]);
  const settled = await cli(["retry", "--wait"], "lost-reply");
  assert.deepEqual([settled.code, settled.out.state, settled.out.publication, settled.out.id], [0, "landed", "published", undecided.out.id]);
  assert.equal((await info()).tip.version, tip0 + 2);
  console.log("ok: a lost lane reply is undecided, before and after a restart, until retry lands it once with the same ID");

  // A stale life: refused, and the newer life untouched.
  const life3 = (await cli(["start"], "lost-reply")).out.life;
  const stale = await cli(["retry", "--life", String(life2)], "lost-reply");
  assert.deepEqual([stale.code, stale.out.state], [1, "refused"]);
  assert.match(stale.out.error, /not the current life/);
  const fresh = await cli(["status", "--life", String(life3)], "lost-reply");
  assert.deepEqual([fresh.code, fresh.out.state, (await info()).tip.version], [4, "none", tip0 + 2]);
  console.log("ok: a retry of a stale life is refused; the newer life is untouched");

  // Delayed publication: landed is final; only publication is pending.
  await fault("upload", { mode: "pause" });
  const delayed = await cli([...(await submitArgs(life3, "delayed")), "--wait", "--timeout", "2"], "lost-reply");
  assert.deepEqual([delayed.code, delayed.out.state, delayed.out.publication, delayed.out.timed_out, delayed.out.next], [75, "landed", "pending", true, "wait"]);
  // Unwaited, the same submit, a retry and status replay the landing and
  // still exit 75: landed for good, publication not confirmed.
  for (const replay of [await cli(await submitArgs(life3, "delayed"), "lost-reply"), await cli(["retry"], "lost-reply"), await cli(["status"], "lost-reply")]) {
    assert.deepEqual([replay.code, replay.out.state, replay.out.publication, replay.out.id, replay.out.timed_out], [75, "landed", "pending", delayed.out.id, false]);
  }
  await fault("upload", { mode: "" });
  const done = await cli(["wait", "--timeout", "30"], "lost-reply");
  assert.deepEqual([done.code, done.out.state, done.out.publication, done.out.id, done.out.version], [0, "landed", "published", delayed.out.id, delayed.out.version]);
  const confirmed = await cli(await submitArgs(life3, "delayed"), "lost-reply");
  assert.deepEqual([confirmed.code, confirmed.out.publication, confirmed.out.id], [0, "published", delayed.out.id]);
  console.log("ok: a slow publication exits 75 as landed and pending, waited or not, then 0 once published, same receipt");

  // Busy: not admitted, nothing stored; distinct from landed and pending.
  const life4 = (await cli(["start"], "turned-away")).out.life;
  await api("POST", "/__test/hold", { trunk, mode: "on" });
  for (let i = 0; i < 40 && (await info()).backlog.admitting; i++) {
    const version = (await info()).tip.version;
    await fault("submit", { change: { id: `fill-${i}`, agent: "filler", kind: "agent", owner: null, life: 1, intent: `Fill ${i}`, base: version, reads: { strong: [], weak: [] }, edits: [{ op: "create", path: `fill-${i}.txt`, text: "x".repeat(1000) }], issue: null, closes: false } });
  }
  assert.equal((await info()).backlog.admitting, false);
  const busy = await cli(await submitArgs(life4, "turned-away"), "turned-away");
  assert.deepEqual([busy.code, busy.out.state, busy.out.next, busy.out.publication], [75, "busy", "resend", null]);
  assert.ok(busy.out.retry_after_ms > 0);
  assert.deepEqual([(await cli(["status"], "turned-away")).out.state], ["none"]);
  await api("POST", "/__test/hold", { trunk, mode: "off" });
  for (const deadline = Date.now() + 30_000; !(await info()).backlog.admitting; ) {
    assert.ok(Date.now() < deadline, "the backlog did not drain");
    await new Promise((r) => setTimeout(r, 200));
  }
  const admitted = await cli([...(await submitArgs(life4, "turned-away")), "--wait"], "turned-away");
  assert.deepEqual([admitted.code, admitted.out.state, admitted.out.publication], [0, "landed", "published"]);
  console.log("ok: busy exits 75 with nothing stored; the same submit lands once publication catches up");

  const head = (await info()).tip;
  const clone = join(dir, "clone");
  await exec("git", ["clone", "-q", `${origin}/git/${trunk}.git`, clone]);
  const git = async (...args: string[]) => (await exec("git", ["-C", clone, ...args])).stdout.trim();
  assert.equal(await git("rev-parse", "HEAD"), head.commit);
  assert.equal(Number(await git("rev-list", "--count", "HEAD")), head.version);
  await git("fsck", "--full", "--strict");
  console.log(`ok: clone and strict fsck, ${head.version} linear commits, no duplicate landing`);
} finally {
  for (const server of servers) server.close();
  await mf?.dispose();
  await rm(dir, { recursive: true, force: true });
}
