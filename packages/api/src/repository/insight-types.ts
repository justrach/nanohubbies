export type RuleOutcome = "pass" | "fail" | "bypass" | "error";
export interface RulesetEvaluation {
  id: number;
  name: string;
  enforcement: "active" | "evaluate";
  result: RuleOutcome;
  rules: string[];
  reasons: string[];
  bypass?:NonNullable<import('./ruleset-types').RulesetInput['bypass_actors']>[number]&{role?:import('./bypass').RulesetActor['role']};
}
export interface RuleAttempt {
  ref: string;
  old: string | null;
  next: string | null;
  actor: string;
  human: boolean;
  merge: boolean;
  revision: number;
  evaluations: RulesetEvaluation[];
}
export type RuleObserver = (attempt: RuleAttempt) => void;
export type RuleSource = "git" | "branch" | "merge" | "restack" | "suggestions";
export interface RuleSuite extends RuleAttempt {
  id: number;
  batch: string;
  at: number;
  source: RuleSource;
  accepted: boolean;
  result: RuleOutcome;
  rejection?: string;
}
export interface RuleSuiteQuery {
  before?: number; limit?: number; ref?: string; actor?: string;
  ruleset?: number; result?: RuleOutcome; from?: number; to?: number;
}
export interface RuleSuitePage { suites: RuleSuite[]; nextCursor: number | null }
