// Validated stable end to end on an isolated Worker (real SQLite DOs, R2, D1;
// no hosted bindings) and the real runner (scripts/validation/runner.ts) in a
// bubblewrap sandbox. The owner sets a check; a passing check moves
// refs/heads/stable to that exact commit; a failing one leaves it; retries are
// idempotent; stale, forged, out-of-order and unauthorized reports cannot move
// it; pushes cannot write it; and without the validator secret nothing moves.
// Needs `bwrap` (bubblewrap) with unprivileged user namespaces. Run from
// packages/api: node scripts/smoke-validation.ts
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { teamFixture } from "./team/fixture.ts";
import { selfTest, validateOnce } from "./validation/runner.ts";

const exec = promisify(execFile);
const TOKEN = "validator-" + "x".repeat(32);
const f = await teamFixture({ VALIDATOR_TOKEN: TOKEN });
const scratch = await mkdtemp(join(tmpdir(), "nanohub-validation-smoke-"));
try {
  const owner = await f.login("val-owner", "101");
  const other = await f.login("val-other", "202");
  const trunk = "validation-test", base = `/api/trunks/${trunk}`;
  const runner = (token = TOKEN) => ({ url: f.origin, token, trunk, runner: "smoke" });
  const bearer = (token = TOKEN) => ({ authorization: `Bearer ${token}` });
  const status = async () => (await f.request("GET", `${base}/validation`)).json() as Promise<any>;
  const head = async () => (await f.request("GET", base)).json() as Promise<{ version: number; commit: string; tree: string }>;
  const refs = async () => (await (await f.request("GET", `/git/${trunk}.git/info/refs`)).text());
  const stableRef = async () => /^([0-9a-f]{40})\trefs\/heads\/stable$/m.exec(await refs())?.[1] ?? null;
  async function land(name: string, text: string) {
    const agent = `${base}/agents/${name}`;
    // A lane can start a life a version behind; a conflict re-plans, as agents do.
    let r: any;
    for (let i = 0; i < 5; i++) {
      const life = await f.json("POST", `${agent}/lives`, {});
      r = await f.json("POST", `${agent}/submit`, { life: life.life, intent: `Set value to ${name}`, edits: [{ op: "write", path: "value.js", text }], wait: "published" });
      if (r.status !== "conflict") break;
    }
    assert.equal(r.status, "landed", JSON.stringify(r));
    for (let i = 0; i < 100 && (await head()).version < r.version; i++) await new Promise((x) => setTimeout(x, 100));
    return head();
  }

  await selfTest(process.env.BWRAP ?? "/usr/bin/bwrap");
  console.log("ok: bubblewrap sandbox self-test passed (no network, no $HOME, cleared env, read-only /usr)");

  await f.json("POST", base, { files: [
    { path: "value.js", text: "module.exports = 1;\n" },
    { path: "test.js", text: "const v = require('./value.js');\nif (typeof v !== 'number' || v < 1) { console.error('bad value', v); process.exit(1); }\nconsole.log('value ok', v);\n" },
  ] }, owner);
  const v1 = await head();
  assert.equal((await validateOnce(runner())).claimed, false);
  assert.equal(await stableRef(), null);
  console.log("ok: without a configured check nothing is claimed and there is no stable ref");

  assert.equal((await f.request("POST", `${base}/validation`, { command: "node test.js" }, other)).status, 403);
  assert.equal((await f.request("POST", `${base}/validation`, { command: "node test.js" })).status, 403);
  assert.equal((await f.request("POST", `${base}/validation`, { command: "node test.js" }, { ...owner, Origin: "https://elsewhere.example" })).status, 403);
  await f.json("POST", `${base}/validation`, { command: "node test.js" }, owner);
  console.log("ok: only the signed-in owner, same-origin, configures the check");

  assert.equal((await f.request("POST", `${base}/validation/claim`, {})).status, 401);
  assert.equal((await f.request("POST", `${base}/validation/claim`, {}, bearer("wrong-" + "y".repeat(30)))).status, 401);
  assert.equal((await f.request("POST", `${base}/validation/report`, { claim: "x", version: 1, commit: v1.commit, tree: v1.tree, passed: true }, owner)).status, 401);
  console.log("ok: claims and reports need the validator secret; an owner session is not enough");

  const pass1 = await validateOnce(runner());
  assert.equal(pass1.claimed, true);
  assert.equal(pass1.passed, true, pass1.log);
  assert.equal(pass1.commit, v1.commit);
  assert.equal(await stableRef(), v1.commit);
  assert.equal((await status()).stable.commit, v1.commit);
  const cloned = join(scratch, "clone");
  await exec("git", ["clone", "--quiet", "--branch", "stable", `${f.origin}/git/${trunk}.git`, cloned]);
  assert.equal((await exec("git", ["-C", cloned, "rev-parse", "HEAD"])).stdout.trim(), v1.commit);
  console.log(`ok: a sandboxed pass moves refs/heads/stable to the exact tested commit ${v1.commit.slice(0, 12)}, and git clones it`);
  assert.equal((await validateOnce(runner())).claimed, false);
  console.log("ok: a checked version is not claimed again");

  const v2 = await land("broken", "module.exports = 0;\n");
  const fail2 = await validateOnce(runner());
  assert.equal(fail2.version, v2.version);
  assert.equal(fail2.passed, false);
  assert.equal(fail2.exitCode, 1);
  assert.match(fail2.log ?? "", /bad value 0/);
  assert.equal(await stableRef(), v1.commit);
  assert.equal((await head()).commit, v2.commit);
  console.log(`ok: a failing check on v${v2.version} records the failure and leaves stable at v${v1.version}; main still landed v${v2.version}`);

  // A check cannot reach the network or the runner's secrets.
  const v3 = await land("fixed", "module.exports = 3;\n");
  await f.json("POST", `${base}/validation`, { command: `node -e "require('net').connect(${new URL(f.origin).port},'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(7))"` }, owner);
  const net = await validateOnce(runner());
  assert.equal(net.exitCode, 7, net.log);
  assert.equal(await stableRef(), v1.commit);
  await f.json("POST", `${base}/validation`, { command: "test -z \"$VALIDATOR_TOKEN\" && test ! -e /home && node test.js" }, owner);
  const pass3 = await validateOnce(runner());
  assert.equal(pass3.passed, true, pass3.log);
  assert.equal(await stableRef(), v3.commit);
  console.log(`ok: inside the sandbox the API port on loopback is unreachable and secrets are absent; v${v3.version} passes and stable follows`);

  // Raw protocol: retries, conflicts, forgeries, staleness, order.
  const v4 = await land("four", "module.exports = 4;\n");
  const { claim: c4 } = await f.json("POST", `${base}/validation/claim`, { runner: "manual" }, bearer());
  assert.equal(c4.version, v4.version);
  assert.equal((await f.json("POST", `${base}/validation/claim`, {}, bearer())).claim, null, "a claimed version is not handed out twice");
  const forged = await f.request("POST", `${base}/validation/report`, { claim: c4.id, version: c4.version, commit: v1.commit, tree: v1.tree, passed: true }, bearer());
  assert.equal(forged.status, 409);
  assert.equal((await f.request("POST", `${base}/validation/report`, { claim: crypto.randomUUID(), version: c4.version, commit: c4.commit, tree: c4.tree, passed: true }, bearer())).status, 404);
  const v5 = await land("five", "module.exports = 5;\n");
  const { claim: c5 } = await f.json("POST", `${base}/validation/claim`, {}, bearer());
  assert.equal(c5.version, v5.version);
  const ok5 = await f.json("POST", `${base}/validation/report`, { claim: c5.id, version: c5.version, commit: c5.commit, tree: c5.tree, passed: true, exitCode: 0 }, bearer());
  assert.equal(ok5.stable.commit, v5.commit);
  const again5 = await f.json("POST", `${base}/validation/report`, { claim: c5.id, version: c5.version, commit: c5.commit, tree: c5.tree, passed: true, exitCode: 0 }, bearer());
  assert.equal(again5.replayed, true);
  assert.equal((await f.request("POST", `${base}/validation/report`, { claim: c5.id, version: c5.version, commit: c5.commit, tree: c5.tree, passed: false, exitCode: 1 }, bearer())).status, 409);
  const late4 = await f.json("POST", `${base}/validation/report`, { claim: c4.id, version: c4.version, commit: c4.commit, tree: c4.tree, passed: true, exitCode: 0 }, bearer());
  assert.equal(late4.result.advanced, false);
  assert.equal(late4.stable.commit, v5.commit);
  assert.equal(await stableRef(), v5.commit);
  console.log("ok: retries replay; a changed verdict, a forged commit and an unknown claim are refused; a late older pass does not move stable back");

  const v6 = await land("six", "module.exports = 6;\n");
  const { claim: c6 } = await f.json("POST", `${base}/validation/claim`, {}, bearer());
  await f.json("POST", `${base}/validation`, { command: "node test.js && echo stricter" }, owner);
  const stale6 = await f.json("POST", `${base}/validation/report`, { claim: c6.id, version: c6.version, commit: c6.commit, tree: c6.tree, passed: true, exitCode: 0 }, bearer());
  assert.equal(stale6.result.advanced, false);
  assert.equal(await stableRef(), v5.commit);
  const re6 = await validateOnce(runner());
  assert.equal(re6.version, v6.version);
  assert.equal(await stableRef(), v6.commit);
  console.log("ok: a pass under a command that has since changed does not move stable; the new command is checked again");

  for (const name of ["stable", "stable/x"]) {
    const branch = await f.request("POST", `${base}/branches`, { name, from: "main" }, owner);
    assert.ok(branch.status >= 400, `branch API wrote ${name}: ${branch.status}`);
    assert.match(JSON.stringify(await branch.json()), /stable is protected/);
  }
  const feature = await f.request("POST", `${base}/branches`, { name: "feature", from: "main" }, owner);
  assert.equal(feature.status, 200, "ordinary branches still work");
  assert.equal(await stableRef(), v6.commit);
  console.log("ok: the branch API cannot write stable");

  await f.restart();
  assert.equal(await stableRef(), v6.commit);
  console.log("ok: stable survives a restart");
} finally {
  await rm(scratch, { recursive: true, force: true });
  await f.close();
}

// Fail closed: no secret on the deployment, or no sandbox on the runner.
const g = await teamFixture({});
try {
  const owner = await g.login("val-owner", "101");
  await g.json("POST", "/api/trunks/closed", { files: [{ path: "a.txt", text: "a\n" }] }, owner);
  await g.json("POST", "/api/trunks/closed/validation", { command: "true" }, owner);
  assert.equal((await g.request("POST", "/api/trunks/closed/validation/claim", {}, { authorization: `Bearer ${TOKEN}` })).status, 503);
  await assert.rejects(validateOnce({ url: g.origin, token: TOKEN, trunk: "closed", bwrap: "/nonexistent/bwrap" }), /no sandbox/);
  console.log("ok: without VALIDATOR_TOKEN claims answer 503; without bwrap the runner refuses before claiming");
} finally { await g.close(); }
