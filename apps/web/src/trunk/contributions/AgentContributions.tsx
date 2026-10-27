"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bot, GitBranch } from "lucide-react";
import type { ContributionPage, ContributionEvent, WorkLink } from "@swarm/api/review";
import { api, trunkPath } from "@/lib/api";
import { Button } from "@/components/controls";
import { trunkHref } from "../paths";

/** Persistent work history is separate from the room's transient presence. */
export function AgentContributions({ trunk, compact = false, pull, commit }: { trunk: string; compact?: boolean; pull?: number; commit?: string }) {
  const [page, setPage] = useState<ContributionPage | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const epoch = useRef(0);
  const query = new URLSearchParams({ limit: compact ? "1" : "15" });
  if (pull) query.set("pull", String(pull));
  if (commit) query.set("commit", commit);
  const url = `${trunkPath(trunk)}/contributions?${query}`;
  async function load(before?: number) {
    const ticket = ++epoch.current;
    setBusy(true); setError("");
    try {
      const result = await api<ContributionPage>(url + (before ? `&before=${before}` : ""));
      if (ticket !== epoch.current) return;
      setPage(previous => before && previous ? { ...result, events: [...previous.events, ...result.events.filter(event => !previous.events.some(old => old.seq === event.seq))] } : result);
    } catch (failure) {
      if (ticket !== epoch.current) return;
      setPage(null); setError(failure instanceof Error ? failure.message : "Could not load agent activity.");
    } finally { if (ticket === epoch.current) setBusy(false); }
  }
  useEffect(() => { setPage(null); void load(); return () => { epoch.current++; }; }, [url]); // eslint-disable-line react-hooks/exhaustive-deps
  const heading = pull ? "Agents on this pull request" : "Agents who worked here";
  if (compact) return <section className="border-t border-line pt-5" aria-label="Agent contributors">
    <h2 className="mb-3 font-semibold text-ink">{heading}</h2>
    {page && page.agentCount > 0 ? <>
      <ul className="space-y-3">{page.agents.slice(0, 4).map(({ agent, sessions, pushes }) => <li key={agent.id} className="flex min-w-0 items-start gap-2">
        <Bot size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />
        <div className="min-w-0"><p className="break-words font-medium text-ink">@{agent.handle}</p><p className="break-words text-xs leading-5 text-muted">{agent.type} · {agent.owner.name}</p><p className="text-xs leading-5 text-muted">{counts(sessions, pushes)}</p></div>
      </li>)}</ul>
      <Link href={trunkHref(trunk, "/room#contributions")} className="mt-3 inline-block text-xs text-series-1 underline underline-offset-2">View activity{page.agentCount > 4 ? ` · ${page.agentCount} agents` : ""}</Link>
    </> : <p className="text-xs leading-5 text-muted" role="status">{busy ? "Loading agent activity…" : error ? "Agent activity is unavailable." : "No recorded agent work yet."}</p>}
    {error && <Button size="sm" className="mt-2" disabled={busy} onClick={() => void load()}>Retry activity</Button>}
  </section>;
  return <section id={pull ? undefined : "contributions"} className="min-w-0 scroll-mt-6 border-t border-line pt-5" aria-label={heading}>
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold text-ink">{heading}</h2><Button size="sm" disabled={busy} onClick={() => void load()}>{busy ? "Loading…" : "Refresh activity"}</Button></div>
    <p className="mt-2 max-w-[72ch] text-sm leading-6 text-muted">{pull ? "Activity linked to this pull request or its current head. " : "Work recorded by registered agents, with their credential-bound owner. "}Git updates are recorded by Nanohub; work summaries and client/model labels are reported by the agent.</p>
    {error && <p role="alert" className="mt-3 break-words text-sm text-critical">Agent activity could not load: {error} Use Refresh activity to retry.</p>}
    {page && !page.events.length && <p className="mt-4 text-sm text-muted">{pull ? "No agent activity is linked here yet." : <>No recorded work yet. <Link href={trunkHref(trunk, "/connect")} className="text-series-1 underline underline-offset-2">Connect an agent with MCP</Link> to start a work record. Human Git workflows work as usual.</>}</p>}
    {!!page?.events.length && <>
      <p className="mt-4 text-xs text-muted">{page.agentCount} registered {page.agentCount === 1 ? "agent" : "agents"} in this activity</p>
      <ol className="mt-2 divide-y divide-line">{page.events.map(event => <Activity key={event.seq} event={event} trunk={trunk} />)}</ol>
      {page.nextCursor && <Button className="mt-4" disabled={busy} onClick={() => void load(page.nextCursor!)}>Load earlier activity</Button>}
    </>}
  </section>;
}

function counts(sessions: number, pushes: number) { return [sessions ? `${sessions} work ${sessions === 1 ? "session" : "sessions"}` : "", pushes ? `${pushes} Git ref ${pushes === 1 ? "update" : "updates"}` : ""].filter(Boolean).join(" · "); }
function Activity({ event, trunk }: { event: ContributionEvent; trunk: string }) {
  const push = event.kind === "git_push";
  return <li className="min-w-0 py-4">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted"><span className="flex min-w-0 items-center gap-1.5 font-medium text-ink">{push ? <GitBranch size={14} aria-hidden /> : <Bot size={14} aria-hidden />}<span className="break-all">@{event.agent.handle}</span></span><span className="break-words">{event.agent.type} · owned by {event.agent.owner.name}</span><time dateTime={new Date(event.at).toISOString()}>{new Date(event.at).toLocaleString()}</time></div>
    {event.kind === "git_push" ? <>
      <p className="mt-2 break-words text-sm text-ink">{!event.next ? "Deleted" : !event.old ? "Created" : "Updated"} <code className="break-all text-xs">{event.ref}</code></p>
      <p className="mt-1 text-xs text-muted">Git update recorded by Nanohub</p>
    </> : <>
      <p className="mt-2 break-words text-sm font-medium text-ink">{event.title}</p>
      <p className="mt-1 text-xs text-muted">{event.kind === "work_started" ? "Work started" : event.state === "completed" ? "Work completed" : event.state === "blocked" ? "Work blocked" : "Progress update"} · reported by agent</p>
      {event.summary && <p className="mt-2 max-w-[72ch] whitespace-pre-wrap break-words text-sm leading-6 text-ink-2">{event.summary}</p>}
      {event.client && <p className="mt-2 break-words text-xs text-muted">Reported client: {event.client.name}{event.client.version ? ` ${event.client.version}` : ""}{event.client.model ? ` · model: ${event.client.model}` : ""}</p>}
    </>}
    {!!event.links.length && <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">{event.links.map(link => <li key={link.kind === "commit" ? link.sha : link.number}><Artifact link={link} trunk={trunk} /></li>)}</ul>}
  </li>;
}
function Artifact({ link, trunk }: { link: WorkLink; trunk: string }) {
  if (link.kind === "commit") return <code className="break-all text-muted" title={link.sha}>Commit {link.sha.slice(0, 10)}</code>;
  return <Link className="text-series-1 underline underline-offset-2" href={trunkHref(trunk, `/pulls/${link.number}`)}>Pull request #{link.number}</Link>;
}
