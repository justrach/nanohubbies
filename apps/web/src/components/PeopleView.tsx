import { useState } from "react";
import { Avatar } from "@/components/Avatar";
import { Panel, ViewToggle } from "@/components/Panel";
import { ago, percent } from "@/lib/format";
import type { Clash, Owner, Person, SwarmState } from "@/lib/types";

/** Everyone whose agents work on this trunk, and whose changes their agents
 *  had to re-plan around. Nobody coordinated any of it: each person launched
 *  their own agents, and the sequencer sorted out the overlaps. */
export function PeopleView(props: { people: Person[]; watchers: Owner[]; swarms: SwarmState[]; clashes: Clash[]; serverNow: number }) {
  const [table, setTable] = useState(false);
  const here = new Set(props.watchers.map((w) => w.id));
  const running = new Map(props.swarms.filter((s) => s.running).map((s) => [s.owner.id, s]));
  // Someone watching who has no agents yet still belongs on the list.
  const people: Person[] = [
    ...props.people,
    ...props.watchers
      .filter((w) => !props.people.some((p) => p.id === w.id))
      .map((w) => ({ id: w.id, name: w.name, seen: 0, landed: 0, conflicts: 0, rejected: 0, agents: 0, closed: 0 })),
  ];
  const landed = people.reduce((n, p) => n + p.landed, 0);
  const max = Math.max(1, ...people.map((p) => p.landed));

  return (
    <div className="grid items-start gap-4 lg:grid-cols-3">
      <Panel className="lg:col-span-2" title="People" subtitle={`${people.length} ${people.length === 1 ? "person" : "people"} on this trunk, each with their own agents`}>
        {people.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted">Nobody yet. Sign in and launch a swarm, or start a life from the API.</p>
        ) : (
          <table className="tabular w-full text-xs">
            <thead className="text-muted">
              <tr>
                <th className="py-1.5 text-left font-normal">Person</th>
                <th className="py-1.5 text-left font-normal">Swarm</th>
                <th className="py-1.5 text-right font-normal">Agents</th>
                <th className="w-[30%] py-1.5 pl-4 text-left font-normal">Landed</th>
                <th className="py-1.5 text-right font-normal">Issues closed</th>
                <th className="py-1.5 text-right font-normal">Re-planned</th>
                <th className="py-1.5 text-right font-normal">Rejected</th>
                <th className="py-1.5 text-right font-normal">Last change</th>
              </tr>
            </thead>
            <tbody className="text-ink-2">
              {people.map((p) => {
                const s = running.get(p.id);
                return (
                  <tr key={p.id} className="border-t border-line">
                    <td className="py-2">
                      <span className="flex items-center gap-2">
                        <Avatar name={p.name} size={22} />
                        <span className="font-medium text-ink">{p.name}</span>
                        {here.has(p.id) && (
                          <span className="flex items-center gap-1 text-[11px] text-ink-2">
                            <span className="inline-block size-1.5 rounded-full bg-good" aria-hidden />
                            here now
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="py-2">{s ? `${s.agents.toLocaleString("en-US")} running, ${Math.max(0, Math.round((s.until - props.serverNow) / 1000))}s left` : <span className="text-muted">idle</span>}</td>
                    <td className="py-2 text-right">{p.agents.toLocaleString("en-US")}</td>
                    <td className="py-2 pl-4">
                      <div className="flex items-center gap-2">
                        <span className="w-12 shrink-0 text-right font-semibold text-ink">{p.landed.toLocaleString("en-US")}</span>
                        <div className="h-1.5 flex-1 rounded-full" style={{ background: "color-mix(in srgb, var(--series-1) 18%, transparent)" }}>
                          <div className="h-1.5 rounded-full" style={{ width: `${(100 * p.landed) / max}%`, background: "var(--series-1)" }} />
                        </div>
                        <span className="w-10 shrink-0 text-right text-muted">{percent(p.landed, landed)}</span>
                      </div>
                    </td>
                    <td className="py-2 text-right">{p.closed.toLocaleString("en-US")}</td>
                    <td className="py-2 text-right">{p.conflicts.toLocaleString("en-US")}</td>
                    <td className="py-2 text-right">{p.rejected.toLocaleString("en-US")}</td>
                    <td className="py-2 text-right text-muted">{p.seen ? ago(props.serverNow - p.seen) : "never"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
      <Panel title="Who re-planned around whom" subtitle="Conflicts by whose agent lost and whose change won" actions={<ViewToggle table={table} onChange={setTable} />}>
        <Clashes clashes={props.clashes} table={table} />
      </Panel>
    </div>
  );
}

const who = (name: string) => name || "Unattributed";

function Clashes({ clashes, table }: { clashes: Clash[]; table: boolean }) {
  if (!clashes.length) return <p className="py-6 text-center text-xs text-muted">No conflicts yet.</p>;
  const total = clashes.reduce((n, c) => n + c[2], 0);
  const across = clashes.reduce((n, [loser, winner, k]) => n + (loser === winner ? 0 : k), 0);
  const max = clashes[0][2];
  const top = clashes.slice(0, 10);
  return (
    <div>
      <p className="text-3xl font-semibold tracking-tight text-ink">{percent(across, total)}</p>
      <p className="text-xs text-muted">of conflicts were between different people's agents</p>
      {table ? (
        <table className="tabular mt-4 w-full text-xs">
          <thead className="text-muted">
            <tr>
              <th className="py-1 text-left font-normal">Re-planned</th>
              <th className="py-1 text-left font-normal">Around</th>
              <th className="py-1 text-right font-normal">Conflicts</th>
            </tr>
          </thead>
          <tbody className="text-ink-2">
            {clashes.map(([loser, winner, n]) => (
              <tr key={`${loser}>${winner}`} className="border-t border-line">
                <td className="py-1">{who(loser)}</td>
                <td className="py-1">{loser === winner ? "their own agents" : who(winner)}</td>
                <td className="py-1 text-right text-ink">{n.toLocaleString("en-US")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {top.map(([loser, winner, n]) => (
            <li key={`${loser}>${winner}`} className="text-xs">
              <div className="flex justify-between gap-2">
                <span className="truncate text-ink-2">
                  <span className="font-medium text-ink">{who(loser)}</span> around{" "}
                  {loser === winner ? <span className="text-muted">their own agents</span> : <span className="font-medium text-ink">{who(winner)}</span>}
                </span>
                <span className="tabular shrink-0 font-semibold text-ink">{n.toLocaleString("en-US")}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full" style={{ background: "color-mix(in srgb, var(--warning) 18%, transparent)" }}>
                <div className="h-1.5 rounded-full" style={{ width: `${(100 * n) / max}%`, background: "var(--warning)" }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
