import { CircleCheck, CircleCheckBig, CircleDot, CircleX, Hand, LoaderCircle, MessageSquare, Play, RotateCcw, Square, Sprout, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { clock } from "@/lib/format";
import { Link } from "@/lib/router";
import type { Owner, Sequenced } from "@/lib/types";

/** Every outcome as it happens, newest first. Hovering freezes the list so a
 *  fast swarm can still be read. A landed version links to its commit. */
export function ChangeFeed({ trunk, feed, onSelect, onIssue }: { trunk: string; feed: Sequenced[]; onSelect: (agent: string) => void; onIssue: (n: number) => void }) {
  const [frozen, setFrozen] = useState<Sequenced[] | null>(null);
  const items = (frozen ?? feed).slice(-120).reverse();
  return (
    <div className="relative max-h-[430px] overflow-auto" onPointerEnter={() => setFrozen(feed.slice())} onPointerLeave={() => setFrozen(null)}>
      {frozen && <p className="sticky top-0 z-10 bg-surface pb-1 text-[11px] text-muted">Paused while you read</p>}
      {items.length === 0 && <p className="py-8 text-center text-xs text-muted">Nothing has happened on this trunk yet.</p>}
      <ol className="divide-y divide-line">
        {items.map((e) => (
          <Row key={e.seq} trunk={trunk} e={e} onSelect={onSelect} onIssue={onIssue} />
        ))}
      </ol>
    </div>
  );
}

function Row({ trunk, e, onSelect, onIssue }: { trunk: string; e: Sequenced; onSelect: (agent: string) => void; onIssue: (n: number) => void }) {
  const agent = (name: string) => (
    <button type="button" onClick={() => onSelect(name)} className="font-medium text-ink hover:underline">
      {name}
    </button>
  );
  // Scripted agents carry their owner's name already; a real agent's owner is spelled out.
  const forWhom = (kind: string, owner: Owner | null) => (kind === "agent" && owner ? <span className="text-muted"> for {owner.name}</span> : null);
  const issue = (n: number) => (
    <button type="button" onClick={() => onIssue(n)} className="tabular font-medium text-ink hover:underline">
      #{n}
    </button>
  );
  let icon: [LucideIcon, string];
  let body: React.ReactNode;
  switch (e.t) {
    case "landed":
      icon = [CircleCheck, "var(--good)"];
      body = (
        <>
          <Link to={`/t/${trunk}/commit/${e.version}`} className="tabular text-muted hover:text-ink hover:underline">
            v{e.version}
          </Link>{" "}
          {agent(e.agent)}
          {forWhom(e.kind, e.owner)} <span className="text-ink-2">{e.intent}</span>
          {e.closes && e.issue != null && <span className="ml-1.5 rounded border border-line px-1 text-[10px] text-ink-2">closes #{e.issue}</span>}
          {e.revalidate.length > 0 && <span className="ml-1.5 rounded border border-line px-1 text-[10px] text-ink-2">re-verify</span>}
        </>
      );
      break;
    case "conflict": {
      const w = e.winners[0];
      icon = [RotateCcw, "var(--warning)"];
      body = (
        <>
          {agent(e.agent)}
          {forWhom(e.kind, e.owner)} <span className="text-ink-2">conflicts on</span> <code className="text-[11px] text-ink-2">{e.keys[0]}</code>
          {w && (
            <span className="text-ink-2">
              {" "}
              {w.change ? "with" : "held by"} {agent(w.agent)}
              {w.version ? <span className="tabular text-muted"> v{w.version}</span> : null}
            </span>
          )}
          <span className="text-muted">, re-planning</span>
          {e.leased?.length ? <span className="ml-1.5 rounded border border-line px-1 text-[10px] text-ink-2">now held for it</span> : null}
        </>
      );
      break;
    }
    case "rejected":
      icon = [CircleX, "var(--critical)"];
      body = (
        <>
          {agent(e.agent)}
          {forWhom(e.kind, e.owner)} <span className="text-ink-2">rejected: {e.error}</span>
        </>
      );
      break;
    case "message":
      icon = [MessageSquare, "var(--muted)"];
      body = (
        <>
          <span className="font-medium text-ink">{e.from}</span> <span className="text-ink-2">{e.body}</span>
        </>
      );
      break;
    case "swarm":
      icon = e.state === "running" ? [Play, "var(--muted)"] : [Square, "var(--muted)"];
      body = (
        <span className="text-ink-2">
          {e.owner ? <span className="font-medium text-ink">{e.owner.name}</span> : "Someone"}{" "}
          {e.state === "running" ? `started ${e.agents.toLocaleString("en-US")} scripted agents` : `stopped ${e.agents.toLocaleString("en-US")} scripted agents`}
        </span>
      );
      break;
    case "issue":
      if (e.heldBy) {
        icon = [Hand, "var(--muted)"];
        body = (
          <span className="text-ink-2">
            {agent(e.heldBy)} <span className="text-muted">took</span> {issue(e.number)} {e.title}
            <span className="text-muted">; scripted agents leave it alone</span>
          </span>
        );
        break;
      }
      icon = e.state === "closed" ? [CircleCheckBig, "var(--good)"] : e.state === "progress" ? [LoaderCircle, "var(--series-1)"] : [CircleDot, "var(--muted)"];
      body = (
        <span className="text-ink-2">
          {issue(e.number)} {e.title}{" "}
          <span className="text-muted">
            {e.state === "closed" ? `closed by ${e.by ?? "someone"}${e.version ? ` in v${e.version}` : ""}` : e.state === "progress" ? "in progress" : `opened by ${e.by ?? "someone"}`}
          </span>
        </span>
      );
      break;
    case "life":
      icon = [Sprout, "var(--muted)"];
      body = (
        <>
          {agent(e.agent)}
          {forWhom(e.kind, e.owner)} <span className="text-ink-2">started life {e.life}</span> <span className="tabular text-muted">on v{e.base}</span>
        </>
      );
      break;
    default:
      return null;
  }
  const [Icon, color] = icon;
  return (
    <li className="flex items-start gap-2 py-1.5 text-xs">
      <Icon size={14} strokeWidth={2.25} style={{ color }} className="mt-px shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 truncate">{body}</p>
      <time className="tabular shrink-0 text-[11px] text-muted">{clock(e.at)}</time>
    </li>
  );
}
