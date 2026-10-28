"use client";
import { useEffect, useRef, useState } from "react";
import { History } from "lucide-react";
import type { ActivityKind, RepositoryActivity, RepositoryEvent } from "@swarm/api/review";
import { api, trunkPath } from "@/lib/api";
import { Button } from "@/components/controls";
import { Card } from "@/components/ui";
import { field, Notice } from "./shared";
import { RulesetRestore } from "./RulesetRestore";

function title(event: RepositoryEvent) {
  if(event.runnerRegistration)return `${event.runnerRegistration.revoked?'Revoked':'Registered'} runner “${event.runnerRegistration.name}”`;
  if(event.defaultBranch)return `Default branch changed from ${event.defaultBranch.previous} to ${event.defaultBranch.next}`;
  if(event.mergeSettings)return `Merge methods changed to ${event.mergeSettings.next.allowedMethods.join(', ')}; default ${event.mergeSettings.next.defaultMethod}`;
  if(event.archive)return `${event.archive.archived?"Archived":"Unarchived"} repository · revision ${event.archive.revision}`;
  if(event.deploymentReview)return `${event.deploymentReview.decision==="approve"?"Approved":"Rejected"} deployment to “${event.deploymentReview.environment}”`;
  if(event.deploymentAuthorization)return `Authorized deployment to “${event.deploymentAuthorization.environment}”`;
  if(event.deploymentRequest)return `Requested deployment to “${event.deploymentRequest.environment}”`;
  if(event.removedEnvironment)return `Deleted deployment environment “${event.previousEnvironment?.name??event.removedEnvironment}”`;
  if(event.environment)return `${event.previousEnvironment?"Updated":"Created"} deployment environment “${event.environment.name}”`;
  if (event.dismissal) return `${event.dismissal.automatic?"Automatically dismissed":"Dismissed"} review #${event.dismissal.review} on pull request #${event.dismissal.pull}`;
  if (event.restoredFrom && event.ruleset) return `Restored ruleset “${event.ruleset.name}” from event #${event.restoredFrom.eventId}`;
  if (event.removedRuleset) return `Deleted ruleset “${event.previousRuleset?.name ?? `#${event.removedRuleset}`}”`;
  if (event.ruleset) return `${event.previousRuleset === null ? "Created" : event.previousRuleset ? "Updated" : "Saved"} ruleset “${event.ruleset.name}”`;
  if (event.removedPolicy) return `Deleted protection for ${event.removedPolicy}`;
  if (event.policy) return `${event.previousPolicy === null ? "Created" : event.previousPolicy ? "Updated" : "Saved"} protection for ${event.policy.branch}`;
  if(event.force&&event.ref)return `Force pushed ${event.ref}${event.bypassedRulesets?.length?` · bypassed rulesets ${event.bypassedRulesets.map(id=>`#${id}`).join(", ")}`:""}`;
  if (event.bypassedRulesets?.length) return `Bypassed rulesets ${event.bypassedRulesets.map(id => `#${id}`).join(", ")}`;
  if (event.ref) return `${event.merge ? "Merged" : !event.next ? "Deleted" : !event.old ? "Created" : "Updated"} ${event.ref}`;
  if (event.stagingApproval) return "Approved a staging candidate";
  if (event.retry) return "Retried an Actions candidate";
  return "Repository activity";
}

