// Three people share one trunk and nobody coordinates. Each signs in, sends an
// agent after an issue (it holds the issue, so the swarms leave it alone), and
// launches their own swarm of scripted agents. Two of the agents change the
// same function for different issues: whichever lands second hears about it
// in the channel, re-plans, and lands. Then the swarms run together, claiming
// open issues and closing them, while the room tallies who landed what and
// whose agents re-planned around whose.
//
// With REPO=owner/name the trunk is imported from GitHub instead, with the
// repository's open issues and pull requests, and the swarms work through
// those issues (the hand-written agents only know the built-in shop template).
//
// Needs `npx wrangler dev` running with the development login on (DEV_LOGIN=1
// in .dev.vars). SWARM_URL defaults to http://localhost:8787. The trunk is
// kept so it can be opened in the dashboard; CLEANUP=1 deletes it.
//   SECONDS=90 node scripts/demo-team.ts
//   REPO=tj/commander.js SECONDS=90 node scripts/demo-team.ts

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { BASE, call, clone, session, signIn, sleep, type Plan, type Session } from "./client.ts";

const SECONDS = Number(process.env.SECONDS ?? 90);
const REPO = process.env.REPO ?? null;
// A few hundred agents keep a laptop's local server responsive; a deployed
// trunk takes many more.
const PEOPLE = [
  { name: "alice", agents: 200, shared: 0.15, after: 0 },
  { name: "bob", agents: 150, shared: 0.2, after: 6 },
  { name: "carol", agents: 100, shared: 0.1, after: 12 },
];

type Issue = { number: number; title: string; state: string; closedBy: string | null; landed: number };
type Person = { name: string; agents: number; landed: number; conflicts: number; rejected: number };
type Room = {
  totals: { landed: number; conflicts: number; rejected: number };
  people: Person[];
  clashes: [string, string, number][];
  issues: Issue[];
  swarms: { owner: { name: string }; running: boolean }[];
};

const cookies: Record<string, string> = {};
for (const p of PEOPLE) cookies[p.name] = await signIn(p.name);
const as = (name: string) => ({
  post: <T>(path: string, body?: unknown) => call<T>("POST", `/api/trunks/${trunk}${path}`, body ?? {}, cookies[name]),
  say: (body: string) => call("POST", `/api/trunks/${trunk}/channel`, { body }, cookies[name]),
});
const since = (t0: number) => `t+${Math.round((Date.now() - t0) / 1000)}s`;

const trunk = `team-${Date.now().toString(36)}`;
if (REPO) {
  const got = await call<{ files: number; issues: number; pulls: number; notes: string[] }>("POST", `/api/trunks/${trunk}/import`, { repo: REPO }, cookies.alice);
  console.log(`alice imported ${REPO} as ${trunk}: ${got.files} files, ${got.issues} issues, ${got.pulls} open pull requests`);
  for (const note of got.notes) console.log(`   note: ${note}`);
} else {
  await call("POST", `/api/trunks/${trunk}`, { template: "shop" }, cookies.alice);
  console.log(`alice made ${trunk} from the shop template`);
}
console.log(`open ${BASE}/t/${trunk}`);

// Scripts have no socket open, so they say they are watching.
const beat = () => Promise.all(PEOPLE.map((p) => as(p.name).post("/presence")));
await beat();
const beating = setInterval(() => void beat().catch(() => {}), 30_000);

const issues = await call<Issue[]>("GET", `/api/trunks/${trunk}/issues`);
const numbered = (title: string) => {
  const found = issues.find((i) => i.title.startsWith(title));
  if (!found) throw new Error(`the shop template has no issue "${title}"`);
  return found.number;
};
const CURRENCY = REPO ? 0 : numbered("formatPrice should support other currencies");
const ONE_ITEM = REPO ? 0 : numbered("summary() says");
const SLUGS = REPO ? 0 : numbered("slugify drops non-ASCII");

/** bob's agent: formatPrice takes a currency. */
async function currencies(s: Session): Promise<Plan> {
  await s.symbol("src/format.js", "formatPrice");
  const text = [
    "/** Format a price in cents, in dollars unless another currency is given. */",
    'export function formatPrice(cents, currency = "USD") {',
    '  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);',
    "}",
  ].join("\n");
  return { intent: `#${CURRENCY} Format prices in any currency`, edits: [{ op: "replace", path: "src/format.js", symbol: "formatPrice", text }] };
}

