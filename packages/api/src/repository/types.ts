export interface BranchPolicy {
  branch: string;
  pullRequest: boolean;
  approvals: number;
  checks: string[];
  beforeOpen: string[];
  environments?: string[];
  /** Trusted CI registration, shared by a runner pool. Overlapping pins all apply. */
  checkSources?: CheckSource[];
  preventForce: boolean;
  preventDelete: boolean;
  locked?: boolean;
  /** Stable account IDs; scoped agent credentials inherit their human owner. */
  allowPush?: string[];
  /** Exceptions to preventForce only; never bypass other matching restrictions. */
  allowForcePush?: string[];
  /** Human writers who may dismiss reviews; omitted permits all human writers. */
  allowDismiss?: string[];
  requireLastPushApproval?: boolean;
  requireConversationResolution?: boolean;
  requireLinearHistory?: boolean;
  requireCodeOwnerReview?: boolean;
  requireSignedCommits?: boolean;
  /** Defaults to true for existing policies. False retains undismissed approvals. */
  dismissStaleReviews?: boolean;
}
export interface CheckSource { name: string; runner: string }
/** Computed from Git objects in trusted routes, never accepted from JSON. */
export interface RefProof {
  old: string | null;
  next: string;
  linear: boolean;
  /** Commit reached by peeling a tag, derived only from verified Git objects. */
  peeledCommit?:string;
  rules?: import("./ruleset-types").RulesetEvidence;
  signatures?: import("../signing/types").SignatureProof;
  /** Observation-only graph evidence; never satisfies an active restriction. */
  evaluation?: { rules: import("./ruleset-types").RulesetEvidence; signatures?: import("../signing/types").SignatureProof; error?: string };
}
