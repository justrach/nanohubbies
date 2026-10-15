// How much of a landing's cost is the runtime: the sequencer's own code,
// landing changes back to back and publishing them, run on Node and on Bun.
// Neither can host a Durable Object, so this is a yardstick, not a way to
// deploy: put beside the sequencer-alone rate scripts/climb.ts measures in
// workerd, it shows what a landing costs the code and what it costs the
// runtime. Writes apps/web/public/runtimes.json for the home page.
//   node scripts/runtimes.ts            (BUN=/path/to/bun picks the Bun; RUNS=3)

import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { build } from "esbuild";

interface Result {
  runtime: string;
  deciding: number;
  published: number;
}

const here = dirname(new URL(import.meta.url).pathname);
const OUT = process.env.OUT ?? join(here, "../../../apps/web/public/runtimes.json");
const RUNS = Number(process.env.RUNS ?? 3);
const bundle = join(tmpdir(), `sequencer-${process.pid}.mjs`);
await build({
  entryPoints: [join(here, "runtimes/sequencer.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "es2022",
  alias: { "cloudflare:workers": join(here, "runtimes/workers.ts") },
  external: ["bun:sqlite"],
  outfile: bundle,
  logLevel: "warning",
});

const results: Result[] = [];
for (const bin of [process.execPath, process.env.BUN ?? "bun"]) {
  const runs: Result[] = [];
  for (let i = 0; i < RUNS; i++) {
    const r = spawnSync(bin, [bundle], { encoding: "utf8" });
    const line = (r.stdout ?? "").trim().split("\n").at(-1) ?? "";
    if (r.status !== 0 || !line.startsWith("{")) {
      console.log(`${bin}: did not run (${r.error?.message ?? (r.stderr ?? "").trim().split("\n").at(-1)})`);
      break;
    }
    runs.push(JSON.parse(line) as Result);
  }
  if (!runs.length) continue;
  const median = (k: "deciding" | "published") => runs.map((r) => r[k]).sort((a, b) => a - b)[Math.floor(runs.length / 2)];
  const row = { runtime: runs[0].runtime, deciding: median("deciding"), published: median("published") };
  console.log(`${row.runtime}: ${row.deciding} landed/s deciding, ${row.published}/s with publishing (median of ${runs.length})`);
  results.push(row);
}
rmSync(bundle, { force: true });
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify({ at: Date.now(), results }, null, 1)}\n`);