export function ProtectionActivity({ trunk, onRestored }: { trunk: string; onRestored: () => void }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [data, setData] = useState<RepositoryActivity>({ events: [], nextCursor: null });
  const [filter, setFilter] = useState({ kind: "all" as ActivityKind, ref: "", ruleset: "" });
  const requestId = useRef(0);
  const [selected, setSelected] = useState<number | null>(null), [notice, setNotice] = useState("");
  const trigger = useRef<HTMLButtonElement | null>(null);
  const noticeRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => { if (notice) noticeRef.current?.focus(); }, [notice]);
  useEffect(() => () => { requestId.current++; }, []);
  const closeComparison = () => { setSelected(null); trigger.current?.focus(); };
  async function load(next = false, values = filter) {
    const current = ++requestId.current;
    setBusy(true); setError("");
    if (!next) setData({ events: [], nextCursor: null });
    const params = new URLSearchParams({ kind: values.kind, limit: "25" });
    if (values.ref) params.set("ref", values.ref);
    if (values.ruleset) params.set("ruleset", values.ruleset);
    if (next && data.nextCursor) params.set("before", String(data.nextCursor));
    try {
      const page = await api<RepositoryActivity>(`${trunkPath(trunk)}/repository/audit?${params}`);
      if (current === requestId.current) setData(old => ({ ...page, events: next ? [...old.events, ...page.events] : page.events }));
    } catch (e) { if (current === requestId.current) setError((e as Error).message); }
    finally { if (current === requestId.current) setBusy(false); }
  }
  return <Card className="repository-protections">
    <header><div><h2><History size={16} aria-hidden />Protection activity</h2><p>Rule changes, review dismissals, accepted ref updates and explicit bypasses. Visible to repository admins.</p></div>
      <Button disabled={busy} onClick={() => { if (!open) void load(); setOpen(!open); }}>{open ? "Hide activity" : "View activity"}</Button></header>
    {open && <div className="space-y-4 p-4">
      <form className="flex flex-wrap items-end gap-3" onSubmit={e => {
        e.preventDefault(); const form = new FormData(e.currentTarget);
        const values = { kind: String(form.get("kind")) as ActivityKind, ref: String(form.get("ref") ?? "").trim(), ruleset: String(form.get("ruleset") ?? "").trim() };
        setFilter(values); setSelected(null); void load(false, values);
      }}>
        <label className="space-y-1 text-xs text-muted">Activity<select className={field} name="kind" defaultValue="all">
          <option value="all">All activity</option><option value="rulesets">Ruleset changes</option><option value="protections">Branch protections</option>
          <option value="refs">Accepted ref updates</option><option value="bypasses">Ruleset bypasses</option><option value="ci">Actions approvals and retries</option>
          <option value="reviews">Review dismissals</option><option value="environments">Deployment environments</option><option value="archive">Repository archive</option><option value="settings">Repository settings</option>
        </select></label>
        <label className="min-w-44 flex-1 space-y-1 text-xs text-muted">Exact ref<input className={field} name="ref" maxLength={150} placeholder="refs/heads/main" /></label>
        <label className="w-28 space-y-1 text-xs text-muted">Ruleset ID<input className={field} name="ruleset" type="number" min={1} step={1} placeholder="Any" /></label>
        <Button type="submit" disabled={busy}>Apply filters</Button>
        <Button disabled={busy} onClick={() => void load()}>Refresh</Button>
      </form>
      <Notice error={error} />
      {notice && <p ref={noticeRef} role="status" tabIndex={-1} className="text-sm outline-none">{notice}</p>}
      <p className="text-xs text-muted" aria-live="polite">{busy ? "Loading activity…" : `${data.events.length} event${data.events.length === 1 ? "" : "s"} loaded.`} Rejected pushes are not recorded in this history.</p>
      <ol className="divide-y divide-line">{data.events.map(event => <li key={event.id} className="space-y-2 py-4">
        <div className="flex flex-wrap justify-between gap-2 text-sm"><strong className="break-words">{title(event)}</strong><time className="text-xs text-muted" dateTime={new Date(event.at).toISOString()}>{new Date(event.at).toLocaleString()}</time></div>
        <p className="break-all text-xs text-muted"><code>{event.actor}</code> · event #{event.id}{event.via?.kind==="cli"?" · via CLI":""}{event.bypassRole?` · current role: ${event.bypassRole.role}`:""}{event.ref ? ` · ${event.ref}` : ""}{event.ref ? event.human ? " · signed-in human" : " · credential" : ""}</p>
        {event.ref && <p className="break-all font-mono text-xs text-muted">{event.old?.slice(0, 12) ?? "new ref"} → {event.next?.slice(0, 12) ?? "deleted"}</p>}
        {event.dismissal && <div className="space-y-1 text-sm"><a className="text-series-1 underline underline-offset-2" href={`/t/${trunk}/pulls/${event.dismissal.pull}#review-${event.dismissal.review}`}>View dismissed review</a><p className="whitespace-pre-wrap break-words text-muted">{event.dismissal.reason}</p></div>}
        <details><summary className="cursor-pointer text-xs text-series-1">View recorded details</summary><pre className="mt-2 max-h-96 overflow-auto rounded border border-line bg-page p-3 font-mono text-xs leading-5">{JSON.stringify(event, null, 2)}</pre></details>
        {(event.ruleset || event.removedRuleset && event.previousRuleset) && <div className="flex flex-wrap items-center gap-3"><Button onClick={e => { trigger.current = e.currentTarget; setNotice(""); setSelected(event.id); }}>Compare and restore</Button><a className="text-xs text-series-1 underline underline-offset-2" href={`${trunkPath(trunk)}/rulesets/${(event.ruleset??event.previousRuleset)!.id}/export?event=${event.id}`} download>Download version JSON</a></div>}
        {selected === event.id && <RulesetRestore key={`${trunk}:${event.id}`} trunk={trunk} rulesetId={(event.ruleset ?? event.previousRuleset)!.id} eventId={event.id}
          onClose={closeComparison} onRestored={() => { closeComparison(); setNotice("Ruleset restored. The selected configuration is now saved."); void load(); onRestored(); }} />}
      </li>)}</ol>
      {!busy && !data.events.length && !error && <p className="py-4 text-sm text-muted">No matching activity.</p>}
      {data.nextCursor && <Button disabled={busy} onClick={() => void load(true)}>Load older activity</Button>}
    </div>}
  </Card>;
}
