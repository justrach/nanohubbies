import { CircleCheck, CirclePause, CircleX, Loader, RotateCcw, X, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { api, trunkPath } from "@/lib/api";
import { ago } from "@/lib/format";

interface Info {
  agent: string | null;
  kind: string | null;
  owner: { id: string; name: string } | null;
  life: number;
  lives: { life: number; base: number; change: string | null; outcome: string | null; version: number | null; at: number }[];
}

const OUTCOME: Record<string, { label: string; color: string; Icon: LucideIcon }> = {
  settled: { label: "Landed", color: "var(--good)", Icon: CircleCheck },
  reborn: { label: "Conflicted, re-planned", color: "var(--warning)", Icon: RotateCcw },
  unpaid: { label: "Abandoned", color: "var(--serious)", Icon: CirclePause },
  stillborn: { label: "Rejected", color: "var(--critical)", Icon: CircleX },
};

/** One agent's recent lives and how each ended. */
export function AgentDrawer({ trunk, name, onClose }: { trunk: string; name: string; onClose: () => void }) {
  const [info, setInfo] = useState<Info | null>(null);
  useEffect(() => {
    setInfo(null);
    api<Info>(`${trunkPath(trunk)}/agents/${encodeURIComponent(name)}`).then(setInfo, () => {});
  }, [trunk, name]);

  return (
    <aside className="fixed inset-y-0 right-0 z-30 w-[360px] max-w-full overflow-auto border-l border-line bg-surface p-5 shadow-2xl" aria-label={`Agent ${name}`}>
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold text-ink">{name}</h2>
          <p className="text-xs text-muted">
            {info ? `${info.kind === "scripted" ? "Scripted agent" : "Agent"}${info.owner ? ` for ${info.owner.name}` : ""}, ${info.life} lives` : "Loading"}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="grid size-7 place-items-center rounded-full text-ink-2 hover:bg-wash">
          <X size={15} />
        </button>
      </div>
      <h3 className="mt-5 text-xs font-semibold text-ink-2">Recent lives</h3>
      <ol className="mt-2 divide-y divide-line">
        {info?.lives.map((l) => {
          const o = l.outcome ? OUTCOME[l.outcome] : { label: "Working", color: "var(--series-1)", Icon: Loader };
          return (
            <li key={l.life} className="flex items-start gap-2 py-2 text-xs">
              <o.Icon size={14} strokeWidth={2.25} style={{ color: o.color }} className="mt-px shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-ink">
                  Life {l.life}: {o.label}
                  {l.version ? <span className="tabular text-muted"> as v{l.version}</span> : null}
                </p>
                <p className="tabular text-muted">
                  planned on v{l.base}, {ago(Date.now() - l.at)}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
