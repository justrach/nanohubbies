import {assertRepositoryWritable} from "./archive";
import {reviewedMergeHead} from "../review/merge-evidence";
import {rulesetBypass,type RulesetActor} from './bypass';
import {Environments,environmentNames} from "../deployments/store";
import type { RefProof } from "./types";
import type { RuleObserver, RulesetEvaluation } from "./insight-types";
import { globPattern, matchesGlob } from "./pattern";
import {defaultBranch,defaultCommit} from "./default-branch";
import { isMetadataRule, validateMetadataParameters, metadataMatcher } from "./metadata-pattern";

import type { RulesetInput, Ruleset, RulesetPlan, RefRule, PushRule } from "./ruleset-types";
export type { RulesetInput, Ruleset, RulesetPlan, RefRule, PushRule, MetadataRule } from "./ruleset-types";

function keys(value: unknown, allowed: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).some(k => !allowed.includes(k))) throw Error("Unsupported ruleset field");
}
const refTypes = ["creation", "update", "deletion", "non_fast_forward", "required_linear_history", "required_signatures"];
function strings(value: unknown, test: (s: string) => unknown, max = 200) {
  if (!Array.isArray(value) || value.length > 200 || value.some(s => typeof s !== "string" || !s.length || s.length > max || !test(s)))
    throw Error(`Invalid ruleset patterns (maximum 200 entries, ${max} characters each)`);
  return [...new Set(value)] as string[];
}
export function validateRuleset(input: RulesetInput): RulesetInput {
  keys(input, ["name", "target", "enforcement", "conditions", "bypass_actors", "rules"]);
  if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 100 || /[\0\r\n]/.test(input.name) ||
    !["branch", "tag", "push"].includes(input.target) || !["active", "evaluate", "disabled"].includes(input.enforcement) ||
    !Array.isArray(input.rules) || input.rules.length > 20) throw Error("Invalid ruleset");
  let conditions: RulesetInput["conditions"];
  if (input.target === "push") {
    if (input.conditions !== undefined) throw Error("Push rules apply to every ref; conditions are not supported");
  } else {
    keys(input.conditions, ["ref_name"]);
    keys(input.conditions!.ref_name, ["include", "exclude"]);
    const check = (p: string) => p === "~ALL" || (p === "~DEFAULT_BRANCH" && input.target === "branch") ||
      (p.startsWith(input.target === "branch" ? "refs/heads/" : "refs/tags/") && !!globPattern(p));
    const include = strings(input.conditions!.ref_name.include, check,255), exclude = strings(input.conditions!.ref_name.exclude, check,255);
    if (!include.length) throw Error("Select at least one ref pattern");
    conditions = { ref_name: { include, exclude } };
  }
  if (input.bypass_actors !== undefined && (!Array.isArray(input.bypass_actors) || input.bypass_actors.length > 100)) throw Error("Invalid bypass actors");
  const bypass_actors = (input.bypass_actors ?? []).map(a => {
    keys(a, ["actor_type", "actor_id", "bypass_mode"]);
    if (!(a.actor_type==='RepositoryRole'?[4,5].includes(a.actor_id):a.actor_type==='User'&&typeof a.actor_id==='string'&&!!a.actor_id&&a.actor_id.length<=256&&!/[\0\r\n]/.test(a.actor_id)) ||
      !["always", "pull_request"].includes(a.bypass_mode) || (input.target !== "branch" && a.bypass_mode === "pull_request"))
      throw Error("Bypass requires a stable account ID or supported repository role (4 writer, 5 admin) and a supported mode");
    return { ...a };
  });
  const roles=bypass_actors.filter(a=>a.actor_type==='RepositoryRole');
  if(new Set(roles.map(a=>a.actor_id)).size!==roles.length)throw Error('Configure each repository role once with one bypass mode');
  const rules = input.rules.map((r,index) => {
    if (!r || typeof r !== "object") throw Error("Invalid rule");
    if(r.type==="required_deployments") {
      keys(r,["type","parameters"]);keys(r.parameters,["required_deployment_environments"]);
      if(input.target!=="branch")throw Error("Required deployments apply to branches only");
      const names=environmentNames(r.parameters.required_deployment_environments);if(!names.length)throw Error("Choose at least one required deployment environment");return {type:r.type,parameters:{required_deployment_environments:names}};
    }
    if (input.target !== "push") {
      if(isMetadataRule(r)) {
        keys(r,["type","parameters"]);
        if(r.type==="branch_name_pattern"&&input.target!=="branch"||r.type==="tag_name_pattern"&&input.target!=="tag")throw Error("Name patterns must match the ruleset target");
        try{return {type:r.type,parameters:validateMetadataParameters(r.parameters)};}
        catch(error){throw Error(`${typeof r.parameters?.name==="string"?r.parameters.name:`Metadata restriction ${index+1} (${r.type})`}: ${(error as Error).message}`);}
      }
      keys(r, ["type"]);
      if (!refTypes.includes(r.type)) throw Error(`Unsupported branch/tag rule: ${r.type}`);
      return { type: r.type } as RefRule;
    }
    keys(r, ["type", "parameters"]);
    if (!("parameters" in r)) throw Error("Push rule requires parameters");
    const p = r.parameters;
    const typeName: string = r.type;
    switch (r.type) {
      case "file_path_restriction": {
        keys(p, ["restricted_file_paths", "allowed_file_paths"]);
        const paths = strings(r.parameters.restricted_file_paths, s => !!globPattern(s));
        if (!paths.length) throw Error("Provide restricted paths");
        const allowed = r.parameters.allowed_file_paths === undefined ? undefined : strings(r.parameters.allowed_file_paths, s => !!globPattern(s));
        return { type: r.type, parameters: { restricted_file_paths: paths, ...(allowed === undefined ? {} : { allowed_file_paths: allowed }) } };
      }
      case "file_extension_restriction": {
        keys(p, ["restricted_file_extensions"]);
        const extensions = strings(r.parameters.restricted_file_extensions, s => /^\.[^/\\\0*?\[\]\s]+$/.test(s));
        if (!extensions.length) throw Error("Provide extensions beginning with a dot");
        return { type: r.type, parameters: { restricted_file_extensions: extensions } };
      }
      case "max_file_path_length":
        keys(p, ["max_file_path_length"]);
        if (!Number.isSafeInteger(r.parameters.max_file_path_length) || r.parameters.max_file_path_length < 1 || r.parameters.max_file_path_length > 4096) throw Error("Path length must be 1–4096 characters");
        return { type: r.type, parameters: { ...r.parameters } };
      case "max_file_size": {
        keys(p, ["max_file_size", "allowed_file_paths"]);
        if (!Number.isSafeInteger(r.parameters.max_file_size) || r.parameters.max_file_size < 1 || r.parameters.max_file_size > 100) throw Error("File size must be 1–100 MiB (host object limits also apply)");
        const allowed = r.parameters.allowed_file_paths === undefined ? undefined : strings(r.parameters.allowed_file_paths, s => !!globPattern(s));
        return { type: r.type, parameters: { max_file_size: r.parameters.max_file_size, ...(allowed === undefined ? {} : { allowed_file_paths: allowed }) } };
      }
      default: throw Error(`Unsupported push rule: ${typeName}`);
    }
  });
  const uniqueRules=rules.filter(r=>!isMetadataRule(r));
  if (new Set(uniqueRules.map(r => r.type)).size !== uniqueRules.length) throw Error("Duplicate rule type");
  return { name: input.name.trim(), target: input.target, enforcement: input.enforcement, ...(conditions ? { conditions } : {}), bypass_actors, rules };
}

