import test from "node:test";
import assert from "node:assert/strict";
import { createRepositoryCache, FRESH_FOR } from "../src/lib/repository-cache.ts";

function fixture() {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  return { values, storage, cache: createRepositoryCache(() => storage) };
}
const repos = [{ full_name: "owner/private", private: true }];

test("fresh lists survive remount and reload without another fetch; refresh bypasses freshness", async () => {
  const { cache, storage } = fixture();
  let calls = 0;
  const fetcher = async () => { calls++; return repos; };
  await cache.load("alice/github", fetcher);
  await cache.load("alice/github", fetcher);
  const reloaded = createRepositoryCache(() => storage);
  assert.deepEqual(reloaded.read("alice/github").repos, repos);
  await reloaded.load("alice/github", fetcher);
  assert.equal(calls, 1);
  await reloaded.load("alice/github", fetcher, true);
  assert.equal(calls, 2);
});

test("expired freshness revalidates and failed refresh preserves saved suggestions", async () => {
  const { cache, values } = fixture();
  await cache.load("alice", async () => repos);
  const [key, raw] = [...values][0];
  const value = JSON.parse(raw);
  value.updatedAt -= FRESH_FOR + 1;
  values.set(key, JSON.stringify(value));
  const next = createRepositoryCache(() => ({getItem: k => values.get(k), setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k)}));
  assert.deepEqual(next.read("alice").repos, repos);
  await assert.rejects(next.load("alice", async () => { throw new Error("offline"); }));
  assert.deepEqual(next.read("alice").repos, repos);
  const updated = await next.load("alice", async () => []);
  assert.deepEqual(updated.repos, []);
});

test("account changes and sign-out discard saved private names and late responses", async () => {
  const { cache, values } = fixture();
  let finish;
  const old = cache.load("alice", () => new Promise(resolve => { finish = resolve; }));
  assert.equal(cache.read("bob"), null);
  await cache.load("bob", async () => []);
  finish(repos);
  await old;
  assert.deepEqual(cache.read("bob").repos, []);
  cache.clear();
  assert.equal(values.size, 0);
  assert.equal(cache.read("alice"), null);
});

test("simultaneous loads share one request and storage denial remains usable", async () => {
  const cache = createRepositoryCache(() => { throw new Error("storage disabled"); });
  let calls = 0;
  let finish;
  const fetcher = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const first = cache.load("alice", fetcher);
  const second = cache.load("alice", fetcher, true);
  finish(repos);
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.deepEqual(cache.read("alice").repos, repos);
});
