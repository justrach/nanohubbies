import type { SubmitOptions } from "../agent";
import { decodeRequest, encodeRequest, fingerprint } from "../submission";
import type { ChangeRequest, Edit, SubmitResult } from "../types";

export interface Submission {
  request: ChangeRequest;
  result: SubmitResult | null;
}

/** The current life's request survives a lost lane reply or eviction. Older
 *  lives remain in the agent's history, but only the current life is retried. */
export function loadSubmission(sql: SqlStorage, life: number): Submission | null {
  const row = sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = 'submission'").toArray()[0];
  if (!row) return null;
  const saved = JSON.parse(row.v);
  const request = decodeRequest(saved.request);
  return request.life === life ? { request, result: saved.result } : null;
}

export function saveSubmission(sql: SqlStorage, request: ChangeRequest, result: SubmitResult | null) {
  sql.exec("INSERT INTO meta (k, v) VALUES ('submission', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", JSON.stringify({ request: encodeRequest(request), result }));
}

export function matches(request: ChangeRequest, intent: string, edits: Edit[], opts: SubmitOptions): boolean {
  const payload = (intent: string, edits: Edit[], opts: SubmitOptions) => ({
    intent, edits, issue: opts.issue ?? null, closes: !!opts.closes && opts.issue != null, pushed: opts.pushed ?? null,
  });
  return fingerprint(payload(request.intent, request.edits, request)) === fingerprint(payload(intent, edits, opts));
}