export function applies(r: Ruleset, ref: string, branch="main") {
  if (r.enforcement !== "active") return false;
  if (r.target === "push") return true;
  if (!ref.startsWith(r.target === "branch" ? "refs/heads/" : "refs/tags/")) return false;
  const match = (p: string) => p === "~ALL" || (p === "~DEFAULT_BRANCH" ? ref === `refs/heads/${branch}` : matchesGlob(p, ref));
  return r.conditions!.ref_name.include.some(match) && !r.conditions!.ref_name.exclude.some(match);
}

/** Settings and ref writes share the sequencer's synchronous transaction.
 * The revision binds expensive asynchronous graph checks to current rules. */
export class Rulesets {
  constructor(private sql: SqlStorage) {
    sql.exec("CREATE TABLE IF NOT EXISTS repository_rulesets (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL)");
    const existingCounter=sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='repository_rules_revision'").toArray().length>0;
    sql.exec("CREATE TABLE IF NOT EXISTS repository_rules_revision (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL)");
    sql.exec("INSERT OR IGNORE INTO repository_rules_revision VALUES (1,0)");
    const events=["insert","update","delete"] as const;
    const installed=sql.exec<{n:number}>("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name IN ('repository_rules_revision_insert','repository_rules_revision_update','repository_rules_revision_delete')").toArray()[0].n;
    if(installed!==events.length){
      if(existingCounter)sql.exec("UPDATE repository_rules_revision SET revision=revision+1 WHERE id=1");
      for(const event of events)sql.exec(`CREATE TRIGGER IF NOT EXISTS repository_rules_revision_${event} AFTER ${event.toUpperCase()} ON repository_rulesets BEGIN UPDATE repository_rules_revision SET revision=revision+1 WHERE id=1; END`);
    }
  }
  plan(): RulesetPlan {
    return { roleBypass:true,revisionTracking:"storage",revision: this.sql.exec<{revision:number}>("SELECT revision FROM repository_rules_revision WHERE id=1").toArray()[0].revision,defaultBranch:defaultBranch(this.sql),
      rulesets: this.sql.exec<{id:number;data:string}>("SELECT * FROM repository_rulesets ORDER BY id").toArray().map(r => ({ ...JSON.parse(r.data), id: r.id })) };
  }
  invalidate(){this.sql.exec("UPDATE repository_rules_revision SET revision=revision+1 WHERE id=1");}
  set(input: RulesetInput, id?: number) {
    assertRepositoryWritable(this.sql);
    const value = validateRuleset(input), plan = this.plan();
    for(const rule of value.rules)if(rule.type==="required_deployments")rule.parameters.required_deployment_environments=new Environments(this.sql).resolve(rule.parameters.required_deployment_environments);
    if (id !== undefined && !plan.rulesets.some(r => r.id === id)) throw Error("No such ruleset");
    if (id === undefined && plan.rulesets.length >= 100) throw Error("At most 100 rulesets");
    if (id === undefined) {
      this.sql.exec("INSERT INTO repository_rulesets(data) VALUES(?)", JSON.stringify(value));
      id = this.sql.exec<{id:number}>("SELECT last_insert_rowid() AS id").toArray()[0].id;
    } else this.sql.exec("UPDATE repository_rulesets SET data=? WHERE id=?", JSON.stringify(value), id);
    return { ...value, id };
  }
  remove(id: number) {
    assertRepositoryWritable(this.sql);
    if (!this.plan().rulesets.some(r => r.id === id)) throw Error("No such ruleset");
    this.sql.exec("DELETE FROM repository_rulesets WHERE id=?", id);
  }
  enforce(ref: string, old: string | null, next: string | null, fastForward: boolean, actor: string, human: boolean, merge: boolean, proof?: RefProof,branchContext?:string,observe?:RuleObserver,deploymentBase?:string|null,authority?:RulesetActor) {
    const plan=this.plan(),bypassed:number[]=[],evaluations:RulesetEvaluation[]=[];
    const matches=metadataMatcher();
    for(const r of plan.rulesets.filter(r=>r.enforcement!=="disabled"&&applies({...r,enforcement:"active"},ref,plan.defaultBranch))) {
      const evaluation:RulesetEvaluation={id:r.id,name:r.name,enforcement:r.enforcement as "active"|"evaluate",result:"pass",rules:r.rules.map(rule=>rule.type),reasons:[]};
      evaluations.push(evaluation);
      const bypass=rulesetBypass(r,actor,human,merge,authority);
      if(bypass) {
        evaluation.bypass={...bypass,...(authority?{role:authority.role}: {})};
        evaluation.result="bypass";if(r.enforcement==="active")bypassed.push(r.id);continue;
      }
      const fail=(reason:string,error=false)=>{
        if(evaluation.result!=="error")evaluation.result=error?"error":"fail";
        if(evaluation.reasons.length<20)evaluation.reasons.push(reason.slice(0,512));
      };
      const evidence=r.enforcement==="evaluate"?proof?.evaluation:{rules:proof?.rules,signatures:proof?.signatures,error:undefined};
      for(const rule of r.rules) {
        if(next&&isMetadataRule(rule)&&(rule.type==="branch_name_pattern"||rule.type==="tag_name_pattern")) {
          try{if(!matches(rule.parameters,ref.replace(/^refs\/(heads|tags)\//,"")))fail(`${rule.parameters.name??rule.type}: ref name does not satisfy the metadata pattern`);}
          catch(error){fail((error as Error).message,true);}
        }
        if(rule.type==="required_deployments"&&next) {
          const base=deploymentBase===undefined?defaultCommit(this.sql):deploymentBase;
          if(!base)fail("Current deployment base is unavailable",true);
          else {const gate=new Environments(this.sql).gate(rule.parameters.required_deployment_environments,merge?reviewedMergeHead(proof,old,next):next,base);for(const status of gate.environments)if(!status.ready)fail(status.error!);}
        }
        if(rule.type==="creation"&&!old&&next)fail("creation is restricted");
        if(rule.type==="update"&&old&&next)fail("updates are restricted");
        if(rule.type==="deletion"&&!next)fail("deletion is restricted");
        if(rule.type==="non_fast_forward"&&old&&next&&!fastForward)fail("force pushes are blocked");
        if(rule.type==="required_linear_history"&&next&&(!proof||proof.old!==old||proof.next!==next||!proof.linear))fail("requires linear history");
        if(rule.type==="required_signatures"&&next) {
          if(!proof||proof.old!==old||proof.next!==next||!evidence?.signatures?.verified)fail(`requires verified signed commits${evidence?.signatures?.reason?`; ${evidence.signatures.reason}`:"; retry with current signature evidence"}`);
          if(!old&&ref.startsWith("refs/heads/")&&(!branchContext||evidence?.signatures?.creationBranches!==branchContext))fail("branches changed during signature verification; retry the push",true);
        }
      }
      if(next&&(r.target==="push"&&r.rules.length||r.rules.some(rule=>rule.type==="required_signatures"||isMetadataRule(rule)&&rule.type!=="branch_name_pattern"&&rule.type!=="tag_name_pattern"))) {
        if(!proof||proof.old!==old||proof.next!==next||evidence?.rules?.revision!==plan.revision||r.target==="push"&&evidence.rules.fileTransitions!==true)fail("rules changed or graph evidence is missing; retry the push",true);
        else {
          if(r.target!=="push"&&evidence.rules.ref!==ref)fail("metadata evidence is bound to another ref; retry the push",true);
          const violation=evidence.rules.violations.find(v=>v.rulesetId===r.id);
          if(violation)fail(violation.message);
        }
      }
      if(next&&r.enforcement==="evaluate"&&evidence?.error)fail(`Evaluation unavailable: ${evidence.error}`,true);
    }
    observe?.({ref,old,next,actor,human,merge,revision:plan.revision,evaluations});
    const blocked=evaluations.find(r=>r.enforcement==="active"&&(r.result==="fail"||r.result==="error"));
    if(blocked)throw Error(`${ref}: ruleset "${blocked.name}": ${blocked.reasons[0]}`);
    return bypassed;
  }
}
