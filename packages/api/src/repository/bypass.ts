import type {RulesetInput} from './ruleset-types';
export interface RulesetActor {actor:string;role:'owner'|'admin'|'writer'|'reader'|null;checkedAt:number;expiresAt:number}
export function currentRulesetActor(evidence:RulesetActor|undefined,actor:string,now=Date.now()) {
 return !!evidence&&evidence.actor===actor&&Number.isFinite(evidence.checkedAt)&&Number.isFinite(evidence.expiresAt)&&evidence.checkedAt<=now+1000&&evidence.expiresAt>now&&now-evidence.checkedAt<=30000;
}
/** Role IDs match GitHub's built-in write (4) and admin (5) actors. They
 * select exact native roles; owner is included with admin. No role is implicit. */
export function rulesetBypass(rule:RulesetInput,actor:string,human:boolean,merge:boolean,evidence?:RulesetActor) {
 if(!human||evidence&&(!currentRulesetActor(evidence,actor)||!['owner','admin','writer'].includes(evidence.role??'')))return;
 return rule.bypass_actors?.find(a=>(a.bypass_mode==='always'||merge)&&
  (a.actor_type==='User'?a.actor_id===actor:a.actor_type==='RepositoryRole'&&currentRulesetActor(evidence,actor)&&
   (a.actor_id===5?['owner','admin'].includes(evidence!.role??''):evidence!.role==='writer')));
}
