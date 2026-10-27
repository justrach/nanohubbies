"use client";
import {useTrunk} from "../context";
import { useEffect, useRef, useState } from "react";
import type { RulesetRestorePreview } from "@swarm/api/review";
import { api, ApiError, trunkPath } from "@/lib/api";
import { Button } from "@/components/controls";
import { Notice } from "./shared";

const labels = { name: "Name", target: "Target", enforcement: "Enforcement", conditions: "Target patterns", bypass_actors: "Bypass accounts", rules: "Restrictions" };
const show = (value: unknown) => value === undefined ? "None" : typeof value === "string" ? value : JSON.stringify(value, null, 2);

export function RulesetRestore({ trunk, rulesetId, eventId, onClose, onRestored }: {
  trunk: string; rulesetId: number; eventId: number; onClose: () => void; onRestored: () => void;
}) {
  const {readOnly}=useTrunk();
  const [preview, setPreview] = useState<RulesetRestorePreview | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [stale, setStale] = useState(false);
  const requestId = useRef(0), submitting = useRef(false), heading = useRef<HTMLHeadingElement>(null);
  const path = `${trunkPath(trunk)}/rulesets/${rulesetId}/restore`;
  async function compare() {
    const current = ++requestId.current;
    setBusy(true); setError(""); setPreview(null); setStale(false);
    try {
      const result = await api<RulesetRestorePreview>(`${path}?event=${eventId}`);
      if (requestId.current === current) setPreview(result);
    } catch (e) { if (requestId.current === current) setError((e as Error).message); }
    finally { if (requestId.current === current) setBusy(false); }
  }
  useEffect(() => {
    void compare();
    return () => { requestId.current++; };
    // The keyed parent remounts this comparison when the selected event changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trunk, rulesetId, eventId]);
  useEffect(() => { if (preview) heading.current?.focus(); }, [preview]);
  async function restore() {
    if (!preview || stale || submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    try {
      await api(path, { method: "POST", body: { eventId, revision: preview.revision } });
      onRestored();
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && e.status === 409) setStale(true);
    } finally { submitting.current = false; setBusy(false); }
  }
  // Compare just configuration, excluding the repository-local ID.
  const currentInput = preview?.current ? (({ id: _id, ...value }) => value)(preview.current) : null;
  const same = currentInput !== null && JSON.stringify(currentInput) === JSON.stringify(preview?.selected);
  const changes = preview ? (Object.keys(labels) as (keyof typeof labels)[]).filter(key =>
    !currentInput || JSON.stringify(currentInput[key]) !== JSON.stringify(preview.selected[key])) : [];
  return <section aria-label="Ruleset restoration comparison" className="space-y-3 border-t border-line pt-4">
    <h3 ref={heading} tabIndex={-1} className="text-sm font-semibold outline-none">Compare ruleset version from event #{eventId}</h3>
    <Notice error={error} />
    {busy && !preview && <p role="status" className="text-sm text-muted">Loading comparison…</p>}
    {preview && <>
      <p className="text-sm text-muted">{preview.current ? "Restoring replaces the current ruleset." : "This ruleset was deleted. Restoring creates a new ruleset with a new ID."} The selected enforcement mode and bypass accounts apply immediately.</p>
      <p className="text-xs text-muted">Selected version: {new Date(preview.recordedAt).toLocaleString()}</p>
      <dl className="divide-y divide-line">{changes.map(key => <div key={key} className="space-y-2 py-3">
        <dt className="text-sm font-semibold">{labels[key]}</dt>
        <dd className="grid min-w-0 gap-3 sm:grid-cols-2">
          <div className="min-w-0"><p className="mb-1 text-xs text-muted">Current</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-wash p-2 text-xs leading-5">{currentInput ? show(currentInput[key]) : "Deleted"}</pre></div>
          <div className="min-w-0"><p className="mb-1 text-xs text-muted">Selected</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-wash p-2 text-xs leading-5">{show(preview.selected[key])}</pre></div>
        </dd>
      </div>)}</dl>
      <details><summary className="cursor-pointer text-xs text-series-1">View complete configurations</summary><div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
        <div className="min-w-0"><h4 className="mb-2 text-xs font-semibold text-muted">Current configuration</h4><pre className="max-h-80 overflow-auto rounded border border-line bg-page p-3 font-mono text-xs leading-5">{currentInput ? JSON.stringify(currentInput, null, 2) : "Deleted"}</pre></div>
        <div className="min-w-0"><h4 className="mb-2 text-xs font-semibold text-muted">Selected version · {new Date(preview.recordedAt).toLocaleString()}</h4><pre className="max-h-80 overflow-auto rounded border border-line bg-page p-3 font-mono text-xs leading-5">{JSON.stringify(preview.selected, null, 2)}</pre></div>
      </div></details>
      {same && <p className="text-sm text-muted">This version matches the current configuration.</p>}
    </>}
    <div className="flex flex-wrap gap-2">
      {preview && <Button variant="primary" disabled={readOnly || busy || stale || same} onClick={() => void restore()}>{busy ? "Restoring…" : preview.current ? "Restore this version" : "Recreate this ruleset"}</Button>}
      <Button disabled={busy} onClick={() => void compare()}>{stale ? "Reload comparison" : "Refresh comparison"}</Button>
      <Button disabled={busy} onClick={onClose}>Cancel</Button>
    </div>
  </section>;
}
