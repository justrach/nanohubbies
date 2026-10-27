"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReviewSnapshot } from "@swarm/api/review";
import {useTrunk} from "../context";
import { Protections } from "./Protections";
import { Rulesets } from "./Rulesets";
import { ProtectionActivity } from "./ProtectionActivity";
import {DeploymentEnvironments} from "./DeploymentEnvironments";
import { RuleInsights } from "./RuleInsights";

export function RepositoryRules({trunk,initial}:{trunk:string;initial:ReviewSnapshot}) {
  const {readOnly}=useTrunk();
  const [data,setData]=useState(initial),router=useRouter();
  useEffect(()=>setData(initial),[initial]);
  return <main className="repository-rules-page space-y-5">
    <nav aria-label="Repository settings" className="flex gap-5 border-b border-line pb-3 text-sm"><Link className="text-muted hover:text-ink" href={`/t/${trunk}/people`}>General and access</Link><span className="font-semibold" aria-current="page">Rules</span><Link className="ml-auto text-muted hover:text-ink" href={`/t/${trunk}/branches`}>Branches</Link></nav>
    <header><h1 className="text-xl font-semibold tracking-tight">Repository rules</h1><p className="mt-1 text-sm text-muted">Control how branches, tags and files can change.</p></header>
    {data.canProtect&&data.repositoryMode&&<DeploymentEnvironments trunk={trunk} environments={data.environments??[]} sources={data.ciSources??[]} onChange={()=>router.refresh()}/>}
    <Protections defaultBranch={data.defaultBranch} environments={data.environments??[]} trunk={trunk} git={!!data.repositoryMode} rules={data.policies??[]} sources={data.ciSources??[]} canEdit={!!data.canProtect&&!readOnly} onChange={policies=>{setData({...data,policies});router.refresh();}}/>
    {data.repositoryMode&&<Rulesets environments={data.environments??[]} trunk={trunk} rules={data.rulesets??[]} canEdit={!!data.canProtect&&!readOnly} onChange={rulesets=>{setData({...data,rulesets});router.refresh();}}/>}
    {data.canProtect&&<ProtectionActivity key={trunk} trunk={trunk} onRestored={()=>router.refresh()}/>}
    {data.canProtect&&data.repositoryMode&&<RuleInsights key={`${trunk}:${JSON.stringify(data.rulesets)}`} trunk={trunk}/>}
  </main>;
}
