// Hill climbing on landing throughput: how many changes one trunk lands per
// second as more agents land at once. Each agent works on its own file, so
// nothing conflicts and the trunk's sequencer is the only thing they share;
// every landing is still a full change: a life, a footprint check, a commit.
//
// Each run is one step of the climb, labelled with STEP, and appends one row
// per agent count to apps/web/public/climb.json, which the dashboard charts.
// OUT writes elsewhere, for a side-by-side check that should not be charted.
// Local storage slows as it fills, so run each step against a dev server on a
// fresh store: npx wrangler dev --port 8788 --persist-to "$(mktemp -d)".
//   STEP="baseline" AGENTS=1,8,32,128 SECONDS=10 SWARM_URL=http://localhost:8788 node scripts/climb.ts

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { call, session } from "./client.ts";

const AGENTS = (process.env.AGENTS ?? "1,8,32,128").split(",").map(Number);
const SECONDS = Number(process.env.SECONDS ?? 10);
const STEP = process.env.STEP ?? "baseline";
// Scripted lives skip announcing themselves to the room, as scripted agents do.
const KIND = process.env.KIND === "scripted" ? "scripted" : "agent";
const OUT = process.env.OUT ?? join(dirname(new URL(import.meta.url).pathname), "../../../apps/web/public/climb.json");

export interface ClimbRow {
  step: string;
  agents: number;
  seconds: number;
  landed: number;
  perSecond: number;
  /** Landed per second counting until every landed change was published. */
  sustained: number;
  /** Milliseconds from asking for a life to the change landing, per change. */
  p50: number;
  p95: number;
  errors: number;
  at: number;
}

const work = (k: number) => `export function work() {\n  return ${k};\n}\n`;

async function run(agents: number): Promise<ClimbRow> {
  const trunk = `climb-${Date.now().toString(36)}`;
  await call("POST", `/api/trunks/${trunk}`, { template: "shop" });
  const times: number[] = [];
  let landed = 0;
  let errors = 0;
  const why = new Map<string, number>();
  const note = (m: string) => why.set(m.slice(0, 120), (why.get(m.slice(0, 120)) ?? 0) + 1);
  const started = Date.now();
  const stop = started + SECONDS * 1000;
  await Promise.all(
    Array.from({ length: agents }, async (_, i) => {
      const name = `climber-${String(i).padStart(4, "0")}`;
      const path = `src/swarm/g${String(i % 64).padStart(2, "0")}/${name}.js`;
      const agent = session(trunk, name);
      let made = false;
      for (let k = 1; Date.now() < stop; k++) {
        const t0 = performance.now();
        try {
          await call("POST", `/api/trunks/${trunk}/agents/${name}/lives`, { kind: KIND });
          const r = await agent.submit({
            intent: `Step ${k}`,
            edits: made ? [{ op: "replace", path, symbol: "work", text: work(k) }] : [{ op: "create", path, text: work(k) }],
          });
          if (r.status === "landed") {
            landed++;
            made = true;
            times.push(performance.now() - t0);
          } else {
            errors++;
            note(`${r.status}: ${r.error ?? r.conflicts?.map((c) => c.key).join(", ") ?? ""}`);
          }
        } catch (e) {
          errors++;
          note((e as Error).message);
        }
      }
    }),
  );
  if (why.size) console.log(`   errors: ${[...why].map(([m, n]) => `${n}× ${m}`).join(" | ")}`);
  const seconds = (Date.now() - started) / 1000;
  const total = ((await caughtUp(trunk)) - started) / 1000;
  if (process.env.KEEP) console.log(`   kept ${trunk}`);
  else await call("DELETE", `/api/trunks/${trunk}`);
  times.sort((a, b) => a - b);
  const at = (q: number) => Math.round(times[Math.min(times.length - 1, Math.floor(q * times.length))] ?? 0);
  const round = (n: number) => Math.round(n * 10) / 10;
  return { step: STEP, agents, seconds, landed, perSecond: round(landed / seconds), sustained: round(landed / total), p50: at(0.5), p95: at(0.95), errors, at: Date.now() };
}

/** Landing is counted when the sequencer answers; publishing (the objects in
 *  R2, clonable) may trail. When it caught up, for the sustained rate. */
async function caughtUp(trunk: string): Promise<number> {
  for (let i = 0; i < 3000; i++) {
    const { head, tip } = await call<{ head: { version: number }; tip: { version: number } }>("GET", `/api/trunks/${trunk}/info`);
    if (head.version >= tip.version) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  return Date.now();
}

/** The sequencer alone: changes landed back to back inside it, with no HTTP,
 *  no agents and no other objects in the way. Recorded as agents: 0. Its
 *  sustained rate counts publishing too, which runs in the same object. */
async function sequencerAlone(): Promise<ClimbRow> {
  const trunk = `climb-${Date.now().toString(36)}`;
  await call("POST", `/api/trunks/${trunk}`, { template: "shop" });
  let landed = 0;
  let ms = 0;
  const started = Date.now();
  for (let i = 0; i < 3; i++) {
    const r = await call<{ landed: number; ms: number }>("POST", `/api/trunks/${trunk}/benchmark?n=1000`);
    landed += r.landed;
    ms += r.ms;
  }
  const total = ((await caughtUp(trunk)) - started) / 1000;
  if (process.env.KEEP) console.log(`   kept ${trunk}`);
  else await call("DELETE", `/api/trunks/${trunk}`);
  const perSecond = Math.round(landed / (ms / 1000));
  return { step: STEP, agents: 0, seconds: ms / 1000, landed, perSecond, sustained: Math.round(landed / total), p50: 0, p95: 0, errors: 0, at: Date.now() };
}

const history: ClimbRow[] = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : [];
for (const agents of AGENTS) {
  const row = await run(agents);
  console.log(`${STEP}: ${agents} agents, ${row.perSecond} landed/s (${row.sustained}/s until published), p50 ${row.p50} ms, p95 ${row.p95} ms${row.errors ? `, ${row.errors} errors` : ""}`);
  history.push(row);
}
if (!process.env.SKIP_SEQUENCER) {
  const alone = await sequencerAlone();
  console.log(`${STEP}: the sequencer alone, ${alone.perSecond} landed/s, ${alone.sustained}/s until published`);
  history.push(alone);
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(history, null, 1)}\n`);
