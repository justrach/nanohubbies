"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, trunkPath } from "@/lib/api";
import { useSession } from "@/lib/session";

export interface ImportStatus {
  trunk: string;
  repo: string;
  phase: "queued" | "copying" | "seeding" | "context" | "complete" | "failed";
  ready: boolean;
  files: number;
  bytes: number;
  skipped: number;
  startedAt: number;
  updatedAt: number;
  error: string | null;
  notes: string[];
}
export function useImportStatus(trunk: string, initial?: ImportStatus | null) {
  const { user } = useSession();
  const [job, setJob] = useState<ImportStatus | null>(initial ?? null);
  const first = useRef(true);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    let live = true, pending = false, complete = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const hydrated = first.current && initial !== undefined;
    first.current = false;
    if (!hydrated) setJob(null);
    complete = hydrated && (!initial || initial.phase === "complete" || initial.phase === "failed");
    const load = async () => {
      if (!live || complete || pending || document.hidden) return;
      pending = true;
      try {
        const result = await api<{ job: ImportStatus | null }>(`${trunkPath(trunk)}/import`);
        if (!live) return;
        setJob(result.job);
        complete = !result.job || result.job.phase === "complete" || result.job.phase === "failed";
      } catch (error) {
        if (live && error instanceof ApiError && [401, 403, 404].includes(error.status)) {
          setJob(null);
          complete = true;
        }
      } finally {
        pending = false;
        if (live && !complete) timer = setTimeout(() => void load(), 2500);
      }
    };
    const resume = () => { if (timer) clearTimeout(timer); void load(); };
    if (hydrated && !complete) timer = setTimeout(() => void load(), 2500);
    else if (!hydrated) void load();
    document.addEventListener("visibilitychange", resume);
    return () => { live = false; if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", resume); };
  }, [trunk, user?.id, revision]);
  return { job, refresh };
}
