"use client";

import { useEffect, useState } from "react";
import { ViewToggle } from "@/components/Panel";
import { ticks } from "@/lib/format";
import { EvilBarChart } from "./evilcharts/charts";

interface Row {
  step: string;
  /** 0 means the sequencer alone, measured inside it. */
  agents: number;
  perSecond: number;
  sustained: number;
  p50: number;
  p95: number;
  errors: number;
  at: number;
}

/** scripts/runtimes.ts: the sequencer's own code on Node and on Bun, outside Workers. */
interface Runtimes {
  results: { runtime: string; deciding: number; published: number }[];
}

const SHOWN_AGENTS = 32;
/** Entire's own figure: pushes per second to one repository, each agent on its
 *  own branch, on their hosted cloud. A claim, so drawn as a reference. */
const ENTIRE = 583;

/** The hill climb on landing throughput, from scripts/climb.ts: each step a
 *  change to the code, measured the same way. */
export function HillClimb() {
  const [rows, setRows] = useState<Row[] | null | undefined>(undefined);
  const [runtimes, setRuntimes] = useState<Runtimes | null>(null);
  const [table, setTable] = useState(false);
  useEffect(() => {
    const json = async <T,>(path: string): Promise<T | null> => {
      const r = await fetch(path).catch(() => null);
      return r?.ok && r.headers.get("content-type")?.includes("json")
        ? ((await r.json()) as T)
        : null;
    };
    void json<Row[]>("/climb.json").then(setRows);
    void json<Runtimes>("/runtimes.json").then(setRuntimes);
  }, []);

  if (rows === undefined) return null;
  if (!rows?.length) {
    return (
      <p className="text-xs leading-5 text-muted">
        No climb yet. With the dev server running,{" "}
        <code className="text-ink-2">STEP=baseline node scripts/climb.ts</code>{" "}
        in packages/api measures one step, and each step appears here.
      </p>
    );
  }
  const steps = [...new Set(rows.map((r) => r.step))];
  const latest = (step: string, agents: number) =>
    rows.filter((r) => r.step === step && r.agents === agents).at(-1);
  const climb = steps.flatMap((step, i) => {
    const r = latest(step, SHOWN_AGENTS);
    return r ? [{ label: `${i}`, name: step, value: r.perSecond }] : [];
  });
  const alone = rows.filter((r) => r.agents === 0).at(-1);
  const endToEnd = climb.at(-1);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-ink-2">
          Landed per second on one trunk, {SHOWN_AGENTS} agents at once, each
          step a change to the code
        </p>
        <ViewToggle table={table} onChange={setTable} />
      </div>
      {table ? (
        <table className="tabular w-full text-xs">
          <thead className="text-muted">
            <tr>
              <th className="py-1 text-left font-normal">Step</th>
              <th className="py-1 text-right font-normal">Agents</th>
              <th className="py-1 text-right font-normal">Landed per second</th>
              <th className="py-1 text-right font-normal">p50</th>
              <th className="py-1 text-right font-normal">p95</th>
            </tr>
          </thead>
          <tbody className="text-ink-2">
            {steps.flatMap((step, i) =>
              [1, 8, 32, 128, 0].flatMap((n) => {
                const r = latest(step, n);
                return r
                  ? [
                      <tr key={`${step}-${n}`} className="border-t border-line">
                        <td className="py-1">
                          {i}. {step}
                        </td>
                        <td className="py-1 text-right">
                          {n === 0 ? "sequencer alone" : n}
                        </td>
                        <td className="py-1 text-right text-ink">
                          {(n === 0 ? r.sustained : r.perSecond).toLocaleString(
                            "en-US",
                          )}
                        </td>
                        <td className="py-1 text-right">
                          {n === 0 ? "" : `${r.p50} ms`}
                        </td>
                        <td className="py-1 text-right">
                          {n === 0 ? "" : `${r.p95} ms`}
                        </td>
                      </tr>,
                    ]
                  : [];
              }),
            )}
          </tbody>
        </table>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Columns items={climb} />
          <div>
            <p className="mb-2 text-xs text-ink-2">
              Where the ceiling is, landings or pushes per second
            </p>
            <Ceiling
              items={[
                ...(endToEnd
                  ? [
                      {
                        label: "This laptop, end to end",
                        value: endToEnd.value,
                        kind: "ours" as const,
                      },
                    ]
                  : []),
                ...(alone
                  ? [
                      {
                        label:
                          "The sequencer alone, landing and publishing, one laptop core",
                        value: alone.sustained,
                        kind: "ours" as const,
                      },
                    ]
                  : []),
                ...(runtimes?.results ?? []).map((r) => ({
                  label: `The same sequencer code on ${r.runtime}, outside Workers`,
                  value: r.published,
                  kind: "yardstick" as const,
                })),
                {
                  label: "Entire's claim, hosted cloud",
                  value: ENTIRE,
                  kind: "claim" as const,
                },
              ]}
            />
          </div>
        </div>
      )}
      <ol className="mt-3 grid gap-x-6 gap-y-0.5 text-[11px] text-muted sm:grid-cols-2">
        {steps.map((s, i) => (
          <li key={s}>
            {i}. {s}
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[11px] leading-4 text-muted">
        Measured on one laptop with wrangler dev, where the API, every agent
        object and the sequencer share one thread, so end to end is bound by the
        total work per change. Deployed, everything but the sequencer runs in
        parallel; the sequencer alone, landing changes and publishing them to
        R2, is the ceiling. From step 4 on, each step ran on a fresh local
        store. Node and Bun run the sequencer's own code with stand-ins for its
        SQLite and R2 (scripts/runtimes.ts); they cannot host Durable Objects,
        so they show how much of a landing is the runtime's cost, not a way to
        deploy. Entire's figure is its own claim for pushes to separate branches
        of one repository, not changes landed on one trunk.
      </p>
    </div>
  );
}

function Columns({
  items,
}: {
  items: { label: string; name: string; value: number }[];
}) {
  return (
    <EvilBarChart
      title="Landed per second at each step of the climb"
      data={items.map((i) => ({
        label: `step ${i.label}`,
        name: i.name,
        value: i.value,
      }))}
      ticks={ticks(Math.max(...items.map((i) => i.value), 1))}
      series={[
        { key: "value", label: "Landed per second", color: "var(--series-1)" },
      ]}
    />
  );
}

const KIND = {
  ours: { color: "var(--series-1)", name: "on Workers" },
  yardstick: { color: "var(--series-2)", name: "outside Workers, a yardstick" },
  claim: { color: "var(--axis)", name: "someone else's claim" },
} as const;

/** Horizontal bars on one scale, labelled at the ends, colored by what they
 *  are: ours on Workers, the same code on another runtime, someone's claim. */
function Ceiling({
  items,
}: {
  items: { label: string; value: number; kind: keyof typeof KIND }[];
}) {
  const max = Math.max(...items.map((i) => i.value), 1);
  const kinds = [...new Set(items.map((i) => i.kind))];
  return (
    <div>
      <ul className="grid gap-3">
        {items.map((it) => (
          <li key={it.label}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
              <span className="text-ink-2">{it.label}</span>
              <span className="tabular text-ink">
                {it.value.toLocaleString("en-US")}
              </span>
            </div>
            <div className="h-2.5 rounded-[3px] bg-wash">
              <div
                className="h-full rounded-[3px]"
                style={{
                  width: `${Math.max(1, (100 * it.value) / max)}%`,
                  background: KIND[it.kind].color,
                }}
              />
            </div>
          </li>
        ))}
      </ul>
      {kinds.length > 1 && (
        <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
          {kinds.map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-[2px]"
                style={{ background: KIND[k].color }}
              />
              {KIND[k].name}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
