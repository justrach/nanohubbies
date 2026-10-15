export type ImportPhase = "queued" | "copying" | "seeding" | "context" | "complete" | "failed";
export interface ImportStatus {
  trunk: string;
  repo: string;
  phase: ImportPhase;
  ready: boolean;
  files: number;
  bytes: number;
  skipped: number;
  startedAt: number;
  updatedAt: number;
  error: string | null;
  notes: string[];
}
export interface ImportRequest {
  id: string;
  trunk: string;
  upstream: { owner: string; repo: string; ref: string | null };
  origin: string;
  owner: string;
  provider: "dev" | "codegraff";
  ticket: string | null;
  maxBytes: number;
}
export interface ImportState extends ImportRequest {
  status: ImportStatus;
  commit: string | null;
  nextFile: number;
  batch: number;
  attempts: number;
  retries: number;
  resume: Exclude<ImportPhase, "complete" | "failed">;
}
export const activeImport = (phase: ImportPhase) => phase !== "complete" && phase !== "failed";

/** Authenticated imports use bounded streaming batches instead of the small
 * public JSON seed allowance. Configuration can lower or raise this to 128 MiB. */
export function importByteLimit(env: object): number {
  const configured = Number((env as Record<string, unknown>).TRUNK_IMPORT_MAX_BYTES);
  return Number.isSafeInteger(configured) && configured > 0
    ? Math.min(configured, 128 * 1024 * 1024)
    : 64 * 1024 * 1024;
}