/** alice's agent: summary() says "1 item". It calls formatPrice, so it reads it. */
async function oneItem(s: Session): Promise<Plan> {
  await s.symbol("src/format.js", "formatPrice");
  await s.symbol("src/format.js", "formatQty");
  const { text } = await s.symbol("src/cart.js", "summary");
  await s.symbol("src/cart.js", "import:./format.js");
  return {
    intent: `#${ONE_ITEM} Say "1 item", not "1 items"`,
    edits: [
      { op: "replace", path: "src/cart.js", symbol: "import:./format.js", text: 'import { formatPrice, formatQty } from "./format.js";' },
      { op: "replace", path: "src/cart.js", symbol: "summary", text: text.replace("${items.length} items", '${formatQty(items.length, "item")}') },
    ],
  };
}

/** carol's agent: slugify keeps accented letters, as their base letter. */
async function slugs(s: Session): Promise<Plan> {
  const { text } = await s.symbol("src/shared/strings.js", "slugify");
  const fixed = text.replace("s.toLowerCase()", 's.normalize("NFKD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase()');
  return { intent: `#${SLUGS} Keep accented letters in slugs`, edits: [{ op: "replace", path: "src/shared/strings.js", symbol: "slugify", text: fixed }] };
}

/** Submits a plan for an issue. On a conflict, reads what the channel told
 *  the agent, starts a new life on the current trunk, and plans again. */
async function land(name: string, owner: string, planner: (s: Session) => Promise<Plan>, issue: number, s: Session, plan: Plan): Promise<number> {
  for (let attempt = 1; attempt <= 12; attempt++) {
    const r = await s.submit({ ...plan, issue, closes: true });
    if (r.status === "landed") {
      console.log(`   ${name} (for ${owner}): landed as v${r.version}, closing #${issue}`);
      return r.version!;
    }
    if (r.status === "rejected") throw new Error(`${name}: ${r.error}`);
    // The room posts the @mention a moment after the sequencer answers.
    await sleep(600);
    const told = (await call<{ from: string; body: string }[]>("GET", `/api/trunks/${trunk}/channel?for=${name}`)).at(-1);
    console.log(`   ${name} (for ${owner}): conflict. ${told ? `${told.from} in the channel: ${told.body}` : "No message yet."}`);
    s = session(trunk, name, cookies[owner]);
    await s.start();
    plan = await planner(s);
  }
  throw new Error(`${name} did not land in 12 attempts`);
}

if (!REPO) {
  console.log("\n== Two people's agents, two issues, one function");
  const aliceAgent = session(trunk, "alice-agent", cookies.alice);
  const bobAgent = session(trunk, "bob-agent", cookies.bob);
  await aliceAgent.hold(ONE_ITEM);
  await bobAgent.hold(CURRENCY);
  await aliceAgent.start();
  await bobAgent.start();
  await as("alice").say(`Sending my agent after #${ONE_ITEM}.`);
  await as("bob").say(`Mine is taking #${CURRENCY}, which changes formatPrice.`);
  const alicePlan = await oneItem(aliceAgent);
  const bobPlan = await currencies(bobAgent);
  console.log("   alice-agent and bob-agent hold their issues and both planned on v1");
  await land("bob-agent", "bob", currencies, CURRENCY, bobAgent, bobPlan);
  await land("alice-agent", "alice", oneItem, ONE_ITEM, aliceAgent, alicePlan);
  // carol's agent takes its issue now, so the swarms leave it alone until it gets to it.
  await session(trunk, "carol-agent", cookies.carol).hold(SLUGS);
}

console.log(`\n== Three swarms at once, ${SECONDS}s each`);
const t0 = Date.now();
const launches = PEOPLE.map(async (p) => {
  await sleep(p.after * 1000);
  await as(p.name).post("/swarm", { agents: p.agents, seconds: SECONDS, shared: p.shared, skew: 1.1, think: [1000, 3000] });
  console.log(`   ${since(t0)}  ${p.name} launched ${p.agents} scripted agents`);
});

// While the swarms run, carol opens an issue and sends her own agent into the crowd.
const carol = (async () => {
  await sleep(18_000);
  const opened = await as("carol").post<Issue>("/issues", { title: "Print a receipt with one line per item", body: "Like `summary()`, but one line per item and a total line." });
  console.log(`   ${since(t0)}  carol opened #${opened.number}; the swarms pick it up from the agenda`);
  if (REPO) return;
  await as("carol").say(`Opened #${opened.number}. My agent has #${SLUGS}.`);
  const s = session(trunk, "carol-agent", cookies.carol);
  await s.start();
  await land("carol-agent", "carol", slugs, SLUGS, s, await slugs(s));
})();

