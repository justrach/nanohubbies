import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { symbols } from "../footprint";
import { encode, tree } from "../git";
import type { Sequencer } from "../sequencer";
import { key, type ChangeRequest, type Edit } from "../types";

/** Lands `n` changes back to back, each a full landing (footprint check, edit,
 *  trees, commit), with nothing in between: how fast the sequencer, the one
 *  part of the system that cannot run in parallel, decides. None conflict.
 *  Shaped as `files`, each change creates a small file of its own. Shaped as
 *  `swarm`, `bots` agents take turns, each creating its own file and then
 *  reworking or adding functions in it, with the reads that go with them, as
 *  scripted agents do (../driver); their files outlive the call. Changes go
 *  in batches of `batch`, as a lane sends them; with `apart`, each batch runs
 *  in its own turn and so commits on its own, as a lane's calls do. Local
 *  development and test copies only. */
export async function backToBack(seq: Sequencer, n: number, prefix: string, apart: boolean, shape = "files", bots = 1000, batch = 1): Promise<number> {
  const fns = new Map<number, number>();
  let seed = 1;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  let landed = 0;
  let reqs: ChangeRequest[] = [];
  for (let i = 0; i < n; i++) {
    let edit: Edit;
    let strong: string[] = [];
    if (shape === "swarm") {
      const b = i % bots;
      const name = `bench-${String(b).padStart(4, "0")}`;
      const path = `src/swarm/${name.slice(0, -2)}/${name}.js`;
      // How far the bot's file got, from the trunk, the first time.
      if (!fns.has(b)) fns.set(b, existing(seq, path));
      const have = fns.get(b)!;
      if (have === 0) {
        edit = { op: "create", path, text: `${task(1, i)}\n` };
        strong = [key.path(path)];
      } else if (random() < 0.6) {
        const k = 1 + Math.floor(random() * have);
        edit = { op: "replace", path, symbol: `task${k}`, text: task(k, i) };
        strong = [key.path(path), key.def(path, `task${k}`)];
      } else edit = { op: "insert", path, text: task(have + 1, i) };
      if (edit.op !== "replace") fns.set(b, have + 1);
    } else edit = { op: "create", path: `bench/${prefix}/g${i % 64}/f${i}.js`, text: `export function work() {\n  return ${i};\n}\n` };
    reqs.push({
      id: `b${prefix}${i}`,
      agent: `bench-${i % 32}`,
      kind: "scripted",
      owner: null,
      life: 1,
      intent: `Benchmark ${i}`,
      base: seq.info().tip.version,
      reads: { strong, weak: [] },
      edits: [edit],
      issue: null,
      closes: false,
    });
    if (reqs.length < batch && i < n - 1) continue;
    if (apart) await new Promise((r) => setTimeout(r, 0));
    const { results } = await seq.land(reqs, []);
    landed += results.filter((r) => r.status === "landed").length;
    reqs = [];
  }
  return landed;
}

const task = (n: number, life: number) => `export function task${n}() {\n  return ${n * 1000 + life};\n}`;

/** The functions a bot's file has at the tip, or 0 when it has no file yet. */
function existing(seq: Sequencer, path: string): number {
  try {
    return (seq.read(path).text.match(/^export function task/gm) ?? []).length;
  } catch {
    return 0;
  }
}

/** Runs one kind of operation `n` times, for timing from outside the call:
 *  what a landing's parts cost on the machine the sequencer runs on. */
export function repeat(sql: SqlStorage, op: string, n: number): number {
  const text = "import { a } from './a.js';\n\nexport function work(x) {\n  return a(x) + 1;\n}\n";
  const bytes = new TextEncoder().encode(text.repeat(4));
  const entries64 = Array.from({ length: 64 }, (_, i) => ({ mode: i % 2 ? "100644" : "40000", name: `g${String(i).padStart(2, "0")}`, sha: "0123456789abcdef0123456789abcdef01234567" }));
  let sink = 0;
  for (let i = 0; i < n; i++) {
    if (op === "write") sql.exec("INSERT INTO meta (k, v) VALUES ('bench', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", String(i));
    else if (op === "read") sink += sql.exec("SELECT v FROM meta WHERE k = 'tip'").toArray().length;
    else if (op === "sha1") sink += createHash("sha1").update(bytes).digest("hex").length;
    else if (op === "parse") sink += symbols("src/a.js", text).length;
    else if (op === "deflate") sink += deflateSync(bytes).length;
    else if (op === "encode") sink += encode("blob", bytes).sha.length;
    else if (op === "tree64") sink += tree(entries64).sha.length;
    else if (op === "land") sink += i;
  }
  return sink;
}

/** The data center the calling object runs in, from Cloudflare's trace endpoint. */
export async function dataCenter(): Promise<string | null> {
  const trace = await fetch("https://www.cloudflare.com/cdn-cgi/trace").then((r) => r.text());
  return /^colo=(\w+)$/m.exec(trace)?.[1] ?? null;
}
