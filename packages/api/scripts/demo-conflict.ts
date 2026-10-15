// Three agents plan against the same trunk. One renames formatPrice, one adds
// a module that calls it, one rewords a doc comment in a file the rename
// touches. With plain git branches the rename and the new caller merge
// without a conflict into a program that crashes. On the swarm trunk,
// whichever of the two lands second is rejected, re-plans on the new trunk,
// and the result runs, in either landing order.
//
// Needs `npx wrangler dev` running (add `--env artifacts` to also check the
// Artifacts mirror). SWARM_URL defaults to http://localhost:8787. KEEP=1
// keeps the trunks it makes.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BASE, call, checkMirror, cleanup, clone, session, type Edit, type Plan, type Session } from "./client.ts";

const SEED: Record<string, string> = {
  "package.json": '{ "name": "shop", "type": "module" }\n',
  "src/format.js": [
    "/** Format a price in cents as dollars. */",
    "export function formatPrice(cents) {",
    "  return `$${(cents / 100).toFixed(2)}`;",
    "}",
    "",
    "/** Format a quantity with its unit, pluralised. */",
    "export function formatQty(n, unit) {",
    '  return `${n} ${unit}${n === 1 ? "" : "s"}`;',
    "}",
    "",
  ].join("\n"),
  "src/cart.js": [
    'import { formatPrice } from "./format.js";',
    "",
    "/** Total of a cart in cents. */",
    "export function total(items) {",
    "  return items.reduce((sum, it) => sum + it.cents * it.qty, 0);",
    "}",
    "",
    "/** One-line summary of a cart. */",
    "export function summary(items) {",
    "  return `${items.length} items, ${formatPrice(total(items))}`;",
    "}",
    "",
  ].join("\n"),
};

const receiptModule = (fmt: string) =>
  [
    `import { ${fmt} } from "./format.js";`,
    'import { total } from "./cart.js";',
    "",
    "/** Receipt lines for a cart: one per item, then the total. */",
    "export function receipt(items) {",
    `  return [...items.map((it) => ${fmt}(it.cents * it.qty)), "total " + ${fmt}(total(items))];`,
    "}",
    "",
  ].join("\n");

// Runs the result: both modules, end to end.
const CHECK = [
  'import { receipt } from "./src/report.js";',
  'import { summary } from "./src/cart.js";',
  "const items = [{ cents: 1999, qty: 2 }, { cents: 500, qty: 1 }];",
  'console.log(receipt(items).join("; ") + " | " + summary(items));',
  "",
].join("\n");

/** Renames formatPrice to formatMoney everywhere it is used. */
async function renamer(s: Session): Promise<Plan> {
  const rename = (t: string) => t.replace(/\bformatPrice\b/g, "formatMoney");
  const def = await s.symbol("src/format.js", "formatPrice");
  const edits: Edit[] = [{ op: "replace", path: "src/format.js", symbol: "formatPrice", text: rename(def.text) }];
  for (const hit of (await s.refs("formatPrice")).hits) {
    const sym = await s.symbol(hit.path, hit.symbol);
    edits.push({ op: "replace", path: hit.path, symbol: hit.symbol, text: rename(sym.text) });
  }
  return { intent: "Rename formatPrice to formatMoney", edits };
}

/** Adds receipt lines, using the price formatter under whatever name it has. */
async function receipts(s: Session): Promise<Plan> {
  const format = await s.file("src/format.js");
  const fmt = format.text.match(/Format a price[^]*?export function (\w+)/)?.[1];
  if (!fmt) throw new Error("receipts: no price formatter in src/format.js");
  await s.symbol("src/format.js", fmt);
  await s.symbol("src/cart.js", "total");
  return { intent: "Add receipt lines for a cart", edits: [{ op: "create", path: "src/report.js", text: receiptModule(fmt) }] };
}

/** Skims all of cart.js, then rewords the doc comment on total. */
async function documenter(s: Session): Promise<Plan> {
  await s.file("src/cart.js");
  const { text } = await s.symbol("src/cart.js", "total");
  const reworded = text.replace("/** Total of a cart in cents. */", "/** Total of a cart in cents: unit price times quantity, summed. */");
  return { intent: "Explain how total counts quantities", edits: [{ op: "replace", path: "src/cart.js", symbol: "total", text: reworded }] };
}

const PLANNERS = { renamer, receipts, documenter };
type Agent = keyof typeof PLANNERS;

