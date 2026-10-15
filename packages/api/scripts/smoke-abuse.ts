// Self-contained public-host admission regression with real Workers, SQLite
// DOs, R2 and git. No hosted bindings or outbound network. Run from packages/api:
// node scripts/smoke-abuse.ts
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
const dir = await mkdtemp(join(tmpdir(), "swarm-abuse-"));
const seed = { files: [{ path: "base.txt", text: "base\n" }] };
const base = "/api/trunks/";
const bundle = await build({ entryPoints: [join(here, "abuse/worker.ts")], bundle: true, platform: "neutral", format: "esm", conditions: ["workerd", "worker", "browser"], external: ["cloudflare:workers", "node:*"], write: false });
let mf: Miniflare;
let origin: string;
const defaults = {
  ABUSE_PROTECTION: "1", SESSION_SECRET: "abuse-test-secret",
  TRUNK_MAX_TOTAL: "8", TRUNK_MAX_PER_IP: "2", TRUNK_MAX_PER_OWNER: "1",
  TRUNK_CREATIONS_PER_HOUR: "50", CONTROL_REQUESTS_PER_MINUTE: "100", AGENT_REQUESTS_PER_MINUTE: "2",
  TRUNK_REQUEST_MAX_BYTES: "512", TRUNK_SEED_MAX_BYTES: "96",
};
async function boot(overrides: Record<string, string> = {}) {
  mf = new Miniflare({ ...convertV4MiniflareOptions({
    name: "abuse-test", modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-09-01", compatibilityFlags: ["nodejs_compat"],
    durableObjects: {
      ...Object.fromEntries(["Sequencer", "Agent", "Lane", "Packer", "Room", "Driver", "Hub", "Account"].map((className) => [className.toUpperCase(), { className, useSQLite: true }])),
      LEGACY_HUB: { className: "LegacyHub", useSQLite: true },
    },
    r2Buckets: ["OBJECTS"], d1Databases: ["AUTH_DB"], bindings: { ...defaults, ...overrides },
  }), resourcePersistencePath: join(dir, "storage"), isolatedResourcePersistencePath: join(dir, "isolated") });
  origin = (await mf.ready).origin;
}
async function response(method: string, path: string, body?: unknown, ip: string | null = "192.0.2.1", extra: Record<string, string> = {}, local = false) {
  const headers = { "content-type": "application/json", ...(ip ? { "CF-Connecting-IP": ip } : {}), ...extra };
  const res = await mf.dispatchFetch(`${local ? origin : "https://public.test"}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, headers: res.headers, body: await res.json() as any };
}
async function api(method: string, path: string, body?: unknown, ip?: string | null, extra?: Record<string, string>, local = false) {
  const res = await response(method, path, body, ip, extra, local);
  assert.ok(res.status >= 200 && res.status < 300, JSON.stringify(res));
  return res;
}
const create = (name: string, ip: string | null, extra: Record<string, string> = {}) => response("POST", base + name, seed, ip, extra);
const retry = (res: Awaited<ReturnType<typeof response>>) => assert.ok(Number(res.headers.get("Retry-After")) > 0);

try {
  await boot();
  assert.deepEqual((await api("POST", "/__test/legacy")).body, [{ name: "legacy", created: 1, source: "files", owner: "owner" }]);
  console.log("ok: additive Hub migration preserves legacy rows");

  const raced = await Promise.all(Array.from({ length: 6 }, (_, i) => create(`race-${i}`, "192.0.2.10")));
  assert.equal(raced.filter((r) => r.status === 200).length, 2);
  assert.equal(raced.filter((r) => r.status === 429).length, 4);
  const deniedImport = await response("POST", base + "denied-import/import", { repo: "fixture/repo" }, "192.0.2.10");
  assert.equal(deniedImport.status, 429);
  retry(deniedImport);
  assert.equal((await api("GET", "/__test/downloads")).body.downloads, 0);
  console.log("ok: simultaneous creation cannot exceed the IP quota; imports are refused before downloading");

  const login = await api("POST", "/api/auth/dev", { name: "alice" }, "192.0.2.20", {}, true);
  const cookie = login.headers.get("Set-Cookie")!.split(";")[0];
  assert.equal((await create("owned", "192.0.2.21", { Cookie: cookie })).status, 200);
  const ownerFull = await create("owner-full", "192.0.2.22", { Cookie: cookie });
  assert.equal(ownerFull.status, 429);
  assert.match(ownerFull.body.error, /your trunk quota/);
  assert.equal((await response("DELETE", base + "owned", undefined, "192.0.2.23")).status, 403);
  // A different identity cannot replace the creator or reset the seed.
  const original = (await api("GET", base + "owned")).body;
  assert.equal((await create("owned", "192.0.2.24")).status, 409);
  assert.deepEqual((await api("GET", base + "owned")).body, original);
  console.log("ok: signed-in quota follows the owner across IPs; collisions preserve ownership and deletion stays owner-only");

  assert.equal((await create("missing-a", null, { "X-Forwarded-For": "198.51.100.1" })).status, 200);
  assert.equal((await create("missing-b", null, { "X-Forwarded-For": "198.51.100.2" })).status, 200);
  assert.equal((await create("missing-c", null, { "X-Forwarded-For": "198.51.100.3" })).status, 429);
  console.log("ok: missing connecting addresses share one bucket; forwarded headers cannot bypass quotas");

  const imported = await api("POST", base + "imported/import", { repo: "fixture/repo" }, "192.0.2.30");
  assert.equal(imported.body.files, 1);
  assert.equal((await api("GET", base + "imported/file?path=base.txt")).body.text, "base\n");
  assert.equal((await api("GET", "/__test/downloads")).body.downloads, 1);
  console.log("ok: an admitted GitHub import still seeds files and repository context");

  assert.equal((await response("POST", base + "invalid", { files: [] }, "192.0.2.40")).status, 400);
  assert.equal((await response("POST", base + "large-request", { files: [{ path: "big", text: "x".repeat(600) }] }, "192.0.2.40")).status, 413);
  assert.equal((await response("POST", base + "large-seed", { files: [{ path: "big", text: "x".repeat(100) }] }, "192.0.2.40")).status, 413);
  // Chunked/absent Content-Length is bounded too.
  const chunked = await mf.dispatchFetch("https://public.test" + base + "chunked", {
    method: "POST", headers: { "CF-Connecting-IP": "192.0.2.40" },
    body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("x".repeat(600))); c.close(); } }), duplex: "half",
  });
  assert.equal(chunked.status, 413);
  assert.equal((await create("after-invalid", "192.0.2.40")).status, 200);
  console.log("ok: malformed and oversized creation requests release unused capacity; streamed bodies are bounded");

  const limits = { total: 8, owner: 1, ip: 2 };
  const pending = (await api("POST", "/__test/reserve", { name: "pending", limits })).body;
  assert.equal(pending.ok, true);
  const full = await create("capacity-full", "192.0.2.50");
  assert.equal(full.status, 503);
  retry(full);
  await api("POST", "/__test/release", { name: "pending", ticket: "wrong-ticket" });
  assert.equal((await create("still-full", "192.0.2.51")).status, 503);

  // Exercise rate counters before restart as well as reservations and rows.
  for (let i = 0; i < 2; i++) assert.equal((await response("GET", base + "imported/agents/reader", undefined, "192.0.2.60")).status, 200);
  const agentLimited = await response("GET", base + "imported/agents/reader", undefined, "192.0.2.60");
  assert.equal(agentLimited.status, 429);
  retry(agentLimited);
  assert.equal((await response("POST", base + "imported/presence", {}, "192.0.2.60")).status, 200);
  await mf.dispose();
  await boot({ CONTROL_REQUESTS_PER_MINUTE: "2", TRUNK_CREATIONS_PER_HOUR: "1" });
  assert.equal((await create("full-after-restart", "192.0.2.52")).status, 503);
  assert.equal((await response("GET", base + "imported/agents/other", undefined, "192.0.2.60")).status, 429);
  await api("POST", "/__test/release", { name: "pending", ticket: pending.ticket });
  assert.equal((await create("after-release", "192.0.2.53")).status, 200);
  console.log("ok: pending admissions, ownership, quotas and separate agent-rate counters survive restart; releases require the matching ticket");

  const deletion = await response("DELETE", base + "owned", undefined, "192.0.2.70", { Cookie: cookie });
  assert.equal(deletion.status, 200);
  assert.equal((await create("owned-again", "192.0.2.71", { Cookie: cookie })).status, 200);
  console.log("ok: owner deletion frees deployment and owner quota");

  // Capacity is full; even failed attempts spend the hourly creation budget.
  assert.equal((await create("hourly-a", "192.0.2.80")).status, 503);
  const hourly = await create("hourly-b", "192.0.2.80");
  assert.equal(hourly.status, 429);
  assert.match(hourly.body.error, /creation rate/);
  retry(hourly);
  for (let i = 0; i < 2; i++) assert.equal((await response("POST", "/api/auth/signout", {}, "192.0.2.90")).status, 200);
  const controls = await response("POST", "/api/auth/signout", {}, "192.0.2.90");
  assert.equal(controls.status, 429);
  retry(controls);
  assert.equal((await response("POST", "/api/auth/signout", {}, "192.0.2.91")).status, 200);
  assert.equal((await response("GET", base + "imported/agents/new", undefined, "192.0.2.90")).status, 200);
  console.log("ok: creation and control budgets enforce Retry-After without exhausting other addresses or agent traffic");

  assert.equal((await api("POST", "/__test/rate")).body.ok, true);
  assert.equal((await api("POST", "/__test/rate")).body.ok, false);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal((await api("POST", "/__test/rate")).body.ok, true);
  console.log("ok: a fixed rate window expires instead of being extended by denials");

  // Immutable clone traffic is outside the throttle, including after a
  // control bucket is exhausted. The HTTP path and objects remain ordinary git.
  const checkout = join(dir, "clone");
  await exec("git", ["clone", `${origin}/git/imported.git`, checkout], { timeout: 30_000 });
  await exec("git", ["-C", checkout, "fsck", "--strict"], { timeout: 30_000 });
  console.log("ok: an admitted trunk clones over HTTP and passes git fsck --strict");

  // Production cannot disable protection by setting the local opt-in flag to
  // zero; malformed numeric settings fall back to safe defaults.
  await mf.dispose();
  await boot({ ABUSE_PROTECTION: "0", TRUNK_MAX_TOTAL: "NaN", TRUNK_MAX_PER_IP: "0", CONTROL_REQUESTS_PER_MINUTE: "Infinity" });
  assert.equal((await create("public-default-a", "192.0.2.100")).status, 200);
  assert.equal((await create("public-default-b", "192.0.2.100")).status, 200);
  assert.equal((await create("public-default-c", "192.0.2.100")).status, 200);
  assert.equal((await create("public-default-d", "192.0.2.100")).status, 429);
  assert.equal((await create("race-0", "192.0.2.101")).status, raced[0].status === 200 ? 409 : 200);
  console.log("ok: public protection is automatic and invalid settings cannot remove limits");
} finally {
  await mf?.dispose();
  await rm(dir, { recursive: true, force: true });
}
