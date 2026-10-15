// The trunk read as a git host reads it, end to end: three changes land
// through the API, then the tree, files, history, one version's diff, a
// compare, and the patch that sends the work back to GitHub, which `git am`
// applies to a copy of the trunk's first version that shares no history with
// it, giving exactly the trunk's newest tree. Then the agents' brief.
//   node scripts/smoke-browse.ts            (KEEP=1 keeps the trunk)

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BASE, call, cleanup, session } from "./client.ts";

const trunk = `browse-${Date.now().toString(36)}`;
const api = `/api/trunks/${trunk}`;
let failed = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed++;
};
const text = async (path: string) => {
  const res = await fetch(BASE + path);
  return { status: res.status, body: await res.text() };
};
const git = (dir: string, ...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: "pipe" });

type Tree = { version: number; entries: { name: string; type: string }[]; readme: { path: string } | null; latest: { subject: string; agent: string } };
type Commits = { head: number; commits: { version: number; subject: string; agent: string }[]; next: number | null };
type Files = { files: { path: string; status: string; additions: number; deletions: number; patch: string | null }[]; truncated: string[] };

await call("POST", api, { template: "shop" });
try {
  const a = session(trunk, "agent-a");
  await a.start();
  await a.submit({
    intent: "Show the currency in formatPrice",
    edits: [{ op: "replace", path: "src/format.js", symbol: "formatPrice", text: "/** Format a price in cents as dollars. */\nexport function formatPrice(cents) {\n  return `$${(cents / 100).toFixed(2)} USD`;\n}" }],
    wait: "published",
  });
  // Prime content before another landing to verify fresh heads on cache hits.
  await call("GET", `${api}/tree`);
  await call("GET", `${api}/commits?from=2&limit=2`);
  await a.start();
  await a.submit({ intent: "Write down how releases work", edits: [{ op: "create", path: "docs/releases.md", text: "# Releases\n\nTag main, then publish.\n" }], wait: "published" });
  await a.start();
  const last = await a.submit({ intent: "Add a note with no final newline", edits: [{ op: "create", path: "notes.txt", text: "one line, no newline" }], wait: "published" });
  check(last.status === "landed" && last.version === 4, "three changes land, the last as v4");

  const oldPage = await call<Commits>("GET", `${api}/commits?from=2&limit=2`);
  check(oldPage.head === 4 && oldPage.commits[0].version === 2, "cached older history reports the current head after new landings");
  const top = await call<Tree>("GET", `${api}/tree`);
  const names = top.entries.map((e) => (e.type === "dir" ? `${e.name}/` : e.name));
  check(top.version === 4 && names[0] === "docs/" && names.includes("src/") && names.includes("notes.txt"), `the top directory lists folders first: ${names.join(" ")}`);
  check(top.readme?.path === "README.md" && top.latest.subject === "Add a note with no final newline" && top.latest.agent === "agent-a", "it carries the README and the newest change");
  const src = await call<Tree>("GET", `${api}/tree?path=src&v=1`);
  check(src.version === 1 && src.entries.some((e) => e.name === "shared" && e.type === "dir"), "a directory reads at an older version");

  const before = await call<{ text: string }>("GET", `${api}/blob?path=src/format.js&v=1`);
  const after = await call<{ text: string; size: number }>("GET", `${api}/blob?path=src/format.js`);
  const raw = await text(`${api}/raw?path=src/format.js`);
  check(!before.text.includes("USD") && after.text.includes("USD") && raw.body === after.text, "a file reads at v1 and at the head, and raw gives the same bytes");

  const page = await call<Commits>("GET", `${api}/commits?limit=2`);
  check(page.head === 4 && page.commits.map((c) => c.version).join() === "4,3" && page.next === 2, "history pages newest first, with where the next page starts");

  const one = await call<Files & { subject: string; parent: number | null }>("GET", `${api}/commit/2`);
  const diff = one.files[0];
  check(one.subject === "Show the currency in formatPrice" && one.parent === 1, "one version has its message and its parent");
  check(one.files.length === 1 && diff.status === "modified" && diff.additions === 1 && diff.deletions === 1 && !!diff.patch?.includes("+  return `$${(cents / 100).toFixed(2)} USD`;"), "and its diff, line by line");
  const all = await call<Files>("GET", `${api}/compare?from=1`);
  check(all.files.map((f) => `${f.status} ${f.path}`).join(", ") === "added docs/releases.md, added notes.txt, modified src/format.js", "a compare lists every changed file");

  for (const [path, what] of [
    [`${api}/commit/9`, "a version not landed"],
    [`${api}/tree?path=nope`, "a directory that is not there"],
    [`${api}/blob?path=../package.json`, "a path out of the tree"],
  ] as const) {
    check((await text(path)).status === 404, `${what} is a 404`);
  }

  // GitHub's copy of the trunk's first version: the same files, its own history.
  const root = mkdtempSync(join(tmpdir(), "browse-"));
  execFileSync("git", ["clone", "-q", `${BASE}/git/${trunk}.git`, join(root, "trunk")]);
  const first = git(join(root, "trunk"), "rev-list", "--max-parents=0", "HEAD").trim();
  const upstream = join(root, "upstream");
  execFileSync("git", ["init", "-q", upstream]);
  execFileSync("sh", ["-c", `git -C "${join(root, "trunk")}" archive ${first} | tar -x -C "${upstream}"`]);
  git(upstream, "add", "-A");
  git(upstream, "-c", "user.name=gh", "-c", "user.email=gh@example.invalid", "commit", "-qm", "upstream");
  const mbox = await text(`${api}/patch`);
  writeFileSync(join(root, "work.mbox"), mbox.body);
  git(upstream, "-c", "user.name=me", "-c", "user.email=me@example.invalid", "am", "--keep-cr", join(root, "work.mbox"));
  const same = git(upstream, "rev-parse", "HEAD^{tree}").trim() === git(join(root, "trunk"), "rev-parse", "HEAD^{tree}").trim();
  check(same, "git am applies the patch to a copy with no shared history, giving the trunk's newest tree");
  const message = git(upstream, "log", "-1", "--format=%an%n%s%n%b");
  check(/^nanohub swarm\nLand 3 changes from the swarm trunk/.test(message) && message.includes("Swarm-Versions: v1..v4"), "as one commit that lists where it came from");
  const plain = await text(`${api}/patch?format=diff&from=2&to=3`);
  check(plain.body.startsWith("diff --git a/docs/releases.md b/docs/releases.md\nnew file mode 100644"), "format=diff gives the bare diff of a range");

  const brief = await text(`${api}/brief`);
  check(brief.status === 200 && brief.body.includes(`git clone ${BASE}/git/${trunk}.git`) && brief.body.includes("## Direct landing when requested"), "the brief tells an agent how to clone and land");
  const { host } = new URL(BASE);
  check(brief.body.includes(`<agent>@${host}/git/${trunk}.git`) && brief.body.includes("credential.helper=") && !brief.body.includes("<token>@"), "and how to push with its token kept out of the URL");
  check((await call<unknown[]>("GET", "/api/github/trunks?repo=nobody/nothing")).length === 0, "no trunk came from a repository nobody imported");
} finally {
  await cleanup([trunk]);
}
console.log(failed ? `${failed} failed` : "ok");
process.exit(failed ? 1 : 0);
