// Many agents submit at once. Appends of different functions to one file
// should all land without a rebase; edits to one shared function should land
// exactly once. Then the trunk is cloned and checked: linear history, valid
// objects, and a file that still parses with every appended function in it.
//
// Needs `npx wrangler dev` running (add `--env artifacts` to also check the
// Artifacts mirror). SWARM_URL defaults to http://localhost:8787. KEEP=1
// keeps the trunk.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BASE, call, checkMirror, cleanup, clone } from "./client.ts";

const APPENDERS = Number(process.env.APPENDERS ?? 60);
const RIVALS = Number(process.env.RIVALS ?? 12);

const trunk = `smoke-${Date.now().toString(36)}`;
await call("POST", `/api/trunks/${trunk}`, {
  files: [
    { path: "src/util.js", text: "export function base() {\n  return 0;\n}\n" },
    { path: "src/shared.js", text: "export function hot() {\n  return 0;\n}\n" },
  ],
});

/** Starts a life for `agent` and returns the agent's API path. */
async function start(agent: string): Promise<string> {
  const base = `/api/trunks/${trunk}/agents/${agent}`;
  await call("POST", `${base}/lives`, { kind: "agent" });
  return base;
}

// Every life starts at v1 before anything is submitted.
const appenders = await Promise.all(Array.from({ length: APPENDERS }, (_, i) => start(`appender-${i}`)));
const rivals = await Promise.all(
  Array.from({ length: RIVALS }, async (_, i) => {
    const base = await start(`rival-${i}`);
    await call("GET", `${base}/symbol?path=src/shared.js&name=hot`);
    return base;
  }),
);

const t0 = performance.now();
const results = await Promise.all([
  ...appenders.map((base, i) =>
    call<{ status: string }>("POST", `${base}/submit`, {
      intent: `Add f${i}`,
      edits: [{ op: "insert", path: "src/util.js", text: `export function f${i}() {\n  return ${i};\n}` }],
    }),
  ),
  ...rivals.map((base, i) =>
    call<{ status: string }>("POST", `${base}/submit`, {
      intent: `Make hot return ${i + 1}`,
      edits: [{ op: "replace", path: "src/shared.js", symbol: "hot", text: `export function hot() {\n  return ${i + 1};\n}` }],
    }),
  ),
]);
const ms = performance.now() - t0;

const appended = results.slice(0, APPENDERS).filter((r) => r.status === "landed").length;
const rivalsLanded = results.slice(APPENDERS).filter((r) => r.status === "landed").length;
const rivalsConflicted = results.slice(APPENDERS).filter((r) => r.status === "conflict").length;
console.log(`${results.length} concurrent submissions in ${ms.toFixed(0)} ms (local dev server)`);
console.log(`  appends to one file: ${appended}/${APPENDERS} landed`);
console.log(`  edits to one function: ${rivalsLanded} landed, ${rivalsConflicted} conflicted`);

const dir = clone(`${BASE}/git/${trunk}.git`);
const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: "pipe" }).trim();
const commits = Number(git("rev-list", "--count", "HEAD"));
const merges = git("rev-list", "--merges", "HEAD");
git("fsck", "--full", "--strict");
const util = readFileSync(join(dir, "src/util.js"), "utf8");
const fns = (util.match(/^export function f\d+\(/gm) ?? []).length;
execFileSync("node", ["--check", join(dir, "src/util.js")]);
console.log(`  clone: ${commits} commits, ${merges ? "has merges" : "linear"}, git fsck clean, util.js parses with ${fns} appended functions`);
const mirror = await checkMirror(trunk);
await cleanup([trunk]);

const ok =
  appended === APPENDERS &&
  rivalsLanded === 1 &&
  rivalsConflicted === RIVALS - 1 &&
  commits === 1 + APPENDERS + 1 &&
  !merges &&
  fns === APPENDERS &&
  mirror !== false;
console.log(ok ? "ok" : "FAILED");
if (!ok) process.exitCode = 1;
