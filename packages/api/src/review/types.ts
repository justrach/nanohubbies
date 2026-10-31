import type { ChangeRequest, Head, Owner } from "../types";
export type {ReviewRequest,ReviewRequests,ReviewRequestEdit} from './request-types';
export type {BranchRenameConfiguration,BranchRenamePreview,BranchRenameInput} from '../repository/branch-rename-types';
export type {MergeMethod} from "./merge-types";
export type {MergeSettings,MergeSettingsInput} from '../repository/merge-settings-types';

export interface Branch { name: string; commit: string; tree: string; updatedAt: number }
export interface Pull {
  mergeMethod?:import("./merge-types").MergeMethod;
  number: number; title: string; body: string; head: string; base: string;
  anchor: string; anchorTree: string; author: Owner;
  headCommit: string; headTree: string; openedPushEvent?:number;
  parent: number | null;
  state: "open" | "closed" | "merged"; createdAt: number; updatedAt: number;
  mergedBase?: string; mergedCIBase?:string; mergedCommit: string | null; mergedVersion: number | null;
  deployments?:import("../deployments/types").DeploymentGate;
  codeOwners?: import("../repository/codeowner-types").CodeOwnerStatus;
}
export interface Review {
  id: number; pull: number; author: Owner; body: string;
  verdict: "COMMENT" | "APPROVE" | "REQUEST_CHANGES";
  commit: string; anchor: string; at: number; independent?: boolean; pushEvent?:number;
  /** Trusted tree IDs capture the reviewed diff independently of commit metadata. */
  tree?: string; anchorTree?: string;
  batchId?: string; commentIds?: string[];
  via?: {kind:"cli";credentialId:string};
  dismissed?: { actor: Owner; reason: string; at: number; kind?: "manual" | "stale" };
}
/** Public merge status only; never includes private draft authors or content. */
export interface SharedHeadReviewBlocker { number:number;changesRequested:boolean;pendingReview:boolean }
export interface ReviewGate { ready: boolean; error: string | null; approvals: number; required: number; reviewerAccess?:Record<string,import("./reviewer-types").ReviewerStatus>;sharedHeadBlockers?:SharedHeadReviewBlocker[] }
export interface ReviewSnapshot { canMerge?:boolean; canReview?:boolean; canManagePulls?:boolean; mergeSettings?:import("../repository/merge-settings-types").MergeSettings; mergeMethods?:import("./merge-types").MergeMethod[]; defaultBranch?:string; ciBase?:string|null; archive?:import("../repository/archive-types").ArchiveState; canConfigure?: boolean; canProtect?: boolean; repositoryMode?:boolean; environments?:import("../deployments/types").DeploymentEnvironment[]; rulesets?:import("../repository/ruleset-types").Ruleset[]; branches: Branch[]; pulls: Pull[]; reviews: Review[]; policies?: import("../repository/types").BranchPolicy[]; effectivePolicies?: Record<string,import("../repository/types").BranchPolicy>; runs?: import("../ci/types").Run[]; ciSources?: import("../ci/types").RunnerSource[] }
export type ReviewCommand =
  | { op: "snapshot" }
  | { op: "branch"; name: string; old: string | null; next: { commit: string; tree: string } | null; source?: Branch; fastForward?: boolean; actor?: string; human?:boolean; origin?:string; proof?:import("../repository/types").RefProof;
      rebased?: { number: number; anchor: string; base: Branch }[] }
  | { op: "open"; title: string; body: string; head: Branch; base: Branch; anchor: string; anchorTree: string; author: Owner }
  | { op: "close"; number: number }
  | { op: "review"; number: number; author: Owner; body: string; verdict: Review["verdict"]; commit: string; anchor: string; independent?: boolean; origin?:string; via?:Review["via"]; batch?:{id:string;comments:string[]} }
  | { op: "dismiss"; number: number; reviewId: number; actor: Owner; reason: string; human: boolean; origin: string }
  | { op: "compare"; number: number; head: Branch; base: Branch; previousAnchor: string; anchor: string; anchorTree: string }
  | { op: "restack"; number: number; head: Branch; base: Branch; anchor: string; next: { commit: string; tree: string }; actor?:string; human?:boolean; origin?:string; proof?:import("../repository/types").RefProof }
  | { op: "merge"; number: number; head: Branch; base: Head; anchor: string; request: ChangeRequest; human?:boolean; mergeSettingsRevision?:number; candidate?: { commit: string; tree: string; base: string;method?:import("./merge-types").MergeMethod }; proof?:import("../repository/types").RefProof;
      codeOwners?:import("../repository/codeowner-types").CodeOwnerEvidence;codeOwnerAccounts?:Record<string,string|null>;origin?:string };

export { branchName, tagName, MAX_REF_BYTES, patternLines } from "../repository/ref-name";

export type { Run as ActionRun } from "../ci/types";
export type { ActivityKind, RepositoryEvent, RepositoryActivity } from "../repository/activity-types";
export type { RulesetRestorePreview } from "../repository/ruleset-types";
export type { RulesetImportPreview } from "../repository/ruleset-types";
export type { CodeOwnerStatus } from "../repository/codeowner-types";
export type { MetadataRule } from "../repository/ruleset-types";
export type { PullComment, PullDiscussion } from "./pull-comment-types";
export type { PendingReview, PendingResult } from "./pending-types";
export type { SuggestionApplication } from "./suggestion-types";
export { suggestionText, suggestionFence } from "./suggestion-text";
export { checkFailure } from "../ci/check-gate";
export { passingConclusion, passingCheck, runConclusion, conclusionLabel } from "../ci/conclusions";
export type { CheckState } from "../ci/conclusions";
export type { RunnerSource } from "../ci/types";
export type {PublicSigningKey,SignatureReceipt,SignatureResult,SigningKeyList,SignatureGate} from "../signing/types";

export type { RuleOutcome, RulesetEvaluation, RuleSuite, RuleSuiteQuery, RuleSuitePage } from "../repository/insight-types";

export type {DeploymentEnvironment,EnvironmentInput,DeploymentReport,DeploymentRecord,DeploymentGate} from "../deployments/types";

export type {ArchiveState} from "../repository/archive-types";
export type {DeploymentRequest,DeploymentRequestStatus,DeploymentReview,DeploymentAuthorization} from "../deployments/approval-types";
export type { ContributionPage, ContributionEvent, WorkLink, AgentWork, ContributionAgent, ReportedClient, WorkStart, WorkReport } from '../contributions/types';
