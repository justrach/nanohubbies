import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";
const { outputFiles } = buildSync({
  entryPoints: [new URL("../src/onboarding/agent-prompt.ts", import.meta.url).pathname],
  bundle: true, write: false, platform: "node", format: "esm",
});
const { agentPrompt } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);

const base = { trunk: "demo", origin: "http://localhost:8787", handle: "Reviewer", roster: [], now: 200000, live: true };

test("first prompt discovers owners and tasks and asks for work when unspecified", () => {
  const prompt = agentPrompt(base);
  assert.match(prompt, /as @reviewer/);
  assert.match(prompt, /GET http:\/\/localhost:8787\/api\/trunks\/demo\/agents/);
  assert.match(prompt, /owner names the person/);
  assert.match(prompt, /ask me which task to take before changing code/);
  assert.match(prompt, /already in ROOM_TOKEN/);
  assert.match(prompt, /ask for a reachable workspace URL/);
  assert.doesNotMatch(prompt, /undefined/);
});

test("roster snapshot distinguishes stale presence and ownership and remains bounded", () => {
  const entry = { id: "stable-id", handle: "builder", owner: { name: "Alex" }, type: "Codex", status: "working", task: "Auth", progress: "Testing", heartbeatAt: 1000 };
  const prompt = agentPrompt({ ...base, roster: Array(31).fill(entry), live: false });
  assert.match(prompt, /"owner": "Alex"/);
  assert.match(prompt, /"task": "Auth"/);
  assert.match(prompt, /"presence": "stale"/);
  assert.match(prompt, /connection unavailable/);
  assert.match(prompt, /Snapshot capped at 30/);
  assert.equal(prompt.split('"id": "stable-id"').length - 1, 30);
});

test("task and new credential are included without putting credentials in git URLs", () => {
  const prompt = agentPrompt({ ...base, task: "Review the parser", token: "nha_test_only", origin: "https://workspace.example.invalid" });
  assert.match(prompt, /MY REQUEST\nReview the parser/);
  assert.match(prompt, /token is "nha_test_only"/);
  assert.doesNotMatch(prompt, /:\/\/reviewer:nha_/);
  assert.doesNotMatch(prompt, /This address is local/);
  assert.match(prompt, /Keep separate cursors/);
  assert.match(prompt, /Receipt is not task completion/);
});
