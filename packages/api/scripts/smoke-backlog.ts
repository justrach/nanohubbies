// Self-contained local Workers regression for publication backpressure: a
// publisher that keeps failing fills the backlog, the trunk stops deciding new
// changes before its byte limit, a turned-away change leaves no receipt,
// decided changes still replay, a restart keeps the counts, and once uploads
// work again the backlog drains without another landing. Then the same for
// the age limit, and a clone with strict fsck. Run from packages/api:
// node scripts/smoke-backlog.ts. No hosted bindings.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const exec = promisify(execFile);
const here = dirname(new URL(import.meta.url).pathname);
const dir = await mkdtemp(join(tmpdir(), "swarm-backlog-"));
const trunk = "backlog-smoke";
const base = `/api/trunks/${trunk}`;
// Small limits, so a few changes fill the backlog.
const BYTES = 6000;
const CHANGE = 1500;
let mf: Miniflare;
let origin: string;
const bundle = await build({ entryPoints: [join(here, "receipts/worker.ts")], bundle: true, platform: "neutral", format: "esm", conditions: ["workerd", "worker", "browser"], external: ["cloudflare:workers", "node:*"], write: false });
async function boot(limits: Record<string, string>) {
  mf = new Miniflare({ ...convertV4MiniflareOptions({
    name: "backlog-test", modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-09-01", compatibilityFlags: ["nodejs_compat"],
    durableObjects: Object.fromEntries(["Sequencer", "Agent", "Lane", "Packer", "Room", "Driver", "Hub", "Account"].map((className) => [className.toUpperCase(), { className, useSQLite: true }])),
    r2Buckets: ["OBJECTS"], d1Databases: ["AUTH_DB"], bindings: { APP_ORIGIN: "http://localhost:3000", ...limits },
  }), resourcePersistencePath: join(dir, "storage"), isolatedResourcePersistencePath: join(dir, "isolated") });
  origin = (await mf.ready).origin;
}
async function response(method: string, path: string, body?: unknown) {
  const res = await fetch(origin + path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as any };
}
async function api(method: string, path: string, body?: unknown) {
  const res = await response(method, path, body);
  assert.ok(res.status >= 200 && res.status < 300, JSON.stringify(res));
  return res.body;
}
const info = () => api("GET", `${base}/info`);
const hold = (on: boolean) => api("POST", "/__test/hold", { trunk, mode: on ? "on" : "off" });
const decide = (change: object) => api("POST", "/__test/submit", { trunk, change });
const change = (id: string, version: number, bytes: number) => ({
  id, agent: "filler", kind: "agent", owner: null, life: 1, intent: `Add ${id}`, base: version,
  reads: { strong: [], weak: [] }, edits: [{ op: "create", path: `${id}.txt`, text: `${id}:${"x".repeat(bytes)}\n` }], issue: null, closes: false,
});
async function drained(within: number) {
  const deadline = Date.now() + within;
  for (;;) {
    const now = await info();
    if (now.head.version === now.tip.version && now.backlog.queuedBytes === 0) return now;
    assert.ok(Date.now() < deadline, `backlog did not drain: ${JSON.stringify(now.backlog)}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

try {
  await boot({ PUBLISH_BACKLOG_BYTES: String(BYTES), PUBLISH_BACKLOG_MS: "600000", CHANGE_MAX_BYTES: String(CHANGE) });
  await api("POST", base, { files: [{ path: "base.txt", text: "base\n" }] });
  await drained(10_000);
  const tooBig = await decide(change("too-big", 1, CHANGE + 100));
  assert.equal(tooBig.status, "rejected");
  assert.match(tooBig.error, /at most/);
  console.log("ok: a change over the size limit is refused, with a receipt like any rejection");

  await hold(true);
  const landed: any[] = [];
  let turnedAway: any = null;
  for (let i = 0; i < 40 && !turnedAway; i++) {
    const c = change(`fill-${i}`, (await info()).tip.version, 1000);
    const out = await decide(c);
    if (out.status === "busy") turnedAway = { c, out };
    else landed.push({ c, out });
  }
  assert.ok(turnedAway, "the backlog never turned a change away");
  const full = (await info()).backlog;
  assert.equal(full.admitting, false);
  // Past the limit by at most one change: its file, and the tree and commit it made.
  assert.ok(full.queuedBytes < BYTES + CHANGE + 2000, `queued ${full.queuedBytes} bytes`);
  assert.equal(turnedAway.out.id, turnedAway.c.id);
  assert.ok(turnedAway.out.retryAfterMs > 0);
  const { made: _made, ...receipt } = landed[0].out;
  assert.deepEqual(await decide(landed[0].c), receipt);
  console.log(`ok: ${landed.length} landed, then the backlog turned changes away at ${full.queuedBytes} of ${BYTES} bytes; decided ones still replay`);

  const before = (await info()).backlog.queuedBytes;
  await mf.dispose();
  await boot({ PUBLISH_BACKLOG_BYTES: String(BYTES), PUBLISH_BACKLOG_MS: "600000", CHANGE_MAX_BYTES: String(CHANGE) });
  const after = (await info()).backlog;
  assert.equal(after.queuedBytes, before);
  assert.equal(after.admitting, false);
  assert.equal((await decide(turnedAway.c)).status, "busy");
  console.log("ok: a restart with uploads still failing keeps the backlog's counts, and still turns changes away");

  const t0 = Date.now();
  await hold(false);
  const empty = await drained(30_000);
  console.log(`ok: with uploads working again the backlog drained in ${((Date.now() - t0) / 1000).toFixed(1)}s, with no landing to start it`);
  assert.equal(empty.backlog.admitting, true);
  const retried = await decide({ ...turnedAway.c, base: empty.tip.version });
  assert.equal(retried.status, "landed");
  assert.equal(retried.version, empty.tip.version + 1);
  console.log("ok: the change turned away lands when sent again: it had left no receipt");

  await drained(10_000);
  await mf.dispose();
  await boot({ PUBLISH_BACKLOG_BYTES: String(10_000_000), PUBLISH_BACKLOG_MS: "1500", CHANGE_MAX_BYTES: String(CHANGE) });
  await hold(true);
  const old = await decide(change("old", (await info()).tip.version, 100));
  assert.equal(old.status, "landed");
  await new Promise((resolve) => setTimeout(resolve, 1700));
  const late = change("late", (await info()).tip.version, 100);
  assert.equal((await decide(late)).status, "busy");
  await hold(false);
  await drained(30_000);
  assert.equal((await decide({ ...late, base: (await info()).tip.version })).status, "landed");
  console.log("ok: a landed version waiting past the age limit turns changes away until it is published");

  const head = await drained(10_000);
  const clone = join(dir, "clone");
  await exec("git", ["clone", "-q", `${origin}/git/${trunk}.git`, clone]);
  const git = async (...args: string[]) => (await exec("git", ["-C", clone, ...args])).stdout.trim();
  assert.equal(await git("rev-parse", "HEAD"), head.tip.commit);
  assert.equal(Number(await git("rev-list", "--count", "HEAD")), head.tip.version);
  await git("fsck", "--full", "--strict");
  console.log(`ok: clone and strict fsck, ${head.tip.version} linear commits`);
} finally {
  await mf!?.dispose();
  await rm(dir, { recursive: true, force: true });
}
