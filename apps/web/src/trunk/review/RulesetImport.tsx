"use client";
import { useEffect, useRef, useState } from "react";
import type { ReviewSnapshot, RulesetImportPreview } from "@swarm/api/review";
import { api, trunkPath } from "@/lib/api";
import { Button } from "@/components/controls";
import { field, Notice } from "./shared";
type Ruleset = NonNullable<ReviewSnapshot["rulesets"]>[number];
const maxBytes = 120 * 1024;

export function RulesetImport({ trunk, onCancel, onImported }: {
  trunk: string; onCancel: () => void; onImported: (rule: Ruleset) => void;
}) {
  const [text, setText] = useState(""), [preview, setPreview] = useState<RulesetImportPreview | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [creating, setCreating] = useState(false);
  const requestId = useRef(0), pending = useRef(false), heading = useRef<HTMLHeadingElement>(null), fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => () => { requestId.current++; }, []);
  useEffect(() => { if (preview) heading.current?.focus(); }, [preview]);
  function edit(value: string) { requestId.current++; setText(value); setPreview(null); setError(""); setBusy(false); if (fileInput.current) fileInput.current.value = ""; }
  async function read(file?: File) {
    if (!file) return;
    const current = ++requestId.current;
    setPreview(null); setError(""); setBusy(true);
    try {
      if (file.size > maxBytes) throw Error("Choose a JSON file no larger than 120 KiB.");
      const value = await file.text();
      if (current === requestId.current) setText(value);
    } catch (e) { if (current === requestId.current) { setText(""); setError((e as Error).message); } }
    finally { if (current === requestId.current) setBusy(false); }
  }
  async function compare() {
    const current = ++requestId.current;
    setError(""); setPreview(null); setBusy(true);
    try {
      if (new TextEncoder().encode(text).length > maxBytes) throw Error("Ruleset JSON must be no larger than 120 KiB.");
      let configuration: unknown;
      try { configuration = JSON.parse(text); } catch { throw Error("This is not valid JSON. Check the syntax and preview again."); }
      const result = await api<RulesetImportPreview>(`${trunkPath(trunk)}/rulesets/import/preview`, { body: { configuration } });
      if (current === requestId.current) setPreview(result);
    } catch (e) { if (current === requestId.current) setError((e as Error).message); }
    finally { if (current === requestId.current) setBusy(false); }
  }
  async function create() {
    if (!preview || pending.current) return;
    const current = requestId.current;
    pending.current = true; setCreating(true); setError("");
    try {
      const rule = await api<Ruleset>(`${trunkPath(trunk)}/rulesets/import`, { body: { configuration: preview.configuration } });
      if (current === requestId.current) onImported(rule);
    } catch (e) { if (current === requestId.current) setError((e as Error).message); }
    finally { pending.current = false; if (current === requestId.current) setCreating(false); }
  }
  return <section aria-label="Import a ruleset" className="repository-protection-form space-y-4">
    <h3 className="text-sm font-semibold">Import a ruleset</h3>
    <p className="text-sm text-muted">Choose a JSON file or paste its contents. Preview the configuration, then create a new ruleset in this repository. Maximum 120 KiB.</p>
    <Notice error={error} />
    <label className="block space-y-1 text-sm">Ruleset JSON file<input ref={fileInput} className="block max-w-full text-sm" type="file" accept=".json,application/json" disabled={creating} onChange={e => void read(e.target.files?.[0])} /></label>
    <label className="block space-y-1 text-sm">Ruleset JSON<textarea className={`${field} font-mono text-xs`} rows={7} maxLength={maxBytes} value={text} disabled={creating} onChange={e => edit(e.target.value)} spellCheck={false} /></label>
    <div className="flex flex-wrap gap-2"><Button disabled={busy || creating || !text.trim()} onClick={() => void compare()}>{busy ? "Reading configuration…" : "Preview import"}</Button><Button disabled={creating} onClick={onCancel}>Cancel import</Button></div>
    {preview && <section aria-label="Ruleset import preview" className="space-y-3 border-t border-line pt-4">
      <h3 ref={heading} tabIndex={-1} className="break-words text-sm font-semibold outline-none">{preview.configuration.name}</h3>
      <p className="text-sm text-muted">{preview.configuration.target} · {preview.configuration.enforcement} · {preview.configuration.rules.length} restrictions. {preview.configuration.enforcement === "active" ? "Applies immediately when created." : preview.configuration.enforcement === "evaluate" ? "Records evaluations immediately without blocking changes." : "Saved without enforcement until activated."}</p>
      {preview.notes.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm text-muted">{preview.notes.map(note => <li key={note}>{note}</li>)}</ul>}
      <p className="text-sm text-muted">Bypass accounts are not imported. Configure local accounts after creation if needed.</p>
      <pre className="max-h-80 overflow-auto rounded border border-line bg-page p-3 font-mono text-xs leading-5">{JSON.stringify(preview.configuration, null, 2)}</pre>
      <Button variant="primary" disabled={creating || busy} onClick={() => void create()}>{creating ? "Creating ruleset…" : "Create imported ruleset"}</Button>
    </section>}
  </section>;
}
