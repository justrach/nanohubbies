"use client";

import { KeyRound, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AgentDrawer } from "@/components/AgentDrawer";
import { AgentWall } from "@/components/AgentWall";
import { ChangeFeed } from "@/components/ChangeFeed";
import { Channel } from "@/components/Channel";
import { HotSpots } from "@/components/HotSpots";
import { IssueDrawer } from "@/components/IssueDrawer";
import { LivesBar } from "@/components/LivesBar";
import { Panel, ViewToggle } from "@/components/Panel";
import { ReviewQueue } from "@/components/ReviewQueue";
import { StatTiles } from "@/components/StatTiles";
import { SwarmControls } from "@/components/SwarmControls";
import { TimeSeries } from "@/components/TimeSeries";
import { LinkButton } from "@/components/ui";
import { useLiveRoom, useTrunk } from "../context";
import { trunkHref } from "../paths";
import { useClock, useLiveCount } from "./useClock";

const WINDOW = 120;

/** The trunk as it happens: how fast changes land, how lives end, every
 *  agent, where they collide, every outcome, what needs a person, and the
 *  channel agents hear conflicts on. */
export function LiveView() {
  const { trunk, tip } = useTrunk();
  const room = useLiveRoom();
  const clock = useClock();
  const [selected, setSelected] = useState<string | null>(null);
  const [issue, setIssue] = useState<number | null>(null);
  const [tables, setTables] = useState({ throughput: false, lives: false, wall: false });

  // The bell links here with #review.
  useEffect(() => {
    if (location.hash === "#review") requestAnimationFrame(() => document.getElementById("review")?.scrollIntoView({ behavior: "smooth" }));
  }, []);

  const serverNow = clock + room.skew;
  const lastSec = Math.floor(serverNow / 1000) - 1;
  const series = useMemo(() => {
    const landed: number[] = [];
    const conflicts: number[] = [];
    for (let s = lastSec - WINDOW + 1; s <= lastSec; s++) {
      const v = room.seconds.get(s);
      landed.push(v?.landed ?? 0);
      conflicts.push(v?.conflicts ?? 0);
    }
    return { landed, conflicts };
  }, [room.tick, lastSec]); // eslint-disable-line react-hooks/exhaustive-deps
  const live = useLiveCount(room, serverNow);

  const t = room.totals;
  const lives = t.landed + t.conflicts + t.rejected + t.unpaid;
  const perSecond = series.landed.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const toggle = (k: keyof typeof tables) => (v: boolean) => setTables((s) => ({ ...s, [k]: v }));

  return (
    <main className="mx-auto max-w-[1440px] space-y-5 px-5 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-ink">Live activity</h2>
          <p className="mt-1 text-sm text-ink-2">Monitor changes, agents, and reviews as they arrive.</p>
        </div>
        <span role="status" className="text-xs text-muted">
          {room.status === "live" ? "Live updates connected" : room.status === "connecting" ? "Connecting to the live feed…" : "Feed disconnected · reconnecting…"}
        </span>
      </div>
      {room.agents.size === 0 && room.status === "live" && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-line px-4 py-3 text-xs text-ink-2">
          <span>No agent activity yet. Set up a workspace, connect your agent, and push a change to begin.</span>
          <LinkButton href={trunkHref(trunk, "/setup")} size="sm" variant="primary">
            <KeyRound size={12} aria-hidden /> Set up an agent
          </LinkButton>
        </div>
      )}
      <StatTiles perSecond={perSecond} history={series.landed.slice(-60)} landed={t.landed} conflicts={t.conflicts} lives={lives} live={live} version={tip} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title="Throughput" subtitle="Last 2 minutes, per second" actions={<ViewToggle table={tables.throughput} onChange={toggle("throughput")} />}>
          <p className="mb-1 text-xs text-ink-2">Landed changes</p>
          <TimeSeries values={series.landed} color="var(--series-1)" name="landed" height={170} table={tables.throughput} />
          <p className="mt-3 mb-1 flex items-center gap-1.5 text-xs text-ink-2">
            <RotateCcw size={12} strokeWidth={2.25} style={{ color: "var(--warning)" }} aria-hidden /> Conflicts, each re-planned by its agent
          </p>
          <TimeSeries values={series.conflicts} color="var(--warning)" name="conflicts" height={90} table={tables.throughput} />
        </Panel>
        <Panel title="How lives end" subtitle={`${lives.toLocaleString("en-US")} lives so far`} actions={<ViewToggle table={tables.lives} onChange={toggle("lives")} />}>
          <LivesBar totals={t} table={tables.lives} />
          <div className="mt-5 border-t border-line pt-4">
            <p className="text-xs text-ink-2">Lives per landed change</p>
            <p className="mt-0.5 text-3xl font-semibold tracking-tight text-ink">{t.landed ? (lives / t.landed).toFixed(2) : "–"}</p>
            <p className="text-xs text-muted">1.00 would mean no attempt was ever thrown away</p>
          </div>
        </Panel>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Panel
          className="lg:col-span-2"
          title="Agents"
          subtitle={`${room.agents.size.toLocaleString("en-US")} agents, grouped by who they work for. Click one for its lives.`}
          actions={<ViewToggle table={tables.wall} onChange={toggle("wall")} />}
        >
          <AgentWall agents={room.agents} tick={room.tick} skew={room.skew} table={tables.wall} onSelect={setSelected} />
        </Panel>
        <Panel title="Where agents collide" subtitle="Conflicts per symbol, since the trunk began">
          <HotSpots hot={room.hot} />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Changes" subtitle="Every outcome, as it happens">
          <ChangeFeed trunk={trunk} feed={room.feed} onSelect={setSelected} onIssue={setIssue} />
        </Panel>
        <div id="review" className="scroll-mt-28">
          <Panel title="Review by exception" subtitle="Only what the sequencer could not vouch for" className="h-full">
            <ReviewQueue trunk={trunk} feed={room.feed} />
          </Panel>
        </div>
        <Panel title="Channel" subtitle="Conflicts reach real agents here as @mentions">
          <Channel messages={room.messages} post={room.post} />
        </Panel>
      </div>
      <details className="practice-controls border-t border-line pt-4">
        <summary className="cursor-pointer text-sm font-medium text-ink">Practice with scripted agents</summary>
        <p className="mt-2 mb-4 text-xs leading-5 text-ink-2">Run scripted agents to explore throughput and conflicts. Practice agents edit JavaScript functions on this trunk.</p>
        <SwarmControls trunk={trunk} swarms={room.swarms} serverNow={serverNow} />
      </details>
      {selected && <AgentDrawer trunk={trunk} name={selected} onClose={() => setSelected(null)} />}
      {issue !== null && (
        <IssueDrawer
          trunk={trunk}
          number={issue}
          onClose={() => setIssue(null)}
          onAgent={(name) => {
            setIssue(null);
            setSelected(name);
          }}
        />
      )}
    </main>
  );
}
