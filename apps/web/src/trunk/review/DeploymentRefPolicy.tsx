"use client";
import {useState} from 'react';
import type {DeploymentEnvironment} from '@swarm/api/review';
import {patternLines} from '@swarm/api/review';
import {field} from './shared';
type Policy=NonNullable<DeploymentEnvironment['deploymentBranchPolicy']>;
export function deploymentRefSummary(policy:Policy|undefined) {
 if(!policy||policy.mode==='all')return 'All branches and tags';
 if(policy.mode==='protected')return 'Protected branches only';
 const rules=policy.rules??[];if(!rules.length)return 'No branches or tags allowed';
 return rules.map(rule=>`${rule.type==='branch'?'Branch':'Tag'}: ${rule.name}`).join(' · ');
}
export function deploymentRefInput(form:FormData):Policy|undefined {
 const mode=String(form.get('deploymentRefMode')??'all')as Policy['mode'];
 if(mode==='all')return;
 if(mode==='protected')return{mode};
 const patterns=(type:'branch'|'tag')=>patternLines(form.get(type==='branch'?'deploymentBranches':'deploymentTags')).map(name=>({type,name}));
 return{mode:'selected',rules:[...patterns('branch'),...patterns('tag')]};
}
export function DeploymentRefPolicy({initial,disabled}:{initial?:Policy;disabled?:boolean}) {
 const [mode,setMode]=useState<Policy['mode']>(initial?.mode??'all');
 const [branches,setBranches]=useState(initial?.rules?.filter(rule=>rule.type==='branch').map(rule=>rule.name).join('\n')??'');
 const [tags,setTags]=useState(initial?.rules?.filter(rule=>rule.type==='tag').map(rule=>rule.name).join('\n')??'');
 return <fieldset className="space-y-3 border-t border-line pt-4"><legend className="text-sm font-semibold">Deployment branches and tags</legend>
  <label className="block max-w-xl space-y-1 text-sm"><span>Which refs can deploy?</span><select className={field} name="deploymentRefMode" value={mode} onChange={event=>setMode(event.target.value as Policy['mode'])} disabled={disabled}>
   <option value="all">No restriction</option><option value="protected">Protected branches only</option><option value="selected">Selected branches and tags</option>
  </select></label>
  {mode==='all'&&<p className="max-w-2xl text-xs leading-5 text-muted">Any branch or tag may request deployment. Required reviewers, the wait timer and the trusted runner still apply.</p>}
  {mode==='protected'&&<p className="max-w-2xl text-xs leading-5 text-muted">Allow branches covered by an active branch protection rule or ruleset. If no branch protections exist, all branches may deploy. Tags cannot deploy in this mode.</p>}
  {mode==='selected'&&<><p className="max-w-2xl text-xs leading-5 text-muted">Enter one name pattern per line. Branch and tag names are checked separately and are case-sensitive. <code>*</code> stays within one path segment; <code>**</code> crosses <code>/</code>. Leave both lists empty to block every ref.</p>
   <div className="grid min-w-0 gap-4 lg:grid-cols-2"><label className="block min-w-0 space-y-1 text-sm"><span>Allowed branch patterns</span><textarea className={`${field} min-h-24 font-mono text-xs`} name="deploymentBranches" maxLength={13000} value={branches} onChange={event=>setBranches(event.target.value)} placeholder={'main\nrelease/*'} disabled={disabled}/></label>
    <label className="block min-w-0 space-y-1 text-sm"><span>Allowed tag patterns</span><textarea className={`${field} min-h-24 font-mono text-xs`} name="deploymentTags" maxLength={13000} value={tags} onChange={event=>setTags(event.target.value)} placeholder={'v*\nrelease/*'} disabled={disabled}/></label></div>
   <p className="text-xs text-muted">Up to 100 patterns total. Each pattern may contain up to 255 characters.</p>
  </>}
 </fieldset>;
}
