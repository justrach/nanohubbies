import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { readInFixturePhase } from "./phase.mjs";
import { purgeFixturePage } from "../hosted-git-fixture/purge.mjs";
import { waitForFixtureHealth } from "../hosted-git-fixture/health.mjs";

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
      purge: ms => fetch(origin + "/purge", { method: "POST", signal: AbortSignal.timeout(ms) }),
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
