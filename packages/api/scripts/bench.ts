// Three ways for N agents to land changes on one trunk, all on this machine
// and all with the same edit model: most edits go to the agent's own file,
// some to a shared function picked with a Zipf skew.
//
//   direct  plain git: commit, push to main; when the push is rejected, fetch,
//           rebase, and push again (a rebase conflict means redoing the edit)
//   queue   a merge queue: agents push their own branch, and one merger merges
//           requests into main in order (a merge conflict sends the edit back)
//   swarm   this project: the sequencer lands a change unless its footprint
//           overlaps a newer one, and the agent re-plans
//
// Needs `npx wrangler dev` running for the swarm runs. Writes the results to
// apps/web/public/bench.json, where the dashboard picks them up.
//   AGENTS=4,16,64 SECONDS=30 node scripts/bench.ts

import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { TEMPLATES } from "../src/templates.ts";
import { call, sleep } from "./client.ts";

const AGENTS = (process.env.AGENTS ?? "4,16,64").split(",").map(Number);
const SECONDS = Number(process.env.SECONDS ?? 30);
const MODES = (process.env.MODES ?? "direct,queue,swarm").split(",") as Mode[];
const SHARED = 0.15;
const SKEW = 1.1;
const THINK: [number, number] = [100, 300];

type Mode = "direct" | "queue" | "swarm";
interface Result {
  mode: Mode;
  agents: number;
  seconds: number;
  landed: number;
  /** Attempts thrown away: rejected pushes and redone edits for git, re-plans for the swarm. */
  wasted: number;
  conflicts: number;
  perSecond: number;
  /** Harness failures (a git step that broke for reasons other than contention). */
  errors: number;
}

const run = promisify(execFile);
const git = (dir: string, ...args: string[]) => run("git", ["-C", dir, ...args], { maxBuffer: 1 << 24 });
const tryGit = (dir: string, ...args: string[]) => git(dir, ...args).then(() => true, () => false);
/** A read that can race a concurrent push; tried a few times before giving up. */
async function fetchMain(dir: string) {
  for (let i = 1; ; i++) {
    try {
      return await git(dir, "fetch", "-q", "origin");
    } catch (e) {
      if (i >= 5) throw e;
      await sleep(20 * i);
    }
  }
}
const think = () => sleep(THINK[0] + Math.random() * (THINK[1] - THINK[0]));
const bot = (i: number) => `bot-${String(i).padStart(5, "0")}`;

