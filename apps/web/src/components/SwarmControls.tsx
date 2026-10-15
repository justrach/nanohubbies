import { Play, Square } from "lucide-react";
import { useState } from "react";
import { Avatar } from "@/components/Avatar";
import { Button, Input } from "@/components/controls";
import { api, trunkPath } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { SwarmState } from "@/lib/types";

/** Launches your scripted agents on this trunk: practice load that edits
 *  JavaScript functions. Everyone runs their own swarm, at the same time if
 *  they like. Swarms run inside Durable Objects, not in this browser, so
 *  closing the tab does not stop them. */
export function SwarmControls({ trunk, swarms, serverNow }: { trunk: string; swarms: SwarmState[]; serverNow: number }) {
  const { user } = useSession();
  const [agents, setAgents] = useState(500);
  const [seconds, setSeconds] = useState(60);
  const [shared, setShared] = useState(15);
  const [think, setThink] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = swarms.filter((s) => s.running);
  const mine = running.find((s) => s.owner.id === (user?.id ?? "guest")) ?? null;
  const left = (s: SwarmState) => Math.max(0, Math.round((s.until - serverNow) / 1000));
  // While your swarm runs, the fields show its settings, not the next run's.
  const shown = mine ? { agents: mine.agents, seconds: Math.round((mine.until - mine.started) / 1000), shared: Math.round(mine.shared * 100) } : { agents, seconds, shared };

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const launch = () =>
    run(() => api(`${trunkPath(trunk)}/swarm`, { body: { agents, seconds, shared: shared / 100, skew: 1.1, think: [think * 500, think * 1500] } }));
  const stop = (all: boolean) => run(() => api(`${trunkPath(trunk)}/swarm${all ? "?all=1" : ""}`, { method: "DELETE" }));

  return (
    <div className="border-y border-line py-4">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <Field label="Scripted agents" value={shown.agents} min={1} max={20000} step={1} onChange={setAgents} disabled={!!mine} />
        <Field label="Seconds" value={shown.seconds} min={5} max={3600} step={5} onChange={setSeconds} disabled={!!mine} />
        <Field label="Edits to shared code, %" value={shown.shared} min={0} max={100} step={1} onChange={setShared} disabled={!!mine} />
        <Field label="Think time, s" value={think} min={0.1} max={60} step={0.1} onChange={setThink} disabled={!!mine} />
        <div className="flex items-center gap-3">
          {mine ? (
            <Button onClick={() => stop(false)} disabled={busy} size="sm">
              <Square size={12} aria-hidden /> Stop mine
            </Button>
          ) : (
            <Button onClick={launch} disabled={busy} size="sm" variant="primary">
              <Play size={12} aria-hidden /> Launch as {user?.name ?? "guest"}
            </Button>
          )}
          <p className="text-xs text-muted">
            {mine
              ? `${mine.agents.toLocaleString("en-US")} of your agents running, ${left(mine)}s left`
              : `About ${Math.round(agents / think).toLocaleString("en-US")} attempts a second at this think time`}
          </p>
        </div>
      </div>
      {running.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-2.5 text-xs">
          <span className="text-muted">Running now</span>
          {running.map((s) => (
            <span key={s.owner.id} className="flex items-center gap-1.5 text-ink-2">
              <Avatar name={s.owner.name} size={18} />
              <span className="font-medium text-ink">{s.owner.name}</span>
              <span className="tabular">
                {s.agents.toLocaleString("en-US")} agents, {left(s)}s left
              </span>
            </span>
          ))}
          {running.length > 1 && (
            <Button onClick={() => stop(true)} disabled={busy} size="sm" className="ml-auto">
              Stop all
            </Button>
          )}
        </div>
      )}
      {error && (
        <p className="mt-2 text-xs text-critical">
          {/no JavaScript functions/.test(error)
            ? "Scripted agents are practice load: they only edit JavaScript functions, and this trunk has none. Your own agents can work on it in any language: see Bring your own agents above."
            : error}
        </p>
      )}
    </div>
  );
}

function Field(props: { label: string; value: number; min: number; max: number; step: number; disabled: boolean; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-ink-2">
      {props.label}
      <Input
        type="number"
        value={props.value}
        min={props.min}
        max={props.max}
        step={props.step}
        disabled={props.disabled}
        onChange={(e) => props.onChange(Math.min(props.max, Math.max(props.min, Number(e.target.value) || props.min)))}
        className="tabular w-28 text-xs"
      />
    </label>
  );
}