await Promise.all(launches);
for (;;) {
  await sleep(5000);
  const room = await call<Room>("GET", `/api/trunks/${trunk}/room`);
  const who = room.people.map((p) => `${p.name} ${p.landed}`).join(", ");
  const closed = room.issues.filter((i) => i.state === "closed" && i.closedBy).length;
  const open = room.issues.filter((i) => i.state !== "closed" || i.closedBy).length;
  console.log(`   ${since(t0)}  landed ${room.totals.landed} (${who})  re-planned ${room.totals.conflicts}  issues closed ${closed}/${open}`);
  if (!room.swarms.some((s) => s.running) && Date.now() - t0 > (SECONDS + 12) * 1000) break;
}
await carol;
clearInterval(beating);
// Let the last submissions and the room's last frame settle.
await sleep(3000);

const room = await call<Room>("GET", `/api/trunks/${trunk}/room`);
const info = await call<{ tip: { version: number } }>("GET", `/api/trunks/${trunk}/info`);
console.log("\n== Who did what");
for (const p of room.people) {
  console.log(`   ${p.name.padEnd(6)} ${String(p.agents).padStart(4)} agents  ${String(p.landed).padStart(5)} landed  ${String(p.conflicts).padStart(4)} re-planned  ${p.rejected} rejected`);
}
const total = room.clashes.reduce((n, c) => n + c[2], 0);
const across = room.clashes.reduce((n, [loser, winner, k]) => n + (loser === winner ? 0 : k), 0);
console.log(`   ${across} of ${total} conflicts were between different people's agents`);
for (const [loser, winner, n] of room.clashes.slice(0, 6)) console.log(`     ${loser} re-planned around ${loser === winner ? "their own agents" : winner}: ${n}`);
// Imported issues already closed upstream arrive closed; count only the trunk's own.
const open = room.issues.filter((i) => i.state !== "closed" || i.closedBy).length;
const closed = room.issues.filter((i) => i.state === "closed" && i.closedBy);
console.log(`   issues closed on the trunk: ${closed.length} of ${open}`);
for (const i of closed.slice(0, 5)) console.log(`     #${i.number} ${i.title} (closed by ${i.closedBy})`);

console.log("\n== The trunk, cloned with plain git");
const dir = clone(`${BASE}/git/${trunk}.git`);
const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: "pipe" }).trim();
const commits = Number(git("rev-list", "--count", "HEAD"));
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
const parses = (f: string) => {
  try {
    execFileSync("node", ["--check", f], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
};
// An imported repository can hold JavaScript that never parsed (fixtures,
// other dialects). Only a file that parsed in the seed commit, or a new one,
// has to parse now.
let broken = files.filter((f) => !parses(f));
if (broken.length) {
  const seedDir = mkdtempSync(join(tmpdir(), "swarm-seed-"));
  git("worktree", "add", "-q", "--detach", seedDir, git("rev-list", "--max-parents=0", "HEAD"));
  broken = broken.filter((f) => {
    const before = join(seedDir, relative(dir, f));
    try {
      statSync(before);
    } catch {
      return true;
    }
    return parses(before);
  });
}
const trailers = git("log", "--format=%(trailers:key=On-behalf-of,valueonly)").split("\n").filter(Boolean);
const behalf = new Map<string, number>();
for (const t of trailers) behalf.set(t, (behalf.get(t) ?? 0) + 1);
console.log(`   ${commits} commits, ${merges ? "with merges" : "linear"}, fsck clean, ${files.length} JS files, ${broken.length ? `${broken.length} newly broken` : "none newly broken"}`);
console.log(`   On-behalf-of trailers: ${[...behalf].map(([k, n]) => `${k} ${n}`).join(", ")}`);
let ran = true;
if (!REPO) {
  writeFileSync(
    join(dir, "check.mjs"),
    'import { summary } from "./src/cart.js";\nimport { slugify } from "./src/shared/strings.js";\nconsole.log(summary([{ cents: 500, qty: 1 }]) + " | " + slugify("Crème brûlée"));\n',
  );
  const out = execFileSync("node", ["check.mjs"], { cwd: dir, encoding: "utf8" }).trim();
  console.log(`   the trunk runs: ${out}`);
  ran = out === "1 item, $5.00 | creme-brulee";
}

const ok = !merges && commits === info.tip.version && commits === room.totals.landed + 1 && !broken.length && ran;
if (process.env.CLEANUP) await call("DELETE", `/api/trunks/${trunk}`);
else console.log(`\nkept: ${BASE}/t/${trunk}`);
console.log(ok ? "ok" : "FAILED: see above");
if (!ok) process.exitCode = 1;
