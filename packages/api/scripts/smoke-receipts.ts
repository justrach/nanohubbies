// Self-contained local Workers regression: real SQLite DOs and R2, real HTTP
// dispatch, lost acknowledgements, eviction, publication retry, and git clone.
// Run from packages/api: node scripts/smoke-receipts.ts. No hosted bindings.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const exec = promisify(execFile);
const here = dirname(new URL(import.meta.url).pathname);
const dir = await mkdtemp(join(tmpdir(), "swarm-receipts-"));
const trunk = "receipt-smoke";
const base = `/api/trunks/${trunk}`;
let mf: Miniflare;
let origin: string;
// Resolve Worker exports, not Node-specific package implementations.
const bundle = await build({ entryPoints: [join(here, "receipts/worker.ts")], bundle: true, platform: "neutral", format: "esm", conditions: ["workerd", "worker", "browser"], external: ["cloudflare:workers", "node:*"], write: false });
const script = bundle.outputFiles[0].text;
async function boot() {
  mf = new Miniflare({ ...convertV4MiniflareOptions({
    name: "receipt-test", modules: true, script, compatibilityDate: "2026-09-01", compatibilityFlags: ["nodejs_compat"],
    durableObjects: Object.fromEntries(["Sequencer", "Agent", "Lane", "Packer", "Room", "Driver", "Hub", "Account"].map((className) => [className.toUpperCase(), { className, useSQLite: true }])),
    r2Buckets: ["OBJECTS"], d1Databases: ["AUTH_DB"], bindings: { APP_ORIGIN: "http://localhost:3000" },
  }), resourcePersistencePath: join(dir, "storage"), isolatedResourcePersistencePath: join(dir, "isolated") });
  origin = (await mf.ready).origin;
}
async function response(method: string, path: string, body?: unknown) {
  const res = await fetch(origin + path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() as any };
}
async function api(method: string, path: string, body?: unknown) {
  const res = await response(method, path, body);
  assert.ok(res.status >= 200 && res.status < 300, JSON.stringify(res));
  return res.body;
}
const fault = (action: string, extra: object) => api("POST", `/__test/${action}`, { trunk, ...extra });
const agentPath = (name: string) => `${base}/agents/${name}`;
const start = (name: string) => api("POST", `${agentPath(name)}/lives`, {});
const submit = (name: string, plan: object) => api("POST", `${agentPath(name)}/submit`, plan);
const info = () => api("GET", `${base}/info`);
const plan = (life: number, name: string) => ({ life, intent: `Add ${name}`, edits: [{ op: "create", path: `${name}.txt`, text: `${name}\n` }] });
async function published(version: number) {
  const deadline = Date.now() + 20_000;
  while ((await info()).head.version < version) {
    assert.ok(Date.now() < deadline, "publication alarm did not recover without another submission");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
const direct = (id: string, version: number, name: string) => ({
  id, agent: "direct", kind: "agent", owner: null, life: 1, intent: `Add ${name}`, base: version,
  reads: { strong: [], weak: [] }, edits: [{ op: "create", path: `${name}.txt`, text: `${name}\n` }], issue: null, closes: false,
});
const decision = (change: object) => fault("submit", { change });

try {
  await boot();
  await api("POST", base, { files: [{ path: "base.txt", text: "base\n" }] });
  const first = plan((await start("retry")).life, "once");
  const results = await Promise.all(Array.from({ length: 8 }, () => submit("retry", first)));
  for (const result of results) assert.deepEqual(result, results[0]);
  assert.equal(results[0].status, "landed");
  assert.equal((await info()).tip.version, 2);
  assert.ok((await response("POST", `${agentPath("retry")}/submit`, { ...first, intent: "different" })).status >= 400);
  const visible = await submit("retry", { ...first, wait: "published" });
  assert.equal(visible.publication, "published");
  assert.equal(visible.commit, results[0].commit);
  const invalid = await response("POST", `${agentPath("retry")}/submit`, { ...first, wait: "unknown" });
  assert.equal(invalid.status, 400);
  await start("retry");
  assert.ok((await response("POST", `${agentPath("retry")}/submit`, first)).status >= 400);
  console.log("ok: concurrent/repeated HTTP submissions, payload binding, life fence, published receipt");

  const lost = plan((await start("lost-reply")).life, "recovered");
  await fault("lose", { agent: "lost-reply" });
  assert.ok((await response("POST", `${agentPath("lost-reply")}/submit`, lost)).status >= 400);
  const afterLost = (await info()).tip;
  assert.equal(afterLost.version, 3);
  assert.ok((await response("POST", `${agentPath("lost-reply")}/lives`, {})).status >= 400);
  await published(afterLost.version);
  await mf.dispose();
  await boot();
  const recovered = await submit("lost-reply", { ...lost, wait: "published" });
  assert.equal(recovered.status, "landed");
  assert.equal(recovered.version, afterLost.version);
  assert.equal(recovered.commit, afterLost.commit);
  assert.equal((await info()).tip.version, 3);
  console.log("ok: lost lane reply and complete runtime restart recover the original decision");

  const directRequest = direct("direct-once", 3, "direct");
  const landed = await decision(directRequest);
  assert.equal(landed.status, "landed");
  const { made: _made, ...receipt } = landed;
  assert.deepEqual(await decision({ ...directRequest }), receipt);
  assert.equal((await decision({ ...directRequest, intent: "different" })).status, "rejected");
  assert.deepEqual(await decision(directRequest), receipt);
  const rejected = direct("rejected-once", 100_000, "future");
  const refusal = await decision(rejected);
  assert.equal(refusal.status, "rejected");
  assert.deepEqual(await decision(rejected), refusal);
  const conflictRequest = { ...direct("conflict-once", 1, "direct"), edits: [{ op: "write", path: "direct.txt", text: "different\n" }] };
  const conflict = await decision(conflictRequest);
  assert.equal(conflict.status, "conflict");
  assert.deepEqual(await decision(conflictRequest), conflict);
  assert.equal((await info()).tip.version, 4);
  console.log("ok: sequencer replays landed/conflict/rejected receipts without a new decision");

  await fault("receipt", { mode: "on" });
  const rollbackRequest = direct("rollback", 4, "rollback");
  assert.equal((await response("POST", "/__test/submit", { trunk, change: rollbackRequest })).status, 500);
  assert.equal((await info()).tip.version, 4);
  assert.ok(!(await api("GET", `${base}/files`)).some((file: any) => file.path === "rollback.txt"));
  await fault("receipt", { mode: "off" });
  assert.equal((await decision(rollbackRequest)).status, "landed");
  assert.equal((await info()).tip.version, 5);
  await published(5);
  console.log("ok: receipt-write failure rolls back landing state and derived caches");

  for (const mode of ["before", "after"]) {
    const name = `upload-${mode}`;
    const upload = plan((await start(name)).life, name);
    await fault("upload", { mode });
    const pending = await response("POST", `${agentPath(name)}/submit`, { ...upload, wait: "published" });
    // The background attempt may already fail before the explicit wait begins;
    // a wait is allowed to retry and complete. Neither outcome loses the receipt.
    assert.ok(pending.status === 200 || pending.status === 202);
    assert.equal(pending.body.status, "landed");
    assert.equal(pending.body.publication, pending.status === 200 ? "published" : "pending");
    await published(pending.body.version);
    const retried = await submit(name, { ...upload, wait: "published" });
    assert.equal(retried.id, pending.body.id);
    assert.equal(retried.commit, pending.body.commit);
    assert.equal(retried.publication, "published");
  }
  // No explicit publication wait here: only the scheduled alarm can repair it.
  const alarmPlan = plan((await start("alarm-only")).life, "alarm-only");
  await fault("upload", { mode: "before" });
  const alarmResult = await submit("alarm-only", alarmPlan);
  await published(alarmResult.version);
  console.log("ok: upload failure/lost pack acknowledgement recover; idle publication retries by alarm");

  const pausedPlan = plan((await start("paused")).life, "paused");
  await fault("upload", { mode: "pause" });
  const pending = await response("POST", `${agentPath("paused")}/submit`, { ...pausedPlan, wait: "published" });
  assert.equal(pending.status, 202);
  assert.equal(pending.body.status, "landed");
  assert.equal(pending.body.publication, "pending");
  assert.ok((await info()).head.version < pending.body.version);
  await fault("upload", { mode: "" });
  const resumed = await submit("paused", { ...pausedPlan, wait: "published" });
  assert.equal(resumed.publication, "published");
  assert.equal(resumed.id, pending.body.id);
  assert.equal(resumed.commit, pending.body.commit);
  console.log("ok: publication timeout returns 202 with the original landed receipt, then becomes clonable");

  // A lane's batch is decided whole and written once at its end (src/sequencer/held).
  const land = (changes: object[]) => response("POST", "/__test/land", { trunk, changes });
  const versions = (out: any) => out.body.results.map((r: any) => r.version);
  const before = (await info()).tip.version;
  const batch = ["b1", "b2", "b3"].map((n) => direct(`batch-${n}`, before, `batch-${n}`));
  await fault("receipt", { mode: "on", id: "batch-b3" });
  assert.equal((await land(batch)).status, 500);
  assert.equal((await info()).tip.version, before);
  assert.ok(!(await api("GET", `${base}/files`)).some((file: any) => file.path.startsWith("batch-")));
  await fault("receipt", { mode: "off" });
  assert.deepEqual(versions(await land(batch)), [before + 1, before + 2, before + 3]);
  assert.equal((await info()).tip.version, before + 3);
  console.log("ok: a batch whose write fails after provisional landings stores none of them, then lands once");

  const once = direct("repeat-in-batch", before + 3, "repeat");
  const repeated = (await land([once, once, { ...once, intent: "changed" }])).body.results;
  assert.equal(repeated[0].status, "landed");
  const { made: _first, ...firstReceipt } = repeated[0];
  assert.deepEqual(repeated[1], firstReceipt);
  assert.equal(repeated[2].status, "rejected");
  assert.equal((await info()).tip.version, before + 4);
  assert.deepEqual((await land([once])).body.results[0], firstReceipt);
  console.log("ok: a repeated ID within one batch replays its receipt; a changed payload is refused");

  const lostBatch = ["l1", "l2"].map((n) => direct(`lost-batch-${n}`, before + 4, `lost-batch-${n}`));
  await fault("losebatch", {});
  assert.equal((await land(lostBatch)).status, 500);
  assert.equal((await info()).tip.version, before + 6);
  assert.deepEqual(versions(await land(lostBatch)), [before + 5, before + 6]);
  assert.equal((await info()).tip.version, before + 6);
  await published(before + 6);
  console.log("ok: a lost batch acknowledgement replays the stored decisions, with no second landing");

  // Discovery and status (src/workflow): the help is the table the router serves.
  const help = await api("GET", "/api/agent-help");
  for (const path of ["/lives", "/submit", "/retry", "/submission"]) assert.ok(help.routes.some((r: any) => r.path === path), path);
  assert.ok(help.contract === 1 && help.workflow.length > 0 && help.limits.bytes > 0);
  assert.deepEqual(help.routes.filter((r: any) => r.auth === "owner").map((r: any) => r.path), ["/submit", "/retry", "/submission"]);
  const watched = plan((await start("status")).life, "status");
  assert.equal((await api("GET", `${agentPath("status")}/submission`)).state, "none");
  await fault("lose", { agent: "status" });
  const unanswered = await response("POST", `${agentPath("status")}/submit`, watched);
  assert.deepEqual([unanswered.status, unanswered.body.state], [502, "undecided"], "a lost lane reply is undecided, not refused");
  const undecided = await api("GET", `${agentPath("status")}/submission`);
  assert.deepEqual([undecided.state, undecided.id], ["undecided", unanswered.body.id]);
  const retriedStatus = await api("POST", `${agentPath("status")}/retry`);
  assert.equal(retriedStatus.status, "landed");
  const seen = await api("GET", `${agentPath("status")}/submission?wait=published`);
  assert.deepEqual([seen.id, seen.state, seen.receipt.version, seen.publication], [undecided.id, "landed", retriedStatus.version, "published"]);
  assert.ok(!("edits" in seen) && !("edits" in seen.receipt), "status shows the receipt, never the saved request");
  const late = plan((await start("status")).life, "status-late");
  await fault("upload", { mode: "pause" });
  const lateResult = await submit("status", late);
  const pendingStatus = await response("GET", `${agentPath("status")}/submission?wait=published&timeout=300`);
  assert.deepEqual([pendingStatus.status, pendingStatus.body.state, pendingStatus.body.publication], [202, "landed", "pending"]);
  await fault("upload", { mode: "" });
  const finalStatus = await api("GET", `${agentPath("status")}/submission?wait=published`);
  assert.deepEqual([finalStatus.receipt.version, finalStatus.publication], [lateResult.version, "published"]);
  const newer = (await start("status")).life;
  const tip = (await info()).tip.version;
  for (const stale of [
    await response("POST", `${agentPath("status")}/retry`, { life: newer - 1 }),
    await response("GET", `${agentPath("status")}/submission?life=${newer - 1}`),
    await response("POST", `${agentPath("status")}/submit`, { ...late, life: newer - 1 }),
  ]) assert.equal(stale.status, 400, JSON.stringify(stale.body));
  assert.deepEqual([(await api("GET", `${agentPath("status")}/submission?life=${newer}`)).state, (await info()).tip.version], ["none", tip]);
  console.log("ok: agent help lists the workflow; a lost answer is undecided until retry replays it; status waits for publication; a stale life is refused");

  // A life a signed-in person started answers only them.
  const login = await fetch(`${origin}/api/auth/dev`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "alice" }) });
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const as = async (method: string, path: string, body: unknown, signedIn: boolean) => {
    const res = await fetch(origin + `${agentPath("owned")}${path}`, { method, headers: { "content-type": "application/json", ...(signedIn ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as any };
  };
  const owned = plan((await as("POST", "/lives", {}, true)).body.life, "owned");
  for (const [method, path, body] of [["GET", "/submission", undefined], ["POST", "/retry", {}], ["POST", "/submit", owned]] as const) {
    assert.equal((await as(method, path, body, false)).status, 403, `${path} as a guest`);
  }
  assert.equal((await as("GET", "/submission", undefined, true)).body.state, "none");
  assert.equal((await as("POST", "/submit", owned, true)).body.status, "landed");
  console.log("ok: a signed-in person's life refuses others' submit, retry and status, and serves its owner");

  const head = (await info()).tip;
  const clone = join(dir, "clone");
  await exec("git", ["clone", "-q", `${origin}/git/${trunk}.git`, clone]);
  const git = async (...args: string[]) => (await exec("git", ["-C", clone, ...args])).stdout.trim();
  assert.equal(await git("rev-parse", "HEAD"), head.commit);
  assert.equal(Number(await git("rev-list", "--count", "HEAD")), head.version);
  assert.equal(await git("rev-list", "--merges", "HEAD"), "");
  await git("fsck", "--full", "--strict");
  assert.equal(await readFile(join(clone, "recovered.txt"), "utf8"), "recovered\n");
  console.log(`ok: clone and strict fsck, ${head.version} linear commits, no duplicate landing`);
} finally {
  await mf!?.dispose();
  await rm(dir, { recursive: true, force: true });
}
