import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { readInFixturePhase } from "./phase.mjs";
import { purgeFixturePage } from "../hosted-git-fixture/purge.mjs";
import { waitForFixtureHealth } from "../hosted-git-fixture/health.mjs";
import { serializedReceipt } from "../hosted-git-fixture/receipt.mjs";
import { fixtureTransportFailure } from "../hosted-git-fixture/transport.mjs";
import { mkdtemp, readFile, writeFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function withServer(handle, run) {
  const server = createServer(handle);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try { await run("http://127.0.0.1:" + server.address().port); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
function json(response, status, value, caching = "private, no-store") {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": caching });
  response.end(JSON.stringify(value));
}
const version = "11111111-1111-4111-8111-111111111111";

test("queued receipts snapshot callers and cannot race an earlier write", async () => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const started = [], written = [];
  const save = serializedReceipt(async value => { started.push(value.sequence); if (value.sequence === 1) await blocked; written.push(value.sequence); });
  const value = { sequence: 1 };
  const first = save(value); value.sequence = 2; const second = save(value); value.sequence = 3; const third = save(value);
  await Promise.resolve(); assert.deepEqual(started, [1]); release();
  await Promise.all([first, second, third]); assert.deepEqual(written, [1, 2, 3]);
});
test("a failed receipt rejects its caller while a later cleanup receipt can still persist", async () => {
  const failure = Error("disk failure"), calls = [];
  const save = serializedReceipt(async value => { calls.push(value.sequence); if (value.sequence === 1) throw failure; });
  const first = save({ sequence: 1 }), cleanup = save({ sequence: 2 });
  await assert.rejects(first, error => error === failure); await cleanup; assert.deepEqual(calls, [1, 2]);
});
test("transport diagnostics identify safe control operations without disclosing arbitrary data", () => {
  const confidential = "a".repeat(64);
  const failure = fixtureTransportFailure({ message: confidential, cause: { code: "ECONNRESET", message: confidential } },
    { method: "POST", path: "/__fixture/recovery", body: { op: "schedule", binding: "HUB", id: confidential, bookmark: confidential, token: confidential } });
  assert.match(failure.message, /POST \/__fixture\/recovery schedule HUB object:[a-f0-9]{16} \(ECONNRESET\)/);
  assert.ok(!failure.message.includes(confidential)); assert.ok(!JSON.stringify(failure.cause).includes(confidential));
  const unknown = fixtureTransportFailure({ code: confidential }, { method: confidential, path: "/private/" + confidential, body: { op: confidential } });
  assert.equal(unknown.message, "Fixture transport failed: OTHER application (unclassified)");
});

test("concurrent refused HTTP reads persist complete ordered proofs before replay", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nanohub-proof-queue-")), file = join(directory, "receipt.json");
  const record = { ids: [] }, seen = new Set(), errors = [];
  const save = serializedReceipt(async value => { await writeFile(file + ".tmp", JSON.stringify(value), { mode: 0o600 }); await rename(file + ".tmp", file); });
  try {
    await withServer(async (request, response) => {
      const id = request.url;
      if (!seen.has(id)) { seen.add(id); json(response, 503, { code: "fixture_frozen" }); return; }
      try { assert.ok(JSON.parse(await readFile(file, "utf8")).ids.includes(id)); json(response, 200, { id }); }
      catch (error) { errors.push(error.message); json(response, 500, { failed: true }); }
    }, async origin => {
      await Promise.all(Array.from({ length: 8 }, async (_, index) => {
        const id = "/read-" + index;
        const result = await readInFixturePhase(ms => fetch(origin + id, { signal: AbortSignal.timeout(ms) }), { method: "GET", phase: "verify", version }, {
          readPhase: async () => ({ phase: "verify", version, normalTrafficHeld: true }), sleep: async () => {},
          recordRetry: async () => { record.ids.push(id); await save(record); },
        });
        assert.equal(result.response.status, 200); await result.response.body.cancel();
      }));
    });
    assert.deepEqual(errors, []); assert.equal(JSON.parse(await readFile(file, "utf8")).ids.length, 8);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("real HTTP startup 404s cannot admit work before private identity and expiry match", async () => {
  let reads = 0, verified = false;
  const expiresAt = Date.now() + 60000;
  await withServer((request, response) => {
    assert.equal(request.method, "GET"); reads++;
    json(response, reads === 1 ? 404 : 200, reads === 1 ? { error: "Not found" } : { fixture: "private-hosted-git", expiresAt });
  }, async origin => {
    const result = await waitForFixtureHealth(ms => fetch(origin, { signal: AbortSignal.timeout(ms) }), { expiresAt }, {
      sleep: async () => {}, recordObservation: async proof => { verified = proof.identityVerified; },
    });
    assert.equal(verified, true); assert.equal(result.attempts, 2);
  });
  assert.equal(reads, 2);
});

test("real HTTP phase refusal is consumed once, then proof precedes the next Git read", async () => {
  let reads = 0, phases = 0, proofs = 0;
  await withServer((request, response) => {
    if (request.url === "/phase") { phases++; json(response, 200, { phase: "verify", version, normalTrafficHeld: true }); }
    else {
      reads++;
      if (reads === 1) json(response, 503, { code: "fixture_frozen" });
      else { assert.equal(proofs, 1); json(response, 404, { missing: true }); }
    }
  }, async origin => {
    const result = await readInFixturePhase(ms => fetch(origin + "/git/HEAD", { signal: AbortSignal.timeout(ms) }),
      { method: "GET", phase: "verify", version, status: 404 }, {
        readPhase: async ms => (await fetch(origin + "/phase", { signal: AbortSignal.timeout(ms) })).json(),
        recordRetry: async () => { proofs++; }, sleep: async () => {},
      });
    assert.deepEqual(await result.response.json(), { missing: true });
  });
  assert.equal(reads, 2); assert.equal(phases, 1); assert.equal(proofs, 1);
});

test("real HTTP purge waits, reconciles an explicit refusal and deletes only once", async () => {
  let statuses = 0, posts = 0, deletions = 0, readyProofs = 0;
  await withServer((request, response) => {
    if (request.url === "/status") {
      statuses++; json(response, 200, { purgeOnly: statuses > 1, bucketConfigured: true, targetConfigured: statuses === 1 }, "no-store, private");
    } else {
      posts++; assert.equal(readyProofs, posts);
      if (posts === 1) json(response, 409, { code: "fixture_purge_not_ready" });
      else { deletions++; json(response, 200, { deleted: 1, more: false }); }
    }
  }, async origin => {
    const result = await purgeFixturePage({
      readStatus: ms => fetch(origin + "/status", { signal: AbortSignal.timeout(ms) }),
      purge: ms => fetch(origin + "/purge", { method: "POST", signal: AbortSignal.timeout(ms) }).catch(error => { throw fixtureTransportFailure(error, { method: "POST", path: "/__fixture/purge" }); }),
      recordObservation: async proof => { if (proof.state === "closed-gate-observed") readyProofs++; },
      sleep: async () => {},
    });
    assert.deepEqual(result, { deleted: 1, more: false });
  });
  assert.equal(statuses, 3); assert.equal(posts, 2); assert.equal(deletions, 1);
});

test("a socket reset after real purge execution cannot replay the POST", async () => {
  let posts = 0, deletions = 0;
  await withServer((request, response) => {
    if (request.url === "/status") json(response, 200, { purgeOnly: true, bucketConfigured: true, targetConfigured: false });
    else { posts++; deletions++; request.socket.destroy(); }
  }, async origin => {
    await assert.rejects(() => purgeFixturePage({
      readStatus: ms => fetch(origin + "/status", { signal: AbortSignal.timeout(ms) }),
      purge: ms => fetch(origin + "/purge", { method: "POST", signal: AbortSignal.timeout(ms) }),
      recordObservation: async () => {}, sleep: async () => {},
    }));
  });
  assert.equal(posts, 1); assert.equal(deletions, 1);
});
