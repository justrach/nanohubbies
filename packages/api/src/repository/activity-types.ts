import type { BranchPolicy } from "./types";
import type { Ruleset } from "./ruleset-types";

export type ActivityKind = "all" | "rulesets" | "protections" | "refs" | "bypasses" | "ci" | "reviews" | "environments" | "archive" | "settings";
export interface ActivityQuery {
  before?: number;
  limit?: number;
  kind?: ActivityKind;
  ref?: string;
  ruleset?: number;
}
export interface RepositoryEvent {
  id: number;
  at: number;
  actor: string;
  via?:{kind:"cli";credentialId:string};
  defaultBranch?:{previous:string;next:string;commit:string;revision:number};
  ref?: string;
  old?: string | null;
  next?: string | null;
  merge?: boolean;
  /** Present for verified non-fast-forward native Git updates; no historical backfill. */
  force?: boolean;
  human?: boolean;
  bypassedRulesets?: number[];
  bypassRole?:{role:import('./bypass').RulesetActor['role'];checkedAt:number};
  ruleset?: Ruleset;
  previousRuleset?: Ruleset | null;
  removedRuleset?: number;
  restoredFrom?: { rulesetId: number; eventId: number };
  policy?: BranchPolicy;
  previousPolicy?: BranchPolicy | null;
  removedPolicy?: string;
  archive?:{archived:boolean;revision:number};
  deploymentRequest?:{id:string;environment:string};
  deploymentReview?:{request:string;decision:"approve"|"reject";comment:string;environment:string};
  deploymentAuthorization?:{id:string;request:string;environment:string};
  environment?:import("../deployments/types").DeploymentEnvironment;
  previousEnvironment?:import("../deployments/types").DeploymentEnvironment|null;
  removedEnvironment?:string;
  stagingApproval?: string;
  retry?: string;
  head?: string;
  base?: string;
  dismissal?: { pull: number; review: number; branch: string; reason: string; previousVerdict: "APPROVE" | "REQUEST_CHANGES";automatic?:boolean };
}
export interface RepositoryActivity {
  events: RepositoryEvent[];
  nextCursor: number | null;
}