// The shared functions, in the order the sequencer offers them (by path).
const SEED = TEMPLATES.shop;
const TARGETS = Object.keys(SEED)
  .sort()
  .flatMap((path) => [...SEED[path].matchAll(/^export function (\w+)\(/gm)].map((m) => ({ path, name: m[1] })));
let sum = 0;
const WEIGHTS = TARGETS.map((_, i) => (sum += 1 / Math.pow(i + 1, SKEW)));
const pickTarget = () => {
  const r = Math.random() * WEIGHTS[WEIGHTS.length - 1];
  return TARGETS[WEIGHTS.findIndex((w) => w >= r)];
};

/** One edit, applied to a working tree: touch a shared function, or work on the agent's own file. */
function edit(dir: string, name: string, life: number): string {
  if (Math.random() < SHARED) {
    const t = pickTarget();
    const file = join(dir, t.path);
    const lines = readFileSync(file, "utf8").split("\n");
    let top = lines.findIndex((l) => l.startsWith(`export function ${t.name}(`));
    if (lines[top - 1]?.startsWith("/**")) top--;
    if (lines[top - 1]?.startsWith("// touched by")) lines.splice(top - 1, 1, `// touched by ${name}, life ${life}`);
    else lines.splice(top, 0, `// touched by ${name}, life ${life}`);
    writeFileSync(file, lines.join("\n"));
    return `Touch ${t.name}`;
  }
  const file = join(dir, "src/swarm", `g${name.slice(4, 7)}`, `${name}.js`);
  mkdirSync(dirname(file), { recursive: true });
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {}
  const n = (text.match(/^export function task/gm) ?? []).length;
  if (!n || Math.random() >= 0.6) text += `${n ? "\n" : ""}export function task${n + 1}() {\n  return ${(n + 1) * 1000 + life};\n}\n`;
  else {
    const k = 1 + Math.floor(Math.random() * n);
    text = text.replace(new RegExp(`(export function task${k}\\(\\) \\{\\n  return )\\d+`), `$1${k * 1000 + life}`);
  }
  writeFileSync(file, text);
  return `Work on ${name}`;
}

async function commit(dir: string, message: string) {
  await git(dir, "add", "-A");
  await git(dir, "commit", "-qm", message);
}

/** A bare repository seeded with the template, plus one clone per agent. */
async function setup(agents: number) {
  const root = mkdtempSync(join(tmpdir(), "bench-"));
  const seed = join(root, "seed");
  mkdirSync(seed);
  await git(seed, "init", "-q", "-b", "main");
  for (const [path, text] of Object.entries(SEED)) {
    mkdirSync(dirname(join(seed, path)), { recursive: true });
    writeFileSync(join(seed, path), text);
  }
  await git(seed, "-c", "user.name=seed", "-c", "user.email=seed@agents.invalid", "add", "-A");
  await git(seed, "-c", "user.name=seed", "-c", "user.email=seed@agents.invalid", "commit", "-qm", "Seed");
  const origin = join(root, "origin.git");
  await run("git", ["clone", "-q", "--bare", seed, origin]);
  // Automatic gc under a burst of pushes repacks objects that concurrent
  // fetches are reading; a real forge runs gc out of band.
  await git(origin, "config", "gc.auto", "0");
  await git(origin, "config", "receive.autogc", "false");
  const clone = async (name: string) => {
    const dir = join(root, name);
    await run("git", ["clone", "-q", origin, dir]);
    await git(dir, "config", "user.name", name);
    await git(dir, "config", "user.email", `${name}@agents.invalid`);
    return dir;
  };
  const dirs = await Promise.all(Array.from({ length: agents }, (_, i) => clone(bot(i))));
  return { origin, dirs, clone };
}

/** Puts a clone back on main after a git step failed partway. */
async function recover(dir: string) {
  await tryGit(dir, "rebase", "--abort");
  await tryGit(dir, "merge", "--abort");
  await tryGit(dir, "reset", "-q", "--hard", "origin/main");
}

async function direct(agents: number): Promise<Result> {
  const { dirs } = await setup(agents);
  const r: Result = { mode: "direct", agents, seconds: SECONDS, landed: 0, wasted: 0, conflicts: 0, perSecond: 0, errors: 0 };
  const end = Date.now() + SECONDS * 1000;
  await Promise.all(
    dirs.map(async (dir, i) => {
      for (let life = 1; Date.now() < end; life++) {
        try {
          await think();
          await fetchMain(dir);
          await git(dir, "reset", "-q", "--hard", "origin/main");
          await commit(dir, edit(dir, bot(i), life));
          while (Date.now() < end) {
            if (await tryGit(dir, "push", "-q", "origin", "HEAD:main")) {
              r.landed++;
              break;
            }
            r.wasted++;
            await fetchMain(dir);
            if (!(await tryGit(dir, "rebase", "-q", "origin/main"))) {
              // A textual conflict: the edit is redone on the new main.
              await tryGit(dir, "rebase", "--abort");
              r.conflicts++;
              await git(dir, "reset", "-q", "--hard", "origin/main");
              await commit(dir, edit(dir, bot(i), life));
            }
          }
        } catch {
          r.errors++;
          await recover(dir);
        }
      }
    }),
  );
  r.perSecond = r.landed / SECONDS;
  return r;
}

async function queue(agents: number): Promise<Result> {
  const { dirs, clone } = await setup(agents);
  const merger = await clone("merger");
  const r: Result = { mode: "queue", agents, seconds: SECONDS, landed: 0, wasted: 0, conflicts: 0, perSecond: 0, errors: 0 };
  const end = Date.now() + SECONDS * 1000;
  const waiting: { ref: string; done: (landed: boolean) => void }[] = [];
  let open = agents;

  // The merger is main's only writer, so its pushes never race.
  const merging = (async () => {
    while (open > 0 || waiting.length) {
      const req = waiting.shift();
      if (!req) {
        await sleep(5);
        continue;
      }
      try {
        await git(merger, "fetch", "-q", "--force", "origin", `${req.ref}:refs/queue/head`);
        if (await tryGit(merger, "merge", "-q", "--no-edit", "refs/queue/head")) {
          await git(merger, "push", "-q", "origin", "HEAD:main");
          req.done(true);
        } else {
          await tryGit(merger, "merge", "--abort");
          req.done(false);
        }
      } catch {
        r.errors++;
        await tryGit(merger, "merge", "--abort");
        req.done(false);
      }
    }
  })();

  await Promise.all(
    dirs.map(async (dir, i) => {
      const ref = `refs/heads/agent/${bot(i)}`;
      for (let life = 1; Date.now() < end; life++) {
        await think();
        for (;;) {
          try {
            await fetchMain(dir);
            await git(dir, "reset", "-q", "--hard", "origin/main");
            await commit(dir, edit(dir, bot(i), life));
            await git(dir, "push", "-q", "--force", "origin", `HEAD:${ref}`);
          } catch {
            r.errors++;
            await recover(dir);
            if (Date.now() >= end) break;
            continue;
          }
          const landed = await new Promise<boolean>((done) => waiting.push({ ref, done }));
          if (landed) {
            if (Date.now() <= end) r.landed++;
            break;
          }
          r.wasted++;
          r.conflicts++;
          if (Date.now() >= end) break;
        }
      }
      open--;
    }),
  );
  await merging;
  r.perSecond = r.landed / SECONDS;
  return r;
}

async function swarm(agents: number): Promise<Result> {
  const trunk = `bench-${agents}-${Date.now().toString(36)}`;
  await call("POST", `/api/trunks/${trunk}`, { template: "shop" });
  await call("POST", `/api/trunks/${trunk}/swarm`, { agents, seconds: SECONDS, shared: SHARED, skew: SKEW, think: THINK });
  await sleep(SECONDS * 1000 + 3000);
  const room = await call<{ totals: { landed: number; conflicts: number; rejected: number } }>("GET", `/api/trunks/${trunk}/room`);
  await call("DELETE", `/api/trunks/${trunk}`);
  const { landed, conflicts, rejected } = room.totals;
  return { mode: "swarm", agents, seconds: SECONDS, landed, wasted: conflicts + rejected, conflicts, perSecond: landed / SECONDS, errors: 0 };
}

const results: Result[] = [];
for (const agents of AGENTS) {
  for (const mode of MODES) {
    const r = await (mode === "direct" ? direct : mode === "queue" ? queue : swarm)(agents);
    results.push(r);
    console.log(
      `${mode.padEnd(6)} ${String(agents).padStart(4)} agents: ${r.perSecond.toFixed(1).padStart(6)} landed/s, ` +
        `${r.landed} landed, ${r.wasted} wasted (${(r.wasted / Math.max(1, r.landed)).toFixed(2)} per landed), ${r.conflicts} conflicts${r.errors ? `, ${r.errors} harness errors` : ""}`,
    );
  }
}
const out = join(dirname(new URL(import.meta.url).pathname), "../../../apps/web/public/bench.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), seconds: SECONDS, shared: SHARED, skew: SKEW, think: THINK, results }, null, 2));
console.log(`\nwrote ${out}`);
