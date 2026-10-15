// Agents pushing with plain git, end to end: a fast-forward push, a push from
// behind that still lands, two agents on different functions of one file, a
// rename and a push that adds a call to the old name, which is refused, and a
// push with no token. Uses a push token, as a person makes on a trunk's page.
//   node scripts/smoke-push.ts            (KEEP=1 keeps the trunk)

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BASE, call, cleanup, signIn } from "./client.ts";

const trunk = `push-${Date.now().toString(36)}`;
const root = mkdtempSync(join(tmpdir(), "push-"));
// No prompts, and no credential helper: a token must never be cached on this
// machine, and a push meant to have no token must not borrow a cached one.
const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
const NO_CACHE = ["-c", "credential.helper="];
const git = (dir: string, ...args: string[]) => execFileSync("git", [...NO_CACHE, "-C", dir, ...args], { env, encoding: "utf8", stdio: "pipe" });
/** A push's whole output, stdout and stderr ("remote:" lines go to stderr). */
function push(dir: string, url: string): string {
  const r = spawnSync("git", [...NO_CACHE, "-C", dir, "push", url, "HEAD:refs/heads/main"], { env, encoding: "utf8" });
  return `${r.stdout}${r.stderr}`;
}
const edit = (dir: string, path: string, change: (text: string) => string) => writeFileSync(join(dir, path), change(readFileSync(join(dir, path), "utf8")));
let failed = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed++;
};

await call("POST", `/api/trunks/${trunk}`, { template: "shop" });
const cookie = await signIn("pusher");
const { token, id: tokenId } = await call<{ token: string; id: string }>("POST", "/api/tokens", { label: "smoke", trunk }, cookie);
const remote = (agent: string) => BASE.replace("://", `://${agent}:${token}@`) + `/git/${trunk}.git`;
const clone = (agent: string) => {
  const dir = join(root, agent);
  execFileSync("git", [...NO_CACHE, "clone", "-q", `${BASE}/git/${trunk}.git`, dir], { env, stdio: "pipe" });
  git(dir, "config", "user.name", agent);
  git(dir, "config", "user.email", `${agent}@agents.invalid`);
  return dir;
};

try {
  const [a, b, d] = [clone("agent-a"), clone("agent-b"), clone("agent-d")];

  edit(a, "src/format.js", (t) => t.replace("toFixed(2)}`;", "toFixed(2)} USD`;"));
  git(a, "commit", "-qam", "Show the currency in formatPrice");
  let out = push(a, remote("agent-a"));
  check(/landed as v2 .* by agent-a, for pusher/.test(out) && !/rebuilt/.test(out), "a fast-forward push lands and keeps the agent's commit");

  edit(b, "src/format.js", (t) => t.replace('${n} ${unit}', '${n} × ${unit}'));
  git(b, "commit", "-qam", "Use a times sign in formatQty");
  out = push(b, remote("agent-b"));
  check(/landed as v3/.test(out) && /rebuilt on top/.test(out), "a push from behind, to another function of the same file, lands");

  const c = clone("agent-c");
  for (const path of ["src/format.js", "src/cart.js"]) edit(c, path, (t) => t.replaceAll("formatPrice", "formatMoney"));
  git(c, "commit", "-qam", "Rename formatPrice to formatMoney");
  check(/landed as v4/.test(push(c, remote("agent-c"))), "a rename lands");

  writeFileSync(join(d, "src/receipt.js"), 'import { formatPrice } from "./format.js";\n\nexport function receiptLine(item) {\n  return `${item.name}: ${formatPrice(item.cents)}`;\n}\n');
  git(d, "add", "src/receipt.js");
  git(d, "commit", "-qm", "Add receipt lines");
  out = push(d, remote("agent-d"));
  check(/conflict: the uses of formatPrice were changed by agent-c in v4/.test(out), "a new call to the old name is refused, naming the rename");

  out = push(d, `${BASE}/git/${trunk}.git`);
  check(/could not read Username|Authentication failed/.test(out), "a push with no token is refused");

  const check2 = mkdtempSync(join(tmpdir(), "push-check-"));
  execFileSync("git", [...NO_CACHE, "clone", "-q", `${BASE}/git/${trunk}.git`, check2], { env, stdio: "pipe" });
  const log = git(check2, "log", "--format=%an %s").trim().split("\n");
  git(check2, "fsck", "--strict");
  check(log.length === 4 && log[0].startsWith("agent-c"), `main has 4 commits, linear, fsck clean (${log.map((l) => l.split(" ")[0]).join(", ")})`);
} finally {
  await call("DELETE", `/api/tokens/${tokenId}`, undefined, cookie);
  await cleanup([trunk]);
}
console.log(failed ? `${failed} failed` : "ok");
process.exit(failed ? 1 : 0);
