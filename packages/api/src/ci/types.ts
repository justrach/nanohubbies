import type { CheckState } from "./conclusions";
export type { CheckState } from "./conclusions";
export interface RunnerSource { id: string; name: string; revoked: boolean }
export interface CheckResult { name: string; state: CheckState; command: string; log: string; artifacts: string[]; execution?: {provider:"codegraff";sandboxId:string;workflow:string;job:string} }
export interface StagingEvidence {
  runId: string; head: string; candidate: string; base: string; version: string;
  observedBuildId?: string; verifiedAt: number; acceptance: { url: string; realService: boolean; before?: string; after?: string }[];
}
export interface Run {
  id: string; branch: string; head: string; base: string;
  /** Canonical source ref and raw target, including annotated-tag object IDs. */
  ref?:string; refTarget?:string;
  state: "queued" | "running" | "waiting" | "complete" | "superseded";
  generation?:number; initiator?:string; environmentWait?:string;
  deploymentApprovedBy: string | null;
  attempt: number; leaseUntil: number; runner: string | null;
  deployments?: import("../deployments/types").DeploymentReport[];
  results: CheckResult[]; staging: StagingEvidence | null; createdAt: number;
}
