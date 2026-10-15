import assert from "node:assert/strict";
import test from "node:test";
import { agentHandle, setupFacts } from "../src/onboarding/model.ts";
import { api, ApiError, trunkPath } from "../src/lib/api.ts";
import { repoOf, nameFor, trunkDestination } from "../src/views/start-model.ts";

test("scripted practice runs do not prove that a person's agent connected", () => {
  assert.deepEqual(setupFacts([{ kind: "scripted", landed: 20 }], 0), {
    connected: false, landed: false, agents: 0,
  });
});

test("connection evidence survives reload, but needs actual agent presence or token use", () => {
  assert.equal(setupFacts([], 0).connected, false);
  assert.equal(setupFacts([], 1).connected, true);
  assert.deepEqual(setupFacts([{ kind: "agent", landed: 0 }], 0), {
    connected: true, landed: false, agents: 1,
  });
});

test("only a real agent landing completes the first-change step", () => {
  assert.equal(setupFacts([{ kind: "agent", landed: 0 }], 1).landed, false);
  assert.equal(setupFacts([{ kind: "agent", landed: 7 }], 0).landed, true);
});

test("repository input accepts GitHub links without importing a foreign host", () => {
  assert.equal(repoOf(" apple/container "), "apple/container");
  assert.equal(repoOf("https://github.com/apple/container.git#main"), "apple/container");
  assert.equal(repoOf("https://github.com/apple/container/tree/main/src"), "apple/container");
  assert.equal(repoOf("https://gitlab.com/apple/container"), null);
  assert.equal(repoOf("https://github.com.evil.test/apple/container"), null);
  assert.equal(repoOf("--help"), null);
});

test("import names are safe and onboarding routes stay separate from code routes", () => {
  assert.equal(nameFor("owner/My.Repo"), "my-repo");
  assert.equal(nameFor("owner/..."), "trunk");
  assert.equal(nameFor("owner/" + "a".repeat(80)).length, 50);
  assert.equal(trunkDestination("hello", "setup"), "/t/hello/setup");
  assert.equal(trunkDestination("hello", "code"), "/t/hello");
});

test("agent identity is bounded and cannot inject credentials or paths into a push URL", () => {
  assert.equal(agentHandle("  :bot/name@host  "), "bot-name-host");
  assert.equal(agentHandle("---"), "my-agent");
  assert.equal(agentHandle("a".repeat(80)).length, 48);
  assert.equal(agentHandle("MY_Agent"), "my-agent");
});

test("onboarding API requests preserve trunk encoding and server refusal details", async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (path, options) => {
    requests.push({ path, ...options });
    return new Response(JSON.stringify({ error: "Sign in before creating a token", code: "auth_required" }), {
      status: 401, headers: { "content-type": "application/json" },
    });
  };
  try {
    await assert.rejects(api("/api/tokens", { body: { label: "reviewer", trunk: "sample" } }), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 401);
      assert.equal(error.body.code, "auth_required");
      assert.match(error.message, /Sign in/);
      return true;
    });
    assert.equal(requests[0].method, "POST");
    assert.deepEqual(JSON.parse(requests[0].body), { label: "reviewer", trunk: "sample" });
    assert.equal(trunkPath("owner/name"), "/api/trunks/owner%2Fname");
  } finally {
    globalThis.fetch = original;
  }
});
