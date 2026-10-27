import {defaultBranch} from '../repository/default-branch';
import {branchPattern,matchesBranch} from '../repository/pattern';
import {applies} from '../repository/rulesets';
import type {DeploymentEnvironment,DeploymentRefPolicy} from './types';
import type {Ruleset} from '../repository/ruleset-types';
/** Normalize before storage so omitted/all policies retain legacy behavior. */
export function deploymentRefPolicy(value:unknown):DeploymentRefPolicy|undefined {
 if(value===undefined)return;
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Choose a deployment branch and tag policy');
 const policy=value as DeploymentRefPolicy;
 if(Object.keys(policy).some(k=>!['mode','rules'].includes(k))||!['all','protected','selected'].includes(policy.mode))throw Error('Invalid deployment branch and tag policy');
 if(policy.mode!=='selected'){if(policy.rules!==undefined)throw Error('Only a selected deployment policy accepts patterns');return policy.mode==='all'?undefined:{mode:'protected'};}
 if(!Array.isArray(policy.rules)||policy.rules.length>100)throw Error('Choose up to 100 deployment branch and tag patterns');
 const seen=new Set<string>(),rules=policy.rules.map(rule=>{
  if(!rule||typeof rule!=='object'||Array.isArray(rule)||Object.keys(rule).some(k=>!['type','name'].includes(k))||!['branch','tag'].includes(rule.type))throw Error('Choose a branch or tag pattern');
  branchPattern(rule.name);const key=`${rule.type}:${rule.name}`;if(seen.has(key))throw Error('Duplicate deployment branch or tag pattern');seen.add(key);return{type:rule.type,name:rule.name};
 });return {mode:'selected',rules};
}
function stored<T>(sql:SqlStorage,table:'branch_policies'|'repository_rulesets'):T[] {
 if(!sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",table).toArray().length)return [];
 return sql.exec<{data:string}>(`SELECT data FROM ${table}`).toArray().map(row=>JSON.parse(row.data));
}
/** Protection is current configuration, independent of this actor's bypass. */
export function deploymentRefError(sql:SqlStorage,environment:DeploymentEnvironment,ref:string|undefined):string|null {
 const policy=environment.deploymentBranchPolicy;if(!policy||policy.mode==='all')return null;
 const match=typeof ref==='string'?/^refs\/(heads|tags)\/([\s\S]+)$/.exec(ref):null;
 if(!match)return `Deployment environment ${environment.name} requires a verified branch or tag identity`;
 const [,kind,name]=match;
 if(policy.mode==='selected')return policy.rules?.some(rule=>rule.type===(kind==='heads'?'branch':'tag')&&matchesBranch(rule.name,name))?null:`${ref} is not allowed to deploy to ${environment.name}`;
 if(kind!=='heads')return `Deployment environment ${environment.name} permits protected branches only; tags cannot deploy`;
 const classic=stored<{branch:string}>(sql,'branch_policies'),rules=stored<Ruleset>(sql,'repository_rulesets').filter(rule=>rule.target==='branch'&&rule.enforcement==='active'&&rule.rules.length);
 if(!classic.length&&!rules.length)return null;
 return classic.some(rule=>matchesBranch(rule.branch,name))||rules.some(rule=>applies(rule,ref!,defaultBranch(sql)))?null:`${ref} has no active branch protection for deployment to ${environment.name}`;
}
export function requireDeploymentRef(sql:SqlStorage,environment:DeploymentEnvironment,ref:string|undefined) {const error=deploymentRefError(sql,environment,ref);if(error)throw Error(error);}
