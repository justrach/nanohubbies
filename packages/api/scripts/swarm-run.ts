// Launches scripted agents on a fresh trunk, watches the trunk's landed and
// published heads and the room's tallies while they run, then clones the
// result and checks it: linear history, valid objects, every JavaScript file
// parses, and one commit per version. Rates come from the trunk, which counts
// every landing; the room is a view, and under heavy load it can miss a batch
// of events. Landed and published throughput are reported apart, with how
// long a landed version took to become clonable, and a last RESULT line holds
// the figures as JSON.
//
// Needs `npx wrangler dev` running. SWARM_URL defaults to http://localhost:8787.
//   AGENTS=200 SECONDS=20 SHARED=0.15 SKEW=1.1 THINK=500,1500 SAMPLE_MS=2000 node scripts/swarm-run.ts

import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { BASE, call, cleanup, clone, sleep } from "./client.ts";

const AGENTS = Number(process.env.AGENTS ?? 200);
const SECONDS = Number(process.env.SECONDS ?? 20);
const SHARED = Number(process.env.SHARED ?? 0.15);
const SKEW = Number(process.env.SKEW ?? 1.1);
const THINK = (process.env.THINK ?? "500,1500").split(",").map(Number) as [number, number];
const SAMPLE_MS = Number(process.env.SAMPLE_MS ?? 2000);

type Totals = { landed: number; conflicts: number; rejected: number; unpaid: number };
type Snapshot = { totals: Totals; agents: unknown[]; seconds: [number, number, number, number][]; swarms: { running: boolean }[] };

const trunk = `swarm-${Date.now().toString(36)}`;
await call("POST", `/api/trunks/${trunk}`, { template: "shop" });
await call("POST", `/api/trunks/${trunk}/swarm`, { agents: AGENTS, seconds: SECONDS, shared: SHARED, skew: SKEW, think: THINK });
console.log(`${AGENTS} scripted agents on ${trunk} for ${SECONDS}s (shared ${SHARED}, skew ${SKEW}, think ${THINK.join("-")}ms)`);

type Info = { tip: { version: number }; head: { version: number } };
const t0 = Date.now();
let snap: Snapshot;
let last = { version: 1, at: t0 };
type Sample = { at: number; tip: number; head: number };
const samples: Sample[] = [{ at: t0, tip: 1, head: 1 }];
// Samples from once the agents have all started until they stop.
const steady: Sample[] = [];
for (;;) {
  await sleep(SAMPLE_MS);
  let room: Snapshot;
  let now: Info;
  try {
    [room, now] = await Promise.all([call<Snapshot>("GET", `/api/trunks/${trunk}/room`), call<Info>("GET", `/api/trunks/${trunk}/info`)]);
  } catch (e) {
    // One lost sample does not spoil the run.
    console.log(`  (a sample failed: ${e instanceof Error ? e.message : String(e)})`);
    continue;
  }
  snap = room;
  const at = Date.now();
  const version = now.tip.version;
  const rate = ((version - last.version) * 1000) / (at - last.at);
  last = { version, at };
  const running = snap.swarms.some((s) => s.running);
  const sample = { at, tip: version, head: now.head.version };
  samples.push(sample);
  if (running && at - t0 >= 4000 && at - t0 <= SECONDS * 1000) steady.push(sample);
  const { landed, conflicts, rejected } = snap.totals;
  console.log(
    `  t+${Math.round((at - t0) / 1000)}s  trunk v${version}  ${rate.toFixed(1)} landed/s  published v${now.head.version}   room: landed ${landed} conflicts ${conflicts} rejected ${rejected} agents ${snap.agents.length}`,
  );
  if (!running && at - t0 > SECONDS * 1000) break;
}
// Let the last submissions and the room's last frame settle, and publishing
// catch up with the tip: a clone fetches the published head.
await sleep(3000);
const stopped = Date.now();
let info = await call<Info>("GET", `/api/trunks/${trunk}/info`);
while (info.head.version < info.tip.version && Date.now() - stopped < 60_000) {
  await sleep(500);
  info = await call<Info>("GET", `/api/trunks/${trunk}/info`);
}
const behind = info.tip.version - info.head.version;
const drained = (Date.now() - stopped) / 1000;
console.log(behind ? `publishing still ${behind} versions behind after a minute` : `published caught up with the tip ${drained.toFixed(1)}s after the last landings settled`);
snap = await call<Snapshot>("GET", `/api/trunks/${trunk}/room`);

const dir = clone(`${BASE}/git/${trunk}.git`);
const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: "pipe" }).trim();
const commits = Number(git("rev-list", "--count", "HEAD"));
// A straggler can land between reading the head and cloning: the clone holds
// whatever was published by then.
const after = await call<Info>("GET", `/api/trunks/${trunk}/info`);
const merges = git("rev-list", "--merges", "HEAD");
git("fsck", "--full", "--strict");
const files: string[] = [];
const walk = (d: string) => {
  for (const name of readdirSync(d)) {
    if (name === ".git") continue;
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".js")) files.push(p);
  }
};
walk(dir);
for (const f of files) execFileSync("node", ["--check", f]);

const { landed, conflicts, rejected } = snap.totals;
const lives = landed + conflicts + rejected;
console.log(`\nlives ${lives}: ${landed} landed, ${conflicts} conflicted and re-planned, ${rejected} rejected`);
console.log(`trunk at v${info.tip.version}; clone has ${commits} commits, ${merges ? "merges" : "linear"}, fsck clean, ${files.length} JS files all parse`);
// When the tip first reached `version`, between the samples on either side.
const landedAt = (version: number) => {
  const i = samples.findIndex((s) => s.tip >= version);
  if (i <= 0) return samples[Math.max(0, i)].at;
  const [a, b] = [samples[i - 1], samples[i]];
  return a.at + ((b.at - a.at) * (version - a.tip)) / Math.max(1, b.tip - a.tip);
};
const result: Record<string, number | boolean> = { agents: AGENTS };
if (steady.length >= 2) {
  const a = steady[0];
  const b = steady[steady.length - 1];
  const secs = (b.at - a.at) / 1000;
  // How long each sample's published head had been landed: the delay before
  // a landed version could be cloned.
  const lags = steady.map((s) => (s.at - landedAt(s.head)) / 1000).sort((x, y) => x - y);
  Object.assign(result, {
    landed_per_s: Math.round((b.tip - a.tip) / secs),
    published_per_s: Math.round((b.head - a.head) / secs),
    lag_p50_s: Number(lags[Math.floor(lags.length / 2)].toFixed(2)),
    lag_max_s: Number(lags[lags.length - 1].toFixed(2)),
    window_s: Number(secs.toFixed(1)),
  });
  console.log(`sustained ${result.landed_per_s} landed/s and ${result.published_per_s} published/s, from v${a.tip} to v${b.tip} in ${secs.toFixed(1)}s`);
  console.log(`publication lag while running: median ${result.lag_p50_s}s, longest ${result.lag_max_s}s`);
}
result.drain_s = behind ? -1 : Number(drained.toFixed(1));
if (landed !== info.tip.version - 1) console.log(`the room heard of ${landed} of the trunk's ${info.tip.version - 1} landings`);
await cleanup([trunk]);

if (commits > info.head.version) console.log(`${commits - info.head.version} more landed while cloning`);
const ok = commits >= info.head.version && commits <= after.head.version && !merges;
console.log(ok ? "ok" : "FAILED: the clone does not match the trunk");
console.log(`RESULT ${JSON.stringify({ ...result, versions: info.tip.version, ok })}`);
if (!ok) process.exitCode = 1;
