import {Policies} from '../repository/policy';
import {rulesetBypass,type RulesetActor} from '../repository/bypass';
import {Rulesets,applies} from '../repository/rulesets';
import {Environments,environmentNames} from './store';
export function deploymentGate(sql:SqlStorage,branch:string,head:string,base:string,actor:string,human:boolean,authority?:RulesetActor) {
 const classic=new Policies(sql).get(branch)?.environments??[];
 const plan=new Rulesets(sql).plan(),rules=plan.rulesets.filter(rule=>applies(rule,`refs/heads/${branch}`,plan.defaultBranch)&&!rulesetBypass(rule,actor,human,true,authority));
 const names=environmentNames([...new Map([...classic,...rules.flatMap(set=>set.rules.flatMap(rule=>rule.type==='required_deployments'?rule.parameters.required_deployment_environments:[]))].map(name=>[name.toLowerCase(),name])).values()],100);
 return new Environments(sql).gate(names,head,base);
}
