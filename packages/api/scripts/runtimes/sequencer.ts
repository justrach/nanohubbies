// The sequencer's own code landing ROUNDS x N changes back to back, as the dev
// server's benchmark endpoint does, then publishing them. Bundled and run by
// scripts/runtimes.ts; prints one JSON line.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Packer } from "../../src/packer.ts";
import { Sequencer } from "../../src/sequencer.ts";
import { TEMPLATES } from "../../src/templates.ts";
import { memoryBucket, openSql } from "./storage.ts";

const N = Number(process.env.N ?? 1000);
const ROUNDS = Number(process.env.ROUNDS ?? 3);
// `swarm`: bots reworking their own files, as scripted agents do; `files`: a new small file each.
const SHAPE = process.env.SHAPE ?? "files";
const BOTS = Number(process.env.BOTS ?? 1000);
// Changes per call, as a lane batches them, each call in its own turn with APART=1.
const BATCH = Number(process.env.BATCH ?? 1);
const APART = process.env.APART === "1";
const bun = (globalThis as { Bun?: { version: string } }).Bun;
const dir = mkdtempSync(join(tmpdir(), "sequencer-"));
const storageAt = async (file: string) => {
  const sql = await openSql(join(dir, file));
  return { sql, transactionSync: sql.transactionSync, getAlarm: async () => null, setAlarm: async () => {}, deleteAlarm: async () => {}, deleteAll: async () => {} };
};
const storage = await storageAt("do.sqlite");
const packerStorage = await storageAt("packer.sqlite");
const env: Record<string, unknown> = { OBJECTS: memoryBucket(), ROOM: { idFromName: () => "room", get: () => ({ publish: async () => {} }) } };
// The trunk's packer, called directly: it does its work on this thread too,
// as it would on a busy machine running both.
const packer = new Packer({ storage: packerStorage } as never, env as never);
env.PACKER = { idFromName: () => "packer", get: () => packer };
const seq = new Sequencer({ storage } as never, env as never);
await seq.init("runtimes", Object.entries(TEMPLATES.shop).map(([path, text]) => ({ path, text })));

let deciding = 0;
const started = performance.now();
for (let r = 0; r < ROUNDS; r++) {
  const t = performance.now();
  const landed = await seq.benchmark(N, `r${r}`, APART, SHAPE, BOTS, BATCH);
  deciding += performance.now() - t;
  if (landed !== N) throw new Error(`only ${landed} of ${N} changes landed`);
  await new Promise((resolve) => setTimeout(resolve, 0));
}
await seq.whenPublished(seq.info().tip.version);
const total = performance.now() - started;
storage.sql.close();
packerStorage.sql.close();
rmSync(dir, { recursive: true, force: true });
const n = N * ROUNDS;
console.log(
  JSON.stringify({
    runtime: bun ? `Bun ${bun.version}` : `Node ${process.versions.node}`,
    deciding: Math.round(n / (deciding / 1000)),
    published: Math.round(n / (total / 1000)),
  }),
);
