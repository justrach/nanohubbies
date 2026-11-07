// Multiplayer simulation for validated stable (docs/validated-stable.md).
// Several signed-in people each run several scripted agents (HTTP clients
// with their own registered handles and scoped credentials, not LLMs) against
// one public workspace on an isolated Worker, while real runners
// (scripts/validation/runner.ts, bubblewrap) check versions concurrently.
//   node scripts/sim-validation.ts [agentsPerPerson=2] [rounds=3]
// Asserts invariants; prints measured counts and times.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { teamFixture } from "./team/fixture.ts";
import { validateOnce } from "./validation/runner.ts";

const exec = promisify(execFile);
const MAX_ATTEMPTS = Number(process.env.SIM_MAX_ATTEMPTS ?? 30);
const attemptsToLand: number[] = [];
const PER = Number(process.argv[2] ?? 2), ROUNDS = Number(process.argv[3] ?? 3);
const TOKEN = "validator-" + "s".repeat(32);
const f = await teamFixture({ VALIDATOR_TOKEN: TOKEN, VALIDATION_CLAIM_MS: "1500" });
const scratch = await mkdtemp(join(tmpdir(), "nanohub-sim-"));
const t0 = Date.now();
const ms = () => Date.now() - t0;
const say = (m: string) => { if (process.env.SIM_DEBUG) console.error(`[${ms()}ms] ${m}`); };
const trunk = "sim", base = `/api/trunks/${trunk}`;
const bearer = { authorization: `Bearer ${TOKEN}` };
const runner = (name: string) => ({ url: f.origin, token: TOKEN, trunk, runner: name });
const head = async () => (await f.request("GET", base)).json() as Promise<{ version: number; commit: string; tree: string }>;
const status = async () => (await f.request("GET", `${base}/validation`)).json() as Promise<any>;
const stableRef = async () => /^([0-9a-f]{40})\trefs\/heads\/stable$/m.exec(await (await f.request("GET", `/git/${trunk}.git/info/refs`)).text())?.[1] ?? null;
async function session(localId: string, subject: string, name: string) {
  const r = await f.request("POST", "/fixture/session", { localId, subject, name });
  return { cookie: r.headers.getSetCookie().map((v) => v.split(";")[0]).join("; ") };
}
const tally = { landed: 0, conflict: 0, replans: 0, retriesReplayed: 0, busy: 0 };
const landedBy: { agent: string; person: string; version: number; commit: string; file: string }[] = [];

