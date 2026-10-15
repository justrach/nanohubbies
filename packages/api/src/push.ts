import { applyEdits, isCode, symbols } from "./footprint";
import type { ObjectType } from "./git";
import { ObjectReader } from "./objects";
import { readRequest, report, ZERO, type RefStatus } from "./receive";
import { changedFiles, type Change } from "./trees";
import type { Edit, Head, Overlap, Owner, SubmitResult } from "./types";
import { unpack, type Unpacked } from "./unpack";
import { pushBranch } from "./review/push";

/** `git push` into a trunk. The pushed commits become one change: the
 *  difference between their tree and the newest trunk version among their
 *  ancestors. The sequencer lands it like any agent's change, unless a change
 *  that landed since touched the same code; then the push is refused, and the
 *  agent pulls, checks its change still holds, and pushes again. Pushing to
 *  main and to refs/for/main both mean "land this". */

const MAX_PUSH = 32 * 1024 * 1024;
const MAX_COMMITS = 200;
const LANDS = new Set(["refs/heads/main", "refs/for/main"]);
const strict = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
const utf8 = new TextDecoder();

/** Refuses the push with a message for whoever pushed. */
class Refusal extends Error {}

/** Who pushes: the person whose token it is, and the agent the remote URL's
 *  username names (the commit author when it names none). */
export interface Pusher {
  owner: Owner;
  agent: string | null;
  agentId?: string;
}

export async function receivePack(env: Env, trunk: string, request: Request, who: Pusher): Promise<Response> {
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.length > MAX_PUSH) return new Response("push too large\n", { status: 413 });
  const { commands, caps, pack } = readRequest(body);
  let objects: Map<string, Unpacked>;
  try {
    objects = pack.length ? unpack(pack) : new Map();
  } catch (e) {
    return report(caps, (e as Error).message, commands.map((c) => ({ ref: c.ref, refused: "unpack failed" })), []);
  }
  const messages: string[] = [];
  const statuses: RefStatus[] = [];
  for (const c of commands) {
    let refused: string | null;
    if (!LANDS.has(c.ref)) {
      try { await pushBranch(env, trunk, c, objects); refused = null; messages.push(`saved ${c.ref}; open a PR to review and land it`); }
      catch (error) { refused = (error as Error).message; }
    }
    else if (c.new === ZERO) refused = "main cannot be deleted";
    else {
      try {
        refused = await land(env, trunk, c.new, objects, messages, who);
      } catch (e) {
        if (!(e instanceof Refusal)) throw e;
        messages.push(e.message);
        refused = "refused, see above";
      }
    }
    statuses.push({ ref: c.ref, refused });
  }
  return report(caps, null, statuses, messages);
}

/** Shas the trunk recognises: a published version, or a push it landed. */
type Known = Record<string, { head: Head } | { pushedAs: number }>;

interface Commit {
  sha: string;
  tree: string;
  parents: string[];
  author: string;
  message: string;
  body: Uint8Array;
}

/** Lands the commits up to `tip`. Null when they landed; otherwise a few
 *  words for git's status line, with the details in `messages`. */
