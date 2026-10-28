import test from "node:test";
import assert from "node:assert/strict";
import { deployHeldFixturePhase, phaseDeploymentSnapshot } from "./phase-deploy.mjs";

const accountId = "a".repeat(32), runId = "mabcdefgh-0123456789";
const worker = `nh-vault-recovery-${runId}-app`;
const oldVersion = "11111111-1111-1111-1111-111111111111";
const newVersion = "22222222-2222-2222-2222-222222222222";
const observation = (version = oldVersion, phase = "verify") => ({
  version, metadata: { id: version, resources: {
    script: { etag: "fixture-code-hash" },
    script_runtime: { limits: { subrequests: 50000 }, compatibility_date: "2026-09-01" },
    bindings: [
      { name: "NANOHUB_RECOVERY_HOLD", type: "plain_text", text: "1" },
      { name: "HOSTED_REPO_RECOVERY", type: "plain_text", text: "1" },
      { name: "HOSTED_REPO_PHASE", type: "plain_text", text: phase },
      { name: "OBJECTS", type: "r2_bucket", bucket_name: "owned-bucket" },
    ],
  } },
});
const failure = () => ({ code: 1, stdout: "Starting asset upload...", stderr:
  `A request to the Cloudflare API (/accounts/${accountId}/workers/scripts/${worker}/assets-upload-session) failed.\nUnknown error [code: 10013]`, step: "049-deploy" });
const success = () => ({ code: 0, stdout: `Current Version ID: ${newVersion}`, stderr: "" });
function fixture({ results = [failure(), success()], observations = [observation(), observation(newVersion, "frozen")] } = {}) {
  const calls = [], receipts = [];
  let deployments = 0, reads = 0;
  const options = {
    accountId, runId, worker, purpose: "vault-recovery", phase: "frozen", previousPhase: "verify",
    previous: observation(),
    deployOnce: async () => { calls.push("deploy"); return results[deployments++]; },
    observe: async () => { calls.push("observe"); return observations[reads++]; },
    recordRetry: async receipt => { calls.push("receipt"); receipts.push(receipt); },
    sleep: async ms => { assert.equal(ms, 1000); calls.push("backoff"); },
  };
  return { options, calls, receipts };
}

test("one exact asset-session failure retries only after unchanged held metadata and a persisted proof", async () => {
  const f = fixture();
  const result = await deployHeldFixturePhase(f.options);
  assert.equal(result.version, newVersion);
  assert.equal(result.attempts, 2);
  assert.deepEqual(f.calls, ["deploy", "backoff", "observe", "receipt", "deploy", "observe"]);
  assert.equal(f.receipts.length, 1);
  assert.equal(f.receipts[0].failedStep, "049-deploy");
  assert.deepEqual(f.receipts[0].previous, f.receipts[0].observed);
  assert.equal(JSON.stringify(f.receipts).includes("owned-bucket"), false);
});

test("ordinary successful phase deployment still requires acknowledged active target phase", async () => {
  const f = fixture({ results: [success()], observations: [observation(newVersion, "frozen")] });
  assert.equal((await deployHeldFixturePhase(f.options)).attempts, 1);
  assert.deepEqual(f.calls, ["deploy", "observe"]);
  assert.equal(f.receipts.length, 0);
});

test("fingerprint covers the complete resource graph and canonicalizes binding/object order", () => {
  const before = observation(), reordered = observation();
  reordered.metadata.resources.bindings.reverse();
  reordered.metadata.resources.script_runtime = { compatibility_date: "2026-09-01", limits: { subrequests: 50000 } };
  const expected = phaseDeploymentSnapshot(before, "verify");
  assert.deepEqual(phaseDeploymentSnapshot(reordered, "verify"), expected);
  for (const mutate of [
    value => { value.metadata.resources.script.etag = "different-code"; },
    value => { value.metadata.resources.script_runtime.limits.subrequests = 1000; },
    value => { value.metadata.resources.bindings.at(-1).bucket_name = "other-bucket"; },
    value => { value.metadata.resources.assets = { unexpected: true }; },
  ]) {
    const changed = observation(); mutate(changed);
    assert.notEqual(phaseDeploymentSnapshot(changed, "verify").resourceSha256, expected.resourceSha256);
  }
});