try {
  const people = await Promise.all(["alice", "bob", "carol"].map(async (n, i) => ({ name: n, auth: await session(`sim-${n}`, String(500 + i), n) })));
  await f.json("POST", base, { files: [
    { path: "shared.js", text: "function bump(n) {\n  return n + 1;\n}\nmodule.exports = { bump };\n" },
    { path: "limits.js", text: "module.exports = { MAX: 5 };\n" },
    { path: "items.js", text: "module.exports = ['a', 'b'];\n" },
    { path: "test.js", text: "const { MAX } = require('./limits.js');\nconst items = require('./items.js');\nconst { bump } = require('./shared.js');\nif (items.length > MAX) { console.error(`too many items: ${items.length} > ${MAX}`); process.exit(1); }\nif (bump(1) !== 2) { console.error('bump broke'); process.exit(1); }\nconsole.log('ok', items.length, MAX);\n" },
  ] }, people[0].auth);
  await f.json("POST", `${base}/validation`, { command: "node test.js" }, people[0].auth);

  // Each person registers agents and gets each one a scoped credential.
  const agents: { handle: string; person: string; auth: Record<string, string> }[] = [];
  for (const p of people) for (let i = 0; i < PER; i++) {
    const handle = `${p.name}-${i}`;
    await f.json("POST", `${base}/agents`, { handle, type: "sim" }, p.auth);
    const { token } = await f.json("POST", `${base}/agents/${handle}/token`, {}, p.auth);
    agents.push({ handle, person: p.name, auth: { authorization: `Basic ${btoa(`${handle}:${token}`)}` } });
  }

  // One agent's change: read the shared function (a strong read), then either
  // rewrite it (overlapping) or add its own file (independent). On conflict,
  // start a new life and plan again. Every submit is sent twice: the second is
  // a retry of the same life and payload and must replay the same receipt.
  async function work(a: typeof agents[number], round: number, overlap: boolean) {
    const p = `${base}/agents/${a.handle}`;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      say(`${a.handle} r${round} a${attempt} life`);
      const life = await f.json("POST", `${p}/lives`, {}, a.auth);
      say(`${a.handle} symbol`);
      await f.json("GET", `${p}/symbol?path=shared.js&name=bump`, undefined, a.auth);
      const file = `work/${a.handle}-${round}.txt`;
      const edits = overlap
        ? [{ op: "replace", path: "shared.js", symbol: "bump", text: `function bump(n) {\n  // touched by ${a.handle} r${round} a${attempt}\n  return n + 1;\n}` }, { op: "create", path: file, text: `${a.handle} ${round}\n` }]
        : [{ op: "create", path: file, text: `${a.handle} ${round}\n` }];
      const body = { life: life.life, intent: `${a.handle} round ${round}`, edits };
      say(`${a.handle} submit`);
      const [r1, r2] = await Promise.all([1, 2].map(() => f.request("POST", `${p}/submit`, body, a.auth).then((r) => r.json() as Promise<any>)));
      if (r1.status === "busy" || r2.status === "busy") { tally.busy++; await new Promise((x) => setTimeout(x, r1.retryAfterMs ?? 200)); continue; }
      assert.equal(r1.id, r2.id); assert.equal(r1.status, r2.status); assert.equal(r1.version, r2.version);
      tally.retriesReplayed++;
      if (r1.status === "landed") { attemptsToLand.push(attempt + 1); tally.landed++; landedBy.push({ agent: a.handle, person: a.person, version: r1.version, commit: r1.commit, file }); return; }
      assert.equal(r1.status, "conflict", JSON.stringify(r1));
      tally.conflict++; tally.replans++;
    }
    throw new Error(`${a.handle} never landed in ${MAX_ATTEMPTS} attempts (overlapping=${overlap})`);
  }

  // Runners: several at once, polling while agents land.
  let stop = false;
  const verdicts: any[] = [];
  const stableSeen: number[] = [];
  const runners = (process.env.SIM_AGENTS_ONLY ? [] : ["r1", "r2", "r3"]).map(async (name) => {
    while (!stop) {
      say(`${name} validate`);
      const out = await validateOnce(runner(name)).catch((e) => ({ error: String(e) }));
      say(`${name} -> ${JSON.stringify({ ...(out as any), log: undefined })}`);
      if ((out as any).claimed) verdicts.push({ runner: name, ...(out as any), log: undefined });
      const s = await status();
      if (s.stable) stableSeen.push(s.stable.version);
      await new Promise((x) => setTimeout(x, 50));
    }
  });

  say("agents start");
  const phase: Record<string, number> = {};
  let start = ms();
  for (let round = 0; round < ROUNDS; round++) await Promise.all(agents.map((a, i) => work(a, round, i % 2 === 0)));
  phase.agents = ms() - start;
  if (process.env.SIM_AGENTS_ONLY) { console.log(JSON.stringify({ agents: agents.length, landed: tally.landed, conflicts: tally.conflict, maxAttempts: Math.max(...attemptsToLand), ms: phase.agents })); process.exit(0); }

  // Two people's agents make individually fine, non-overlapping changes that
  // break together: alice lowers MAX, bob adds items. Both land.
  const alice = agents.find((a) => a.person === "alice")!, bob = agents.find((a) => a.person === "bob")!;
  async function write(a: typeof alice, path: string, text: string, op = "write") {
    const p = `${base}/agents/${a.handle}`;
    for (;;) {
      const life = await f.json("POST", `${p}/lives`, {}, a.auth);
      const r = await f.json("POST", `${p}/submit`, { life: life.life, intent: `${a.handle} edits ${path}`, edits: [{ op, path, text }] }, a.auth);
      say(`${a.handle} write ${path}: ${r.status} ${JSON.stringify(r).slice(0, 200)}`);
      if (r.status === "landed") { landedBy.push({ agent: a.handle, person: a.person, version: r.version, commit: r.commit, file: path }); return r; }
      assert.equal(r.status, "conflict", JSON.stringify(r));
      tally.replans++;
    }
  }
  const before = await head();
  const [ra, rb] = await Promise.all([write(alice, "limits.js", "module.exports = { MAX: 3 };\n"), write(bob, "items.js", "module.exports = ['a', 'b', 'c', 'd'];\n")]);
  assert.equal(ra.status, "landed"); assert.equal(rb.status, "landed");
  const broken = Math.max(ra.version, rb.version);
  start = ms();
  for (let i = 0; i < 200 && !verdicts.some((v) => v.version >= broken); i++) await new Promise((x) => setTimeout(x, 100));
  const failed = verdicts.find((v) => v.version >= broken);
  assert.equal(failed.passed, false, "the combination must fail");
  const failRow = (await status()).results.find((r: any) => r.version === failed.version);
  assert.ok(failRow.from <= Math.min(ra.version, rb.version), `failure names the range v${failRow.from}..v${failRow.version}, which covers both authors`);
  phase.detectFailure = ms() - start;
  const stableAtFailure = (await status()).stable;
  assert.ok(stableAtFailure && stableAtFailure.version <= before.version, "stable stays at or before the last good version");

  // While main is red, other agents keep landing; stable must not move.
  await Promise.all(agents.slice(0, 3).map((a) => work(a, 99, false)));
  await new Promise((x) => setTimeout(x, 1500));
  assert.equal((await status()).stable.version, stableAtFailure.version, "stable does not move while every newer version fails");
  // Repair by a third person.
  const carol = agents.find((a) => a.person === "carol")!;
  start = ms();
  const fix = await write(carol, "limits.js", "module.exports = { MAX: 10 };\n");
  for (let i = 0; i < 200 && ((await status()).stable?.version ?? 0) < fix.version; i++) await new Promise((x) => setTimeout(x, 100));
  phase.repairToStable = ms() - start;
  assert.ok((await status()).stable.version >= fix.version, "a repair landing makes stable move again");

  // Claim expiry: a claim abandoned by a crashed runner is issued again.
  stop = true; await Promise.all(runners);
  await write(carol, "work/expiry.txt", "x\n", "create");
  const { claim: dead } = await f.json("POST", `${base}/validation/claim`, { runner: "crashed" }, bearer);
  assert.ok(dead);
  assert.equal((await f.json("POST", `${base}/validation/claim`, {}, bearer)).claim, null);
  await new Promise((x) => setTimeout(x, 1700));
  const { claim: again } = await f.json("POST", `${base}/validation/claim`, { runner: "rescue" }, bearer);
  assert.equal(again.version, dead.version);
  const lateDead = await f.request("POST", `${base}/validation/report`, { claim: dead.id, version: dead.version, commit: dead.commit, tree: dead.tree, passed: true }, bearer);
  assert.equal(lateDead.status, 409, "the expired claim's late report is refused once re-issued");
  await f.json("POST", `${base}/validation/report`, { claim: again.id, version: again.version, commit: again.commit, tree: again.tree, passed: true, exitCode: 0 }, bearer);

  // Raw git push to stable: refused for a real agent credential.
  const repo = join(scratch, "push");
  await exec("git", ["clone", "-q", `${f.origin}/git/${trunk}.git`, repo]);
  const g = (...a: string[]) => exec("git", ["-C", repo, ...a]);
  await g("config", "user.name", "x"); await g("config", "user.email", "x@example.invalid");
  await writeFile(join(repo, "evil.txt"), "skip the check\n");
  await g("add", "evil.txt"); await g("commit", "-qm", "push straight to stable");
  const [user, pass] = atob(alice.auth.authorization.slice(6)).split(":");
  await g("remote", "set-url", "--push", "origin", `${f.origin.replace("://", `://${user}:${pass}@`)}/git/${trunk}.git`);
  const stableBefore = await stableRef();
  await assert.rejects(g("push", "origin", "HEAD:refs/heads/stable"), /stable is protected/);
  await assert.rejects(g("push", "origin", "HEAD:refs/heads/stable/x"), /stable is protected/);
  assert.equal(await stableRef(), stableBefore);

  // Invariants.
  const final = await head();
  await exec("git", ["-C", repo, "fetch", "-q", "origin"]);
  const log = (await exec("git", ["-C", repo, "log", "--format=%H%x00%B%x1e", "origin/main"], { maxBuffer: 1 << 26 })).stdout;
  const byCommit = new Map(log.split("\x1e").filter((e) => e.trim()).map((e) => { const [c, body] = e.trim().split("\0"); return [c, { agent: /^Agent: (.*)$/m.exec(body)?.[1] ?? "", owner: /^On-behalf-of: (.*)$/m.exec(body)?.[1] ?? "" }]; }));
  for (const l of landedBy) {
    const row = byCommit.get(l.commit);
    assert.ok(row, `landed commit ${l.commit} (v${l.version}, ${l.agent}) is on main`);
    assert.equal(row.agent, l.agent); assert.equal(row.owner, l.person);
  }
  const tree = (await exec("git", ["-C", repo, "ls-tree", "-r", "--name-only", "origin/main"])).stdout;
  for (const l of landedBy) if (l.file.startsWith("work/")) assert.ok(tree.includes(l.file), `${l.file} survives`);
  const st = await status();
  const stableResult = st.results.find((r: any) => r.passed && r.advanced && r.commit === st.stable.commit);
  assert.ok(stableResult, "stable is a commit with a recorded advancing pass");
  assert.equal((await exec("git", ["-C", repo, "rev-parse", `${st.stable.commit}^{tree}`])).stdout.trim(), st.stable.tree);
  for (let i = 1; i < stableSeen.length; i++) assert.ok(stableSeen[i] >= stableSeen[i - 1], "stable never moved backwards");
  const claimed = new Map<number, number>();
  for (const v of verdicts) claimed.set(v.version, (claimed.get(v.version) ?? 0) + 1);

  console.log(JSON.stringify({
    people: people.length, agents: agents.length, rounds: ROUNDS, runners: 3,
    landed: landedBy.length, maxAttemptsToLand: Math.max(...attemptsToLand), conflictsReplanned: tally.conflict, retriesReplayedIdentically: tally.retriesReplayed, busy: tally.busy,
    mainVersion: final.version, stableVersion: st.stable.version,
    runnerVerdicts: verdicts.length, passed: verdicts.filter((v) => v.passed).length, failed: verdicts.filter((v) => !v.passed).length,
    versionsCheckedTwiceByRunners: [...claimed.values()].filter((n) => n > 1).length,
    versionsSkipped: final.version - claimed.size,
    failureRange: `v${failRow.from}..v${failRow.version}`, semanticAuthors: [ra.version, rb.version],
    ms: { ...phase, total: ms() },
  }, null, 1));
  console.log("ok: no landed change lost; trailers name each agent and person; stable is an exact tested tree, never moved backwards; failure named as a range; repair resumed stable; expired claims re-issue; git push to stable refused");
} finally {
  await rm(scratch, { recursive: true, force: true });
  await f.close();
}
