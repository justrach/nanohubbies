import assert from "node:assert/strict";
import { test } from "node:test";
import { cached } from "../src/browse/cache.ts";

test("immutable keys distinguish origins, repositories and revisions", async () => {
  let reads = 0;
  const load = async () => ({ read: ++reads });
  const key = ["https://one.test", "repo", "tree", "sha1"];
  assert.equal((await cached(undefined, key, load)).source, "miss");
  const warm = await cached(undefined, key, load);
  assert.equal(warm.source, "memory");
  assert.equal(warm.value.read, 1);
  warm.value.read = 99;
  assert.equal((await cached(undefined, key, load)).value.read, 1);
  for (const other of [
    ["https://two.test", "repo", "tree", "sha1"],
    ["https://one.test", "other", "tree", "sha1"],
    ["https://one.test", "repo", "tree", "sha2"],
  ]) assert.equal((await cached(undefined, other, load)).source, "miss");
  assert.equal(reads, 4);
});

test("KV hits survive an empty memory cache and do not read objects", async () => {
  const store = {
    get: async () => JSON.stringify({ commits: [1, 2] }),
    put: async () => { assert.fail("a hit must not write KV"); },
  };
  const result = await cached(store, ["persisted"], async () => assert.fail("must not read objects"));
  assert.equal(result.source, "kv");
  assert.deepEqual(result.value, { commits: [1, 2] });
});

test("misses write with a TTL through the request lifetime", async () => {
  const writes = [], pending = [];
  const store = { get: async () => null, put: async (...args) => { writes.push(args); } };
  const result = await cached(store, ["background"], async () => ({ file: "hello" }), { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  assert.equal(result.source, "miss");
  assert.equal(pending.length, 1);
  assert.match(writes[0][0], /^browse:v1:[a-f0-9]{64}$/);
  assert.deepEqual(JSON.parse(writes[0][1]), result.value);
  assert.equal(writes[0][2].expirationTtl, 86400);
});

test("cache failures, corrupt values and latency fall back to storage", async () => {
  for (const [name, get] of [
    ["offline", async () => { throw Error("offline"); }],
    ["corrupt", async () => "{"],
    ["slow", () => new Promise(() => {})],
  ]) {
    const store = { get, put: async () => { throw Error("offline"); } };
    const value = await cached(store, [name], async () => ({ ok: true }));
    assert.deepEqual(value.value, { ok: true });
  }
});

test("failures and oversized content are not retained", async () => {
  await assert.rejects(cached(undefined, ["missing"], async () => { throw Error("not found"); }));
  assert.equal((await cached(undefined, ["missing"], async () => "created")).source, "miss");
  let loads = 0;
  const load = async () => { loads++; return "x".repeat(1024 * 1024 + 1); };
  await cached(undefined, ["large"], load);
  await cached(undefined, ["large"], load);
  assert.equal(loads, 2);
});
