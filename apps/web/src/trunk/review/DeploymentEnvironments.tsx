"use client";
import {useEffect,useRef,useState} from 'react';
import {useTrunk} from "../context";
import {Cloud} from 'lucide-react';
import type {DeploymentEnvironment,RunnerSource} from '@swarm/api/review';
import {api,trunkPath} from '@/lib/api';
import {Button} from '@/components/controls';
import {Card} from '@/components/ui';
import {field,Notice} from './shared';
import {DeploymentRefPolicy,deploymentRefInput,deploymentRefSummary} from './DeploymentRefPolicy';
export function DeploymentEnvironments({trunk,environments,sources,onChange}:{trunk:string;environments:DeploymentEnvironment[];sources:RunnerSource[];onChange:()=>void}) {
 const {readOnly}=useTrunk();
 const [editing,setEditing]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[deleting,setDeleting]=useState(false);
 const failure=useRef<HTMLDivElement>(null),heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{if(error)failure.current?.focus();},[error]);
 useEffect(()=>{if(editing!==null)heading.current?.focus();},[editing]);
 const [members,setMembers]=useState<{userId:string;role:string}[]>([]);
 useEffect(()=>{void api<{members:typeof members}>(`${trunkPath(trunk)}/collaborators`).then(value=>setMembers(value.members)).catch(()=>{});},[trunk]);
 const existing=environments.find(e=>e.id===editing);
 async function save(form:HTMLFormElement|null,remove=false) {
  if(busy)return;setBusy(true);setError('');
  try{const values=form?new FormData(form):null;await api(`${trunkPath(trunk)}/environments${existing?`/${existing.id}`:''}`,{method:remove?'DELETE':existing?'PUT':'POST',...(remove?{}:{body:{name:String(values?.get('name')??''),reviewers:values?.getAll('reviewers').map(String).filter(Boolean)??[],preventSelfReview:values?.has('preventSelfReview')??false,waitTimerMinutes:Number(values?.get('waitTimerMinutes')??0),deploymentBranchPolicy:values?deploymentRefInput(values):undefined,...(values?.get('runner')?{runner:String(values.get('runner'))}:{})}})});setEditing(null);setDeleting(false);onChange();}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <Card className="repository-protections"><header><div><h2><Cloud size={16} aria-hidden/>Deployment environments</h2><p>Name the environments required before merging and choose who can report their deployments.</p></div><Button disabled={busy||readOnly} onClick={()=>{setEditing('');setDeleting(false);setError('');}}>New environment</Button></header>
  <ul className="divide-y divide-line">{environments.map(environment=>{const source=sources.find(s=>s.id===environment.runner);return <li className="repository-rule repository-environment-rule" key={environment.id}><Cloud size={18} aria-hidden/><div className="min-w-0 flex-1"><strong className="break-words text-sm">{environment.name}</strong><p className="break-words">{environment.runner?`${source?.name??'Unavailable runner'}${source?.revoked?' · revoked':''}`:'Any active repository runner'} · revision {environment.revision}</p><p>{environment.reviewers?.length?`${environment.reviewers.length} required reviewer${environment.reviewers.length===1?'':'s'} · one approval needed`:"No approval required"}{environment.preventSelfReview?" · self-approval blocked":""}{environment.waitTimerMinutes?` · ${environment.waitTimerMinutes.toLocaleString()} minute wait`:""}</p><p className="break-words">{deploymentRefSummary(environment.deploymentBranchPolicy)}</p></div><Button disabled={busy||readOnly} onClick={()=>{setEditing(environment.id);setDeleting(false);setError('');}}>Edit environment</Button></li>;})}</ul>
  {!environments.length&&<p className="px-4 py-6 text-sm text-muted">No deployment environments configured.</p>}
  {error&&<div ref={failure} tabIndex={-1} className="p-4 outline-none"><Notice error={error}/></div>}
  {editing!==null&&!readOnly&&<form key={editing} className="repository-protection-form space-y-4" onSubmit={event=>{event.preventDefault();void save(event.currentTarget);}}><h3 ref={heading} tabIndex={-1} className="text-sm font-semibold outline-none">{existing?'Edit environment':'New deployment environment'}</h3>
    <label className="block space-y-1 text-sm">Environment name<input className={field} name="name" required maxLength={255} defaultValue={existing?.name} readOnly={!!existing} placeholder="staging"/><span className="block text-xs text-muted">Names are case-insensitive. Create a new environment to use a different name.</span></label>
    <label className="block space-y-1 text-sm">Trusted deployment source<select className={field} name="runner" defaultValue={existing?.runner??''} disabled={busy||readOnly}><option value="">Any active repository runner</option>{sources.filter(s=>!s.revoked||s.id===existing?.runner).map(source=><option key={source.id} value={source.id}>{source.name}{source.revoked?' (revoked)':''}</option>)}</select></label>
    {!sources.some(s=>!s.revoked)&&<p className="text-xs leading-5 text-muted">No active runner registrations. Register a runner in Actions before reporting deployments.</p>}
    <DeploymentRefPolicy initial={existing?.deploymentBranchPolicy} disabled={busy||readOnly}/>
    <fieldset className="space-y-2 border-t border-line pt-4"><legend className="text-sm font-semibold">Required reviewers</legend><p className="max-w-2xl text-xs leading-5 text-muted">Choose up to six repository members. One eligible reviewer must approve before deployment. Readers can review deployments.</p>
      {[...new Set([...members.map(member=>member.userId),...(existing?.reviewers??[])])].map(id=><label key={id} className="flex min-w-0 items-start gap-2 text-sm"><input type="checkbox" name="reviewers" value={id} defaultChecked={existing?.reviewers?.includes(id)} disabled={busy||readOnly}/><span className="break-all">{id}<span className="text-muted"> · {members.find(member=>member.userId===id)?.role??'existing reviewer'}</span></span></label>)}
      {!members.length&&<label className="block space-y-1 text-xs text-muted">Reviewer account ID<input className={field} name="reviewers" maxLength={256} placeholder="Account ID from repository access" disabled={busy||readOnly}/></label>}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="preventSelfReview" defaultChecked={existing?.preventSelfReview} disabled={busy||readOnly}/>Prevent the deployment initiator from approving</label>
    </fieldset>
    <label className="block max-w-sm space-y-1 text-sm">Wait timer (minutes)<input className={field} name="waitTimerMinutes" type="number" min={0} max={43200} step={1} required defaultValue={existing?.waitTimerMinutes??0} disabled={busy||readOnly}/><span className="block text-xs leading-5 text-muted">0 disables the timer. The wait starts when the request is created, runs alongside review, and holds no sandbox.</span></label>
    <p className="max-w-2xl text-xs leading-5 text-muted">Changing any environment setting requires a fresh deployment and approval. Deployment reports identify the exact commit and comparison base; passing test checks alone do not count. These settings do not grant access to secrets.</p>
    {deleting&&<div className="space-y-2 border-t border-line pt-4"><p className="text-sm">Delete this environment? Requirements that reference it will block until an environment is configured and deployed again. Historical deployment records remain.</p><Button className="repository-danger-button" disabled={busy||readOnly} onClick={()=>void save(null,true)}>Confirm delete environment</Button><Button disabled={busy||readOnly} onClick={()=>setDeleting(false)}>Keep environment</Button></div>}
    <div className="flex flex-wrap gap-3"><Button type="submit" variant="primary" disabled={busy||readOnly}>Save environment</Button><Button disabled={busy||readOnly} onClick={()=>{setEditing(null);setError('');setDeleting(false);}}>Cancel environment</Button>{existing&&!deleting&&<Button className="repository-danger-button" disabled={busy||readOnly} onClick={()=>setDeleting(true)}>Delete environment</Button>}</div>
  </form>}
 </Card>;
}
export function RequiredEnvironments({environments,selected,onChange,disabled=false}:{environments:DeploymentEnvironment[];selected:string[];onChange:(names:string[])=>void;disabled?:boolean}) {
 const known=new Map(environments.map(e=>[e.name.toLowerCase(),e.name]));
 const names=[...new Map([...environments.map(e=>e.name),...selected].map(name=>[name.toLowerCase(),known.get(name.toLowerCase())??name])).values()];
 const selectedKeys=new Set(selected.map(name=>name.toLowerCase()));
 return <fieldset className="space-y-3 border-t border-line pt-4"><legend className="text-sm font-semibold">Required deployment environments</legend><p className="max-w-2xl text-xs leading-5 text-muted">Every selected environment must have a successful deployment of the exact candidate and current trusted workflow base before a protected update or merge. Matching requirements combine.</p>
  {!names.length&&<p className="text-xs text-muted">Create a deployment environment above before selecting requirements.</p>}
  {names.map(name=><label key={name} className="flex min-w-0 items-start gap-2 text-sm"><input type="checkbox" disabled={disabled} checked={selectedKeys.has(name.toLowerCase())} onChange={event=>onChange(event.target.checked?[...selected,name]:selected.filter(n=>n.toLowerCase()!==name.toLowerCase()))}/><span className="break-words">{name}{!environments.some(e=>e.name.toLowerCase()===name.toLowerCase())?' (unavailable)':''}</span></label>)}
 </fieldset>;
}