/** Submits a plan. On a conflict, re-plans on a fresh session until it lands. */
async function land(trunk: string, agent: Agent, s: Session, plan: Plan) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await s.submit(plan);
    if (r.status === "landed") {
      const recheck = r.revalidate?.length ? `; re-verify, it skimmed ${r.revalidate.map((o) => o.key).join(", ")}` : "";
      console.log(`   ${agent}: landed as v${r.version}${recheck}`);
      return;
    }
    if (r.status === "rejected") throw new Error(`${agent}: ${r.error}`);
    const on = r.conflicts!.map((c) => `${c.key} (${c.kind}, changed in v${c.version})`).join(", ");
    console.log(`   ${agent}: conflict on ${on}; re-planning on the new trunk`);
    s = session(trunk, agent);
    await s.start();
    plan = await PLANNERS[agent](s);
  }
  throw new Error(`${agent} did not land in 3 attempts`);
}

async function scenario(order: Agent[]): Promise<string> {
  const trunk = `demo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  await call("POST", `/api/trunks/${trunk}`, { files: Object.entries(SEED).map(([path, text]) => ({ path, text })) });
  console.log(`\n== Swarm trunk, landing ${order.join(", then ")}`);
  const sessions = Object.fromEntries(Object.keys(PLANNERS).map((a) => [a, session(trunk, a)])) as Record<Agent, Session>;
  const plans = {} as Record<Agent, Plan>;
  for (const agent of order) {
    await sessions[agent].start();
    plans[agent] = await PLANNERS[agent](sessions[agent]);
  }
  console.log("   all three planned against v1");
  for (const agent of order) await land(trunk, agent, sessions[agent], plans[agent]);
  return trunk;
}

function runs(dir: string, label: string): boolean {
  writeFileSync(join(dir, "check.mjs"), CHECK);
  try {
    const out = execFileSync("node", ["check.mjs"], { cwd: dir, encoding: "utf8", stdio: "pipe" }).trim();
    console.log(`   ${label} runs: ${out}`);
    return true;
  } catch (e) {
    const stderr = String((e as { stderr?: string }).stderr ?? e);
    console.log(`   ${label} crashes: ${stderr.split("\n").find((l) => /Error/.test(l))?.trim() ?? "failed"}`);
    return false;
  }
}

/** Clones the trunk with plain git, runs it, and checks the Artifacts mirror. */
async function verify(trunk: string): Promise<boolean> {
  const dir = clone(`${BASE}/git/${trunk}.git`);
  console.log(`   git clone ${BASE}/git/${trunk}.git`);
  const log = execFileSync("git", ["-C", dir, "log", "--format=%h %an: %s"], { encoding: "utf8" }).trim();
  for (const line of log.split("\n")) console.log(`     ${line}`);
  const ran = runs(dir, "the trunk");
  return ran && (await checkMirror(trunk)) !== false;
}

/** The same two changes as git branches off the seed, merged. */
function plainGit(trunk: string): boolean {
  console.log("\n== Plain git: the rename and the receipt module as branches, merged");
  const dir = clone(`${BASE}/git/${trunk}.git`);
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: "pipe" });
  git("config", "user.name", "baseline");
  git("config", "user.email", "baseline@agents.invalid");
  const seed = git("rev-list", "--max-parents=0", "HEAD").trim();
  git("checkout", "-q", "-b", "rename", seed);
  for (const f of ["src/format.js", "src/cart.js"]) {
    writeFileSync(join(dir, f), readFileSync(join(dir, f), "utf8").replace(/\bformatPrice\b/g, "formatMoney"));
  }
  git("commit", "-qam", "Rename formatPrice to formatMoney");
  git("checkout", "-q", "-b", "receipts", seed);
  writeFileSync(join(dir, "src/report.js"), receiptModule("formatPrice"));
  git("add", "src/report.js");
  git("commit", "-qm", "Add receipt lines for a cart");
  git("checkout", "-q", "-b", "merged", seed);
  git("merge", "-q", "--no-edit", "rename");
  git("merge", "-q", "--no-edit", "receipts");
  console.log("   git merge rename receipts: merged with no conflicts");
  return runs(dir, "the merge");
}

const first = await scenario(["receipts", "renamer", "documenter"]);
const ok1 = await verify(first);
const second = await scenario(["renamer", "receipts", "documenter"]);
const ok2 = await verify(second);
const plain = plainGit(first);
await cleanup([first, second]);

console.log(`\nswarm trunk: ${ok1 && ok2 ? "runs in both landing orders" : "BROKEN"}. plain git: ${plain ? "runs" : "merged cleanly, crashes"}.`);
if (!ok1 || !ok2 || plain) process.exitCode = 1;
