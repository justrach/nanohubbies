import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { ago } from "@/lib/format";
import type { AgentRow } from "@/lib/room";
import { useReducedMotion, useSize } from "@/lib/useSize";

type Shown = "working" | "landed" | "replanning" | "rejected" | "quiet";
type Colors = Record<Shown, string>;

const LEGEND: { key: Shown; label: string; color: string }[] = [
  { key: "working", label: "Working", color: "var(--series-1)" },
  { key: "landed", label: "Just landed", color: "var(--good)" },
  { key: "replanning", label: "Re-planning after a conflict", color: "var(--warning)" },
  { key: "rejected", label: "Rejected", color: "var(--critical)" },
  { key: "quiet", label: "Quiet for 2 minutes", color: "var(--muted)" },
];

const QUIET_MS = 120_000;
const LANDED_FLASH_MS = 1200;
const TROUBLE_FLASH_MS = 2500;

/** What a cell shows right now. Scripted agents re-plan at once, so their
 *  outcomes flash briefly; a real agent's conflict or rejection stays lit until
 *  it starts its next life. */
function shown(a: AgentRow, serverNow: number, clientNow: number, reduced: boolean): Shown {
  if (serverNow - a.seen > QUIET_MS) return "quiet";
  const since = clientNow - a.changed;
  const persistent = a.kind === "agent";
  if (a.state === "reborn" && (persistent || (!reduced && since < TROUBLE_FLASH_MS))) return "replanning";
  if (a.state === "stillborn" && (persistent || (!reduced && since < TROUBLE_FLASH_MS))) return "rejected";
  if (a.state === "settled" && !reduced && since < LANDED_FLASH_MS) return "landed";
  return "working";
}

/** Every agent on the trunk as one cell, grouped by the person it works for.
 *  Each group is one canvas, so ten thousand agents cost a few draw calls per
 *  frame rather than ten thousand DOM nodes. */
