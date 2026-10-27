export type DeploymentRule = {type:"required_deployments";parameters:{required_deployment_environments:string[]}};
export type RefRule = { type: "creation" | "update" | "deletion" | "non_fast_forward" | "required_linear_history" | "required_signatures" };
export type MetadataRuleType = "commit_message_pattern" | "commit_author_email_pattern" | "committer_email_pattern" | "branch_name_pattern" | "tag_name_pattern";
export interface MetadataParameters { name?: string; negate?: boolean; operator: "starts_with" | "ends_with" | "contains" | "regex"; pattern: string }
export interface MetadataRule { type: MetadataRuleType; parameters: MetadataParameters }
export type PushRule =
  | { type: "file_path_restriction"; parameters: { restricted_file_paths: string[]; allowed_file_paths?: string[] } }
  | { type: "file_extension_restriction"; parameters: { restricted_file_extensions: string[] } }
  | { type: "max_file_path_length"; parameters: { max_file_path_length: number } }
  | { type: "max_file_size"; parameters: { max_file_size: number; allowed_file_paths?: string[] } };
export interface RulesetInput {
  name: string;
  target: "branch" | "tag" | "push";
  enforcement: "active" | "evaluate" | "disabled";
  conditions?: { ref_name: { include: string[]; exclude: string[] } };
  bypass_actors?: ({actor_type:"User";actor_id:string;bypass_mode:"always"|"pull_request"}|{actor_type:"RepositoryRole";actor_id:4|5;bypass_mode:"always"|"pull_request"})[];
  rules: (RefRule | PushRule | MetadataRule | DeploymentRule)[];
}
export interface Ruleset extends RulesetInput { id: number }
export interface RulesetPlan { roleBypass?:true;revisionTracking?:"storage";revision: number; rulesets: Ruleset[]; defaultBranch?:string }
export interface RulesetImportPreview { configuration: RulesetInput; notes: string[] }
export interface RulesetRestorePreview {
  eventId: number;
  rulesetId: number;
  revision: number;
  recordedAt: number;
  current: Ruleset | null;
  selected: RulesetInput;
}
export interface RulesetEvidence {
  /** Producer checked actual ref-tree changes as well as introduced commits. */
  fileTransitions?:true;
  revision: number;
  ref?: string;
  violations: { rulesetId: number; message: string }[];
}