async function land(env: Env, trunk: string, tip: string, pack: Map<string, Unpacked>, messages: string[], who: Pusher): Promise<string | null> {
  const seq = env.SEQUENCER.get(env.SEQUENCER.idFromName(trunk));
  const packer = env.PACKER.get(env.PACKER.idFromName(trunk));
  const objects = new Objects(pack, new ObjectReader(env.OBJECTS, trunk, async () => (await packer.list()).packs));

  // The new commits, newest first, and the trunk versions they build on. A
  // client sends every commit it cannot see main has, so the pack may carry
  // trunk versions too, or a commit an earlier push already landed.
  const carried = [...pack].filter(([, o]) => o.type === "commit").map(([sha]) => sha);
  const known: Known = carried.length ? await seq.versionsOf(carried) : {};
  const commits: Commit[] = [];
  const bases: Head[] = [];
  const outside = new Set<string>();
  const place = (sha: string, hit: Known[string] | undefined): boolean => {
    if (!hit) return false;
    if ("head" in hit) bases.push(hit.head);
    else throw new Refusal(`your earlier push ${short(sha)} already landed as v${hit.pushedAs}, rebuilt on top of others' changes. Run git pull --rebase, then push again.`);
    return true;
  };
  for (const queue = [tip], seen = new Set<string>(); queue.length; ) {
    const sha = queue.shift()!;
    if (seen.has(sha) || place(sha, known[sha])) continue;
    seen.add(sha);
    const own = pack.get(sha);
    if (!own) {
      outside.add(sha);
      continue;
    }
    if (own.type !== "commit") throw new Refusal(`${short(sha)} is not a commit`);
    if (commits.length >= MAX_COMMITS) throw new Refusal(`push at most ${MAX_COMMITS} commits at a time`);
    const c = readCommit(sha, own.body);
    commits.push(c);
    queue.push(...c.parents);
  }
  const found: Known = outside.size ? await seq.versionsOf([...outside]) : {};
  for (const sha of outside) {
    if (!place(sha, found[sha])) throw new Refusal(`${short(sha)} is not on main. Run git pull --rebase, then push again.`);
  }
  if (!commits.length) throw new Refusal("nothing new to land: main already has these commits");
  if (!bases.length) throw new Refusal("these commits do not build on main. Clone the trunk and commit on top of it.");
  const base = bases.reduce((a, b) => (b.version > a.version ? b : a));
  const [newest] = commits;

  const changed = await changedFiles(objects, base.tree, newest.tree);
  if (!changed.length) throw new Refusal("these commits change nothing in main's files");
  const edits = await editsFor(objects, changed);

  const all = commits.map((c) => c.message).join("\n");
  const closing = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/i.exec(all);
  const mention = closing ?? /(?:^|\s)#(\d+)\b/.exec(all);
  const subject = newest.message.split("\n")[0].trim().slice(0, 200) || "pushed change";
  const intent = commits.length > 1 ? `${subject} (+${commits.length - 1} more)` : subject;
  const agent = who.agent ?? agentName(newest.author);
  if (!await env.ROOM.get(env.ROOM.idFromName(trunk)).agentAllowed(agent, who.agentId)) throw new Refusal("this handle is registered: use its scoped agent credential");
  const result: SubmitResult = await env.AGENT.get(env.AGENT.idFromName(`${trunk}/${agent}`)).pushed(trunk, agent, who.owner, base, intent, edits, {
    issue: mention ? Number(mention[1]) : null,
    closes: !!closing,
    pushed: commits.length === 1 ? { sha: newest.sha, body: newest.body } : null,
  });

  if (result.status === "landed") {
    // The agent's next push builds on this one, so it must be readable first.
    await seq.whenPublished(result.version);
    messages.push(`landed as v${result.version} (${short(result.commit)}) by ${agent}, for ${who.owner.name}`);
    if (commits.length > 1) messages.push(`your ${commits.length} commits landed as one. Run git pull --rebase before your next push.`);
    else if (result.commit !== newest.sha) {
      messages.push(`main moved on from v${base.version} while you worked, so your change was rebuilt on top. Run git pull --rebase before your next push.`);
    }
    for (const o of result.revalidate) messages.push(`check again: ${what(o)} changed in v${o.version}`);
    return null;
  }
  if (result.status === "conflict") {
    const by = new Map(result.winners.map((w) => [w.id, w.agent]));
    for (const o of result.conflicts) {
      const were = o.key.startsWith("r:") ? "were" : "was";
      messages.push(o.kind === "leased" ? `${what(o)} is held by ${o.by} for a moment` : `conflict: ${what(o)} ${were} changed by ${by.get(o.by) ?? o.by} in v${o.version}`);
    }
    messages.push("Run git pull --rebase, check your change still holds, and push again.");
    return "conflict: main changed the same code";
  }
  if (result.status === "busy") {
    messages.push("the trunk is still publishing earlier changes and takes no more for a moment: nothing landed, push again shortly");
    return "busy: push again shortly";
  }
  messages.push(result.error);
  return "rejected, see above";
}