export function AgentWall(props: { agents: Map<string, AgentRow>; tick: number; skew: number; table: boolean; onSelect: (name: string) => void }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const reduced = useReducedMotion();
  const [colors, setColors] = useState<Colors>(() => readColors());

  // Re-read the palette when the theme flips.
  useEffect(() => {
    const mo = new MutationObserver(() => setColors(readColors()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);

  // Regroup when agents join, and every few seconds in case an owner arrived late.
  const size = props.agents.size;
  const regroup = Math.floor(props.tick / 20);
  const groups = useMemo(() => {
    const by = new Map<string, string[]>();
    for (const a of props.agents.values()) {
      const g = by.get(a.owner ?? "");
      if (g) g.push(a.name);
      else by.set(a.owner ?? "", [a.name]);
    }
    for (const g of by.values()) g.sort();
    return [...by.entries()].sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
  }, [size, regroup]); // eslint-disable-line react-hooks/exhaustive-deps
  const { cell, gap, cols } = layout(
    groups.map(([, names]) => names.length),
    width,
  );

  const counts = useMemo(() => {
    const out: Record<Shown, number> = { working: 0, landed: 0, replanning: 0, rejected: 0, quiet: 0 };
    const landed = new Map<string, number>();
    const clientNow = Date.now();
    for (const a of props.agents.values()) {
      out[shown(a, clientNow + props.skew, clientNow, reduced)]++;
      landed.set(a.owner ?? "", (landed.get(a.owner ?? "") ?? 0) + a.landed);
    }
    return { out, landed };
  }, [props.tick, props.agents, props.skew, reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  if (props.table) {
    const busiest = [...props.agents.values()].sort((a, b) => b.landed - a.landed).slice(0, 25);
    return (
      <div className="max-h-[320px] overflow-auto">
        <table className="tabular w-full text-xs">
          <thead className="text-muted">
            <tr>
              <th className="py-1 text-left font-normal">Agent</th>
              <th className="py-1 text-left font-normal">Works for</th>
              <th className="py-1 text-right font-normal">Landed</th>
              <th className="py-1 text-right font-normal">Conflicts</th>
              <th className="py-1 text-right font-normal">Lives</th>
            </tr>
          </thead>
          <tbody className="text-ink-2">
            {busiest.map((a) => (
              <tr key={a.name} className="border-t border-line">
                <td className="py-1">
                  <button type="button" className="hover:text-ink hover:underline" onClick={() => props.onSelect(a.name)}>
                    {a.name}
                  </button>
                </td>
                <td className="py-1">{a.owner ?? ""}</td>
                <td className="py-1 text-right text-ink">{a.landed}</td>
                <td className="py-1 text-right">{a.conflicts}</td>
                <td className="py-1 text-right">{a.life}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div>
      <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
        {LEGEND.map((l) => (
          <li key={l.key} className="flex items-center gap-1.5 text-ink-2">
            <span className="inline-block size-2.5 rounded-[2px]" style={{ background: l.color }} aria-hidden />
            {l.label} <span className="tabular font-semibold text-ink">{counts.out[l.key].toLocaleString("en-US")}</span>
          </li>
        ))}
      </ul>
      <div ref={ref} className="space-y-3">
        {groups.length === 0 && <p className="py-8 text-center text-xs text-muted">No agents yet. Launch a swarm or start a life from the API.</p>}
        {groups.map(([owner, names]) => (
          <div key={owner}>
            {(groups.length > 1 || owner) && (
              <p className="mb-1.5 flex items-center gap-2 text-xs">
                <Avatar name={owner || "?"} size={18} />
                <span className="font-medium text-ink">{owner || "Unattributed"}</span>
                <span className="tabular text-muted">
                  {names.length.toLocaleString("en-US")} agents, {(counts.landed.get(owner) ?? 0).toLocaleString("en-US")} landed
                </span>
              </p>
            )}
            <WallCanvas names={names} agents={props.agents} cols={cols} cell={cell} gap={gap} width={width} colors={colors} skew={props.skew} reduced={reduced} onSelect={props.onSelect} />
          </div>
        ))}
      </div>
    </div>
  );
}

function WallCanvas(p: {
  names: string[];
  agents: Map<string, AgentRow>;
  cols: number;
  cell: number;
  gap: number;
  width: number;
  colors: Colors;
  skew: number;
  reduced: boolean;
  onSelect: (name: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [hover, setHover] = useState<{ agent: AgentRow; x: number; y: number } | null>(null);
  const { names, cols, cell, gap, width } = p;
  const height = cols ? Math.max(cell, Math.ceil(names.length / cols) * (cell + gap) - gap) : 0;

  // Redraw at ~8 fps: enough for flashes to read, cheap for big swarms.
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - last < 120) return;
      last = t;
      const c = canvas.current;
      if (!c || !cols) return;
      const dpr = window.devicePixelRatio || 1;
      if (c.width !== Math.round(width * dpr) || c.height !== Math.round(height * dpr)) {
        c.width = Math.round(width * dpr);
        c.height = Math.round(height * dpr);
      }
      const ctx = c.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const clientNow = Date.now();
      const serverNow = clientNow + p.skew;
      for (let i = 0; i < names.length; i++) {
        const a = p.agents.get(names[i]);
        if (!a) continue;
        const s = shown(a, serverNow, clientNow, p.reduced);
        ctx.globalAlpha = s === "quiet" ? 0.45 : s === "working" ? 0.8 : 1;
        ctx.fillStyle = p.colors[s];
        ctx.fillRect((i % cols) * (cell + gap), Math.floor(i / cols) * (cell + gap), cell, cell);
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [names, cols, cell, gap, width, height, p.colors, p.agents, p.skew, p.reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const col = Math.floor((e.clientX - box.left) / (cell + gap));
    const row = Math.floor((e.clientY - box.top) / (cell + gap));
    const i = row * cols + col;
    const agent = col < cols && i >= 0 && i < names.length ? p.agents.get(names[i]) : undefined;
    setHover(agent ? { agent, x: e.clientX - box.left, y: e.clientY - box.top } : null);
  };

  return (
    <div className="relative">
      <canvas
        ref={canvas}
        style={{ width, height }}
        className="block cursor-pointer"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onClick={() => hover && p.onSelect(hover.agent.name)}
        role="img"
        aria-label={`${names.length} agents; switch to the table view for details`}
      />
      {hover && (
        <div
          className="pointer-events-none absolute z-10 w-56 rounded-md border border-line bg-surface px-2.5 py-2 text-xs shadow-lg"
          style={{ left: Math.min(hover.x + 12, Math.max(0, width - 230)), top: hover.y + 14 }}
        >
          <p className="font-semibold text-ink">{hover.agent.name}</p>
          <p className="text-ink-2">
            {hover.agent.kind === "scripted" ? "Scripted" : "Agent"}
            {hover.agent.owner ? ` for ${hover.agent.owner}` : ""}, life {hover.agent.life}, seen {ago(Date.now() + p.skew - hover.agent.seen)}
          </p>
          <p className="tabular mt-1 text-ink-2">
            <span className="font-semibold text-ink">{hover.agent.landed}</span> landed · <span className="font-semibold text-ink">{hover.agent.conflicts}</span> conflicts
            {hover.agent.issue != null && <span> · on #{hover.agent.issue}</span>}
          </p>
          {hover.agent.intent && <p className="mt-1 truncate text-muted">{hover.agent.intent}</p>}
        </div>
      )}
    </div>
  );
}

const STEPS = [
  [14, 3],
  [10, 2],
  [7, 2],
  [5, 1],
  [4, 1],
  [3, 1],
] as const;

/** The biggest cell that keeps the whole wall, every group together, under ~320px tall. */
function layout(sizes: number[], width: number) {
  if (!sizes.length || !width) return { cell: 0, gap: 0, cols: 0 };
  for (const [cell, gap] of STEPS) {
    const cols = Math.max(1, Math.floor((width + gap) / (cell + gap)));
    const rows = sizes.reduce((sum, n) => sum + Math.ceil(n / cols), 0);
    if (rows * (cell + gap) <= 320 || cell === 3) return { cell, gap, cols };
  }
  return { cell: 3, gap: 1, cols: 1 };
}

function readColors(): Colors {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return { working: v("--series-1"), landed: v("--good"), replanning: v("--warning"), rejected: v("--critical"), quiet: v("--muted") };
}
