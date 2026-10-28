import test from "node:test";
import assert from "node:assert/strict";
import { createSandboxAccessPreflight } from "../../../tools/sandbox-access.mjs";

const tick = () => new Promise(resolve => setImmediate(resolve));

test("concurrent repository workers share one read-only access check and bounded success receipt", async () => {
  let checks = 0, release, clock = 1000;
  const blocked = new Promise(resolve => { release = resolve; });
  const verify = createSandboxAccessPreflight({ now: () => clock, ttlMs: 100,
    probe: async key => { checks++; assert.equal(key, "synthetic-account-key"); await blocked; return { accountInventory: "must-not-retain" }; } });
  const pending = Array.from({ length: 20 }, () => verify("synthetic-account-key"));
  await tick(); assert.equal(checks, 1); release();
  const results = await Promise.all(pending);
  assert.deepEqual(results[0], { sandboxAccessVerified: true, checkedAt: 1000, expiresAt: 1100 });
  assert.ok(results.every(result => result === results[0]));
  assert.equal(JSON.stringify(results).includes("must-not-retain"), false);
  assert.equal(JSON.stringify(results).includes("synthetic-account-key"), false);
  clock = 1099; await verify("synthetic-account-key"); assert.equal(checks, 1);
  clock = 1100; await verify("synthetic-account-key"); assert.equal(checks, 2);
});

test("key rotation and clock rollback cannot reuse another cached authorization", async () => {
  let clock = 1000; const checked = [];
  const verify = createSandboxAccessPreflight({ now: () => clock, probe: async key => checked.push(key) });
  await verify("first-key"); await verify("second-key"); await verify("first-key");
  assert.deepEqual(checked, ["first-key", "second-key"]);
  clock = 999; await verify("first-key"); assert.deepEqual(checked, ["first-key", "second-key", "first-key"]);
});

test("scope failures coalesce across workers, cache briefly and permit recovery after key repair", async () => {
  let checks = 0, clock = 1000, valid = false;
  const verify = createSandboxAccessPreflight({ now: () => clock, failureTtlMs: 50, probe: async () => {
    checks++; if (!valid) throw Object.assign(Error("Codegraff API key requires the sandbox scope for Actions"), { status: 403 });
  } });
  const failed = await Promise.allSettled(Array.from({ length: 8 }, () => verify("scoped-key")));
  assert.equal(checks, 1);
  for (const result of failed) {
    assert.equal(result.status, "rejected"); assert.equal(result.reason.code, "sandbox_scope_required");
    assert.equal(result.reason.status, 403); assert.match(result.reason.message, /no CI job was claimed/);
  }
  clock = 1049; await assert.rejects(verify("scoped-key")); assert.equal(checks, 1);
  valid = true; clock = 1050;
  assert.equal((await verify("scoped-key")).sandboxAccessVerified, true); assert.equal(checks, 2);
});

test("synchronous probe failure cannot leave a permanently rejected pending entry", async () => {
  let clock = 1000, checks = 0;
  const verify = createSandboxAccessPreflight({ now: () => clock, failureTtlMs: 1,
    probe: () => { if (++checks === 1) throw Error("private-provider-body"); } });
  await assert.rejects(verify("valid-key"), /could not be verified/);
  clock++;
  assert.equal((await verify("valid-key")).sandboxAccessVerified, true);
  assert.equal(checks, 2);
});

test("provider bodies, credentials and transport errors are excluded from safe failures", async () => {
  for (const failure of [
    Object.assign(Error("private-provider-body"), { status: 401 }),
    Object.assign(Error("private-provider-body"), { status: 403 }),
    Object.assign(Error("private-provider-body"), { status: 429 }),
    Object.assign(Error("private-provider-body"), { status: 503 }),
    Object.assign(Error("private-provider-body"), { code: "ECONNRESET" }),
    SyntaxError("private-provider-body"),
  ]) {
    const verify = createSandboxAccessPreflight({ probe: async () => { throw failure; } });
    await assert.rejects(verify("private-key-value"), error => {
      assert.equal(error.code, "sandbox_access_unverified");
      assert.match(error.message, /no CI job was claimed/);
      assert.equal(String(error).includes("private-provider-body"), false);
      assert.equal(String(error).includes("private-key-value"), false);
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});

test("missing, malformed and oversized keys never reach the provider", async () => {
  let checks = 0;
  const verify = createSandboxAccessPreflight({ probe: async () => { checks++; } });
  for (const key of [undefined, null, "", "bad\nvalue", "bad value", "bad\x7fvalue", "x".repeat(4097)])
    await assert.rejects(verify(key), /valid single-line/);
  assert.equal(checks, 0);
});

test("cache retention and configuration bounds are explicit", async () => {
  let checks = 0;
  const verify = createSandboxAccessPreflight({ maxEntries: 1, probe: async () => { checks++; } });
  await verify("first"); await verify("second"); await verify("first"); assert.equal(checks, 3);
  for (const options of [{ ttlMs: 0 }, { ttlMs: 300001 }, { failureTtlMs: 5001 }, { maxEntries: 0 }, { maxEntries: 17 }])
    assert.throws(() => createSandboxAccessPreflight(options), /cache bounds/);
});