/** The changed files as edits. JavaScript is edited symbol by symbol, so two
 *  agents can change different functions of one file; any other file, and
 *  code the symbols cannot describe exactly, is written whole. */
async function editsFor(objects: Objects, changed: Change[]): Promise<Edit[]> {
  const edits: Edit[] = [];
  for (const { path, before, after } of changed) {
    if (after && after.mode !== "100644" && after.mode !== "100755") throw new Refusal(`${path}: only regular files can be pushed, not links or submodules`);
    if (!after) {
      edits.push({ op: "remove", path });
      continue;
    }
    const text = textOf(path, await objects.body(after.sha, "blob"));
    if (!before) edits.push({ op: "create", path, text });
    else if (!isCode(path)) edits.push({ op: "replace", path, symbol: "*", text });
    else edits.push(...codeEdits(path, textOf(path, await objects.body(before.sha, "blob")), text));
  }
  return edits;
}

function codeEdits(path: string, before: string, after: string): Edit[] {
  const old = symbols(path, before);
  const neu = symbols(path, after);
  const whole = (s: { name: string }[]) => s.length === 1 && s[0].name === "*";
  if (!whole(old) && !whole(neu)) {
    const was = new Map(old.map((s) => [s.name, s.text]));
    const kept = new Set(neu.map((s) => s.name));
    const edits: Edit[] = [];
    let anchor: string | undefined;
    for (const s of neu) {
      const prev = was.get(s.name);
      if (prev === undefined) edits.push({ op: "insert", path, ...(anchor ? { after: anchor } : {}), text: s.text });
      else {
        if (prev !== s.text) edits.push({ op: "replace", path, symbol: s.name, text: s.text });
        anchor = s.name;
      }
    }
    for (const s of old) if (!kept.has(s.name)) edits.push({ op: "delete", path, symbol: s.name });
    // Only when replaying them on the old file gives exactly the new one.
    try {
      const replay = applyEdits(edits, (p) => (p === path ? before : undefined));
      if (edits.length && !replay.collisions.length && replay.files.get(path) === after) return edits;
    } catch {}
  }
  return [{ op: "write", path, text: after }];
}

function textOf(path: string, bytes: Uint8Array): string {
  try {
    return strict.decode(bytes);
  } catch {
    throw new Refusal(`${path} is not text; binary files cannot be pushed yet`);
  }
}

function readCommit(sha: string, body: Uint8Array): Commit {
  const raw = utf8.decode(body);
  const split = raw.indexOf("\n\n");
  const head = (split < 0 ? raw : raw.slice(0, split)).split("\n");
  const field = (k: string) => head.filter((l) => l.startsWith(`${k} `)).map((l) => l.slice(k.length + 1));
  const author = (field("author")[0] ?? "").replace(/\s*<.*$/, "");
  return { sha, tree: field("tree")[0] ?? "", parents: field("parent"), author, message: split < 0 ? "" : raw.slice(split + 2), body };
}

/** The commit author as an agent name the trunk accepts. */
function agentName(author: string): string {
  const name = author.trim().replace(/[^\w.-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "").slice(0, 64);
  return name || "git";
}

/** A footprint key in words. */
function what(o: Overlap): string {
  const [kind, rest] = [o.key.slice(0, 2), o.key.slice(2)];
  if (kind === "d:") {
    const [path, symbol] = rest.split("#");
    return symbol === "*" ? path : `${symbol} in ${path}`;
  }
  if (kind === "p:") return rest;
  return `the uses of ${rest}`;
}

const short = (sha: string) => sha.slice(0, 7);

/** Objects the push carried, then the trunk's own. */
class Objects {
  constructor(
    private pack: Map<string, Unpacked>,
    private trunk: ObjectReader,
  ) {}

  async body(sha: string, type: ObjectType): Promise<Uint8Array> {
    const obj = this.pack.get(sha) ?? (await this.trunk.get(sha));
    if (!obj) throw new Refusal(`the push needs ${short(sha)}, which neither it nor the trunk has`);
    if (obj.type !== type) throw new Refusal(`${short(sha)} is a ${obj.type}, not a ${type}`);
    return obj.body;
  }
}
