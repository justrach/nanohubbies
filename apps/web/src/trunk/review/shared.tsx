"use client";

import { useState } from "react";
import { api, trunkPath } from "@/lib/api";
import type { ReviewSnapshot } from "@swarm/api/review";

export const field = "w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-series-1";

export function useReviewAction(trunk: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(path: string, body: unknown, done: (data: ReviewSnapshot) => void, method = "POST") {
    if (busy) return;
    setBusy(true); setError("");
    try { done(await api<ReviewSnapshot>(`${trunkPath(trunk)}${path}`, { method, body })); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return { busy, error, run };
}

export function Notice({ error }: { error: string }) {
  return error ? <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-ink">{error}</p> : null;
}