test("unowned workers, accounts, purposes and malformed baselines fail before any deployment", async () => {
  for (const overrides of [
    { worker: "production-app" }, { worker: worker.replace(runId, "manotherx-0123456789") },
    { accountId: "invalid" }, { runId: "invalid" }, { purpose: "git-import" }, { phase: "open" },
    { previousPhase: "open" }, { recordRetry: undefined },
  ]) {
    const f = fixture();
    await assert.rejects(() => deployHeldFixturePhase({ ...f.options, ...overrides }));
    assert.deepEqual(f.calls, []);
  }
  for (const mutate of [
    value => { value.version = "invalid"; },
    value => { value.metadata.id = newVersion; },
    value => { value.metadata.resources.bindings[0].text = "0"; },
    value => { value.metadata.resources.bindings.push(value.metadata.resources.bindings[0]); },
    value => { delete value.metadata.resources.script_runtime; },
  ]) {
    const f = fixture(); mutate(f.options.previous);
    await assert.rejects(() => deployHeldFixturePhase(f.options));
    assert.deepEqual(f.calls, []);
  }
});

test("ambiguous, authenticated, post-upload and unrelated failures never retry", async () => {
  const variants = [
    { stderr: "fetch failed" }, { stderr: "Unknown error [code: 10013]" },
    { timedOut: true }, { executionUncertain: true },
    ...["Uploaded app", "Deployed triggers", `Current Version ID: ${oldVersion}`, "[code: 10000]", "401", "403", "authentication failed", "permission denied", "ECONNRESET", "fetch failed", "timed out"].map(extra => ({ stdout: extra })),
    { stderr: failure().stderr.replace(accountId, "b".repeat(32)) },
    { stderr: failure().stderr.replace(worker, "production-app") },
    { stderr: failure().stderr.replace("assets-upload-session", "versions") },
    { stderr: failure().stderr.replace("10013", "10000") },
    { stderr: failure().stderr + "\n" + failure().stderr },
  ];
  for (const overrides of variants) {
    const f = fixture({ results: [{ ...failure(), ...overrides }] });
    await assert.rejects(() => deployHeldFixturePhase(f.options));
    assert.deepEqual(f.calls, ["deploy"], JSON.stringify(overrides));
    assert.deepEqual(f.receipts, []);
  }
});

test("version, binding, runtime and phase drift refuse a second deployment", async () => {
  const changes = [
    observation(newVersion),
    observation(oldVersion, "frozen"),
    observation(), observation(), observation(),
  ];
  changes[2].metadata.resources.bindings.at(-1).bucket_name = "other-bucket";
  changes[3].metadata.resources.script_runtime.limits.subrequests = 100;
  changes[4].metadata.resources.bindings[0].text = "0";
  for (const changed of changes) {
    const f = fixture({ observations: [changed] });
    await assert.rejects(() => deployHeldFixturePhase(f.options));
    assert.deepEqual(f.calls, ["deploy", "backoff", "observe"]);
    assert.equal(f.receipts.length, 0);
  }
});

test("failed provider observation or proof persistence prevents retry", async () => {
  for (const operation of ["observe", "recordRetry", "sleep"]) {
    const f = fixture();
    f.options[operation] = async () => { throw Error("injected failure"); };
    await assert.rejects(() => deployHeldFixturePhase(f.options), /injected failure/);
    assert.equal(f.calls.filter(value => value === "deploy").length, 1);
  }
});

test("at most two deployment attempts even when the exact failure recurs", async () => {
  const f = fixture({ results: [failure(), failure()] });
  await assert.rejects(() => deployHeldFixturePhase(f.options), /Phase deployment failed/);
  assert.deepEqual(f.calls, ["deploy", "backoff", "observe", "receipt", "deploy"]);
  assert.equal(f.receipts.length, 1);
});

test("a thrown deploy or success without one valid acknowledgement cannot retry", async () => {
  for (const stdout of ["", "Current Version ID: bad", `Current Version ID: ${newVersion}x`, `Current Version ID: ${newVersion}\nCurrent Version ID: ${newVersion}`]) {
    const f = fixture({ results: [{ code: 0, stdout, stderr: "" }] });
    await assert.rejects(() => deployHeldFixturePhase(f.options), /not acknowledged/);
    assert.deepEqual(f.calls, ["deploy"]);
  }
  const f = fixture();
  f.options.deployOnce = async () => { f.calls.push("deploy"); throw Error("unknown mutation outcome"); };
  await assert.rejects(() => deployHeldFixturePhase(f.options), /unknown mutation outcome/);
  assert.deepEqual(f.calls, ["deploy"]);
});

test("a successful command with inactive version or wrong target phase stays closed", async () => {
  for (const observed of [observation(oldVersion, "frozen"), observation(newVersion, "verify")]) {
    const f = fixture({ results: [success()], observations: [observed] });
    await assert.rejects(() => deployHeldFixturePhase(f.options));
    assert.deepEqual(f.calls, ["deploy", "observe"]);
  }
});
