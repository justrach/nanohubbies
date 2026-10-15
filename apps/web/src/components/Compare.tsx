"use client";

import { useEffect, useState } from "react";
import { ViewToggle } from "@/components/Panel";
import { ticks } from "@/lib/format";
import { EvilBarChart } from "./evilcharts/charts";

type Mode = "swarm" | "direct" | "queue";
interface Result {
  mode: Mode;
  agents: number;
  landed: number;
  wasted: number;
  perSecond: number;
}
interface Bench {
  at: string;
  seconds: number;
  shared: number;
  results: Result[];
}

// Fixed order, so a mode keeps its color whatever was measured.
const MODES: { mode: Mode; label: string; color: string }[] = [
  { mode: "swarm", label: "Swarm sequencer", color: "var(--series-1)" },
  {
    mode: "direct",
    label: "Plain git, push to main",
    color: "var(--series-2)",
  },
  { mode: "queue", label: "Merge queue", color: "var(--series-3)" },
];

/** The three ways to land the same edits, measured by scripts/bench.ts on this
 *  machine. Two measures, so two charts: never one chart with two scales. */
export function Compare() {
  const [bench, setBench] = useState<Bench | null | undefined>(undefined);
  const [table, setTable] = useState(false);
  useEffect(() => {
    fetch("/bench.json").then(
      async (r) =>
        setBench(
          r.ok && r.headers.get("content-type")?.includes("json")
            ? ((await r.json()) as Bench)
            : null,
        ),
      () => setBench(null),
    );
  }, []);

  if (bench === undefined) return null;
  if (!bench) {
    return (
      <p className="text-xs leading-5 text-muted">
        No measurements yet. With{" "}
        <code className="text-ink-2">npx wrangler dev</code> running,{" "}
        <code className="text-ink-2">node scripts/bench.ts</code> runs the same
        edits three ways on this machine and the results appear here.
      </p>
    );
  }
  const agents = [...new Set(bench.results.map((r) => r.agents))].sort(
    (a, b) => a - b,
  );
  const get = (mode: Mode, n: number) =>
    bench.results.find((r) => r.mode === mode && r.agents === n);
  const shown = MODES.filter((m) =>
    bench.results.some((r) => r.mode === m.mode),
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
          {shown.map((m) => (
            <li key={m.mode} className="flex items-center gap-1.5">
              <span
                className="inline-block size-2.5 rounded-[2px]"
                style={{ background: m.color }}
                aria-hidden
              />
              {m.label}
            </li>
          ))}
        </ul>
        <ViewToggle table={table} onChange={setTable} />
      </div>
      {table ? (
        <table className="tabular w-full text-xs">
          <thead className="text-muted">
            <tr>
              <th className="py-1 text-left font-normal">Agents</th>
              <th className="py-1 text-left font-normal">Way</th>
              <th className="py-1 text-right font-normal">Landed per second</th>
              <th className="py-1 text-right font-normal">Wasted per landed</th>
              <th className="py-1 text-right font-normal">Landed</th>
              <th className="py-1 text-right font-normal">Wasted</th>
            </tr>
          </thead>
          <tbody className="text-ink-2">
            {agents.flatMap((n) =>
              shown.map((m) => {
                const r = get(m.mode, n);
                return r ? (
                  <tr key={`${n}-${m.mode}`} className="border-t border-line">
                    <td className="py-1">{n}</td>
                    <td className="py-1">{m.label}</td>
                    <td className="py-1 text-right text-ink">
                      {r.perSecond.toFixed(1)}
                    </td>
                    <td className="py-1 text-right">
                      {(r.wasted / Math.max(1, r.landed)).toFixed(2)}
                    </td>
                    <td className="py-1 text-right">
                      {r.landed.toLocaleString("en-US")}
                    </td>
                    <td className="py-1 text-right">
                      {r.wasted.toLocaleString("en-US")}
                    </td>
                  </tr>
                ) : null;
              }),
            )}
          </tbody>
        </table>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2">
          <Bars
            title="Landed per second"
            agents={agents}
            modes={shown}
            value={(m, n) => get(m, n)?.perSecond}
            format={(v) => v.toFixed(1)}
          />
          <Bars
            title="Wasted attempts per landed change"
            agents={agents}
            modes={shown}
            value={(m, n) => {
              const r = get(m, n);
              return r ? r.wasted / Math.max(1, r.landed) : undefined;
            }}
            format={(v) => v.toFixed(2)}
          />
        </div>
      )}
      <p className="mt-3 text-[11px] text-muted">
        {bench.seconds}s per run, {Math.round(bench.shared * 100)}% of edits to
        shared code, measured {new Date(bench.at).toLocaleString()}. Git runs
        include the fetch, rebase and push each agent needs; swarm agents read
        through the API instead of keeping a checkout.
      </p>
    </div>
  );
}

function Bars(props: {
  title: string;
  agents: number[];
  modes: typeof MODES;
  value: (m: Mode, n: number) => number | undefined;
  format: (v: number) => string;
}) {
  const data = props.agents.map((n) => ({
    label: `${n} agents`,
    ...Object.fromEntries(
      props.modes.map((m) => [m.mode, props.value(m.mode, n)]),
    ),
  }));
  const values = props.agents.flatMap((n) =>
    props.modes.map((m) => props.value(m.mode, n) ?? 0),
  );
  return (
    <div>
      <p className="mb-1 text-xs text-ink-2">{props.title}</p>
      <EvilBarChart
        title={props.title}
        height={190}
        data={data}
        ticks={ticks(Math.max(...values, 0.01))}
        format={props.format}
        series={props.modes.map((m) => ({
          key: m.mode,
          label: m.label,
          color: m.color,
        }))}
      />
    </div>
  );
}
