"use client";

import {useTrunk} from "../context";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { GitPullRequest, ArrowDown } from "lucide-react";
import type { Branch, Pull, ReviewSnapshot } from "@swarm/api/review";
import { checkFailure, conclusionLabel } from "@swarm/api/review";
import { Button } from "@/components/controls";
import { Card, Pill } from "@/components/ui";
import { useSession } from "@/lib/session";
import type { ChangedFile } from "../types";
import { field, Notice, useReviewAction } from "./shared";
import { DismissReview } from "./DismissReview";
import { PullFiles } from "./PullFiles";
import { AgentContributions } from "../contributions/AgentContributions";
import {RelatedPullReviews} from "./RelatedPullReviews";
import {MergeAction} from "./MergeAction";
import {RequestedReviewers} from './RequestedReviewers';

export type PullView = ReviewSnapshot & { pull: Pull; head: Branch; files: ChangedFile[]; truncated: string[];deployments?:import("@swarm/api/review").DeploymentGate;signatures?:import("@swarm/api/review").SignatureGate;pendingReview?:import("@swarm/api/review").PendingReview|null;discussion?:import("@swarm/api/review").PullDiscussion;codeOwners?:import("@swarm/api/review").CodeOwnerStatus;canDismissReviews?:boolean;reviewGate?:import("@swarm/api/review").ReviewGate };

export function PullDetail({ trunk, view }: { trunk: string; view: PullView }) {
  const router = useRouter(), action = useReviewAction(trunk);
  const { user } = useSession();
  const {readOnly}=useTrunk();
  const p = view.pull, base = view.branches.find((b) => b.name === p.base);
  const parents: Pull[] = [], seen = new Set<number>([p.number]);
  for (let current = p;;) {
    const found = view.pulls.find((q) => current.parent ? q.number === current.parent : q.state === "open" && q.head === current.base);
    if (!found || seen.has(found.number)) break;
    parents.unshift(found); seen.add(found.number); current = found;
  }
  const children = view.pulls.filter((q) => q.state === "open" && (q.base === p.head || q.parent === p.number));
  const observed = { commit: view.head.commit, anchor: p.anchor };
  const run = (operation: string, extra: Record<string, unknown> = {}) => action.run(`/pulls/${p.number}/${operation}`, { ...observed, ...extra }, () => router.refresh());
  const reviews = view.reviews.filter((r) => r.pull === p.number);
  const policy = view.effectivePolicies?.[p.base] ?? view.policies?.find(rule => rule.branch === p.base);
  const currentRun = view.runs?.find(run => run.head === view.head.commit && run.base === (p.state === "merged" ? p.mergedCIBase??p.mergedBase : view.ciBase??base?.commit) && run.branch === p.head && run.state === "complete");
  const reportedSource = view.ciSources?.find(source=>source.id===currentRun?.runner);
  const checkErrors = policy?.checks.map(name=>checkFailure(currentRun,name,policy.checkSources,view.ciSources,policy.successOnlyChecks)).filter((error):error is string=>!!error)??[];
  const missing = policy?.checks.filter(name=>checkFailure(currentRun,name,policy.checkSources,view.ciSources,policy.successOnlyChecks))??[];
  const ownershipBlocked=!!view.codeOwners?.required&&(!!view.codeOwners.error||view.codeOwners.missing>0);
  return <main className="mx-auto max-w-[1440px] space-y-5 px-5 py-8">
    <div className="flex items-center justify-between"><Link href={`/t/${trunk}/pulls`} className="text-xs text-muted hover:text-ink">← Pull requests</Link><Button size="sm" variant="ghost" onClick={() => router.refresh()}>Refresh</Button></div>
    <header className="space-y-3"><h1 className="text-2xl font-semibold tracking-tight text-ink">{p.title} <span className="font-normal text-muted">#{p.number}</span></h1>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted"><Pill>{p.state}</Pill><span>{p.author.name}</span><code>{p.base} ← {p.head}</code><code>{view.head.commit.slice(0, 7)}</code></div>
      {p.body && <p className="max-w-3xl whitespace-pre-wrap text-sm leading-6 text-ink-2">{p.body}</p>}
    </header>
    <Notice error={action.error} />
    <details><summary className="cursor-pointer text-sm text-series-1">Agent contributions</summary><div className="mt-3"><AgentContributions trunk={trunk} pull={p.number} commit={view.head.commit} /></div></details>
    {policy && <Card className="space-y-2 p-5 text-xs text-muted"><h2 className="text-sm font-semibold text-ink">Branch protection</h2>
      <p>Requires {policy.approvals} independent {policy.approvals===1?"approval":"approvals"}{policy.dismissStaleReviews===false?"; earlier approvals carry forward":" on the reviewed files and comparison base"}. {policy.pullRequest ? "Pull requests required." : ""} {policy.preventForce ? policy.allowForcePush?.length?`Force pushes limited to ${policy.allowForcePush.length} selected ${policy.allowForcePush.length===1?"account":"accounts"}.`:"Force pushes blocked." : ""} {policy.preventDelete ? "Deletion blocked." : ""}</p>
      <p>{policy.locked ? "Branch locked. " : ""}{policy.requireLinearHistory ? "Linear history required. " : ""}{policy.requireLastPushApproval ? "Latest file-changing push requires a different approver. " : ""}{policy.requireConversationResolution ? "All review conversations must be resolved." : ""}</p>
      <p>{p.state === "merged" ? "Merged with the recorded candidate checks." : missing.length ? `Waiting for checks: ${missing.join(", ")}` : policy.checks.length ? "Required checks are satisfied." : "No required checks configured."}</p>
      {!!currentRun?.results.length&&<p className="break-words">Current required-check results: {currentRun.results.filter(result=>policy.checks.includes(result.name)).map(result=>`${result.name} · ${conclusionLabel(result.state)}`).join("; ")||"No named result reported"}</p>}
      {p.state!=="merged"&&!!policy.checkSources?.length&&<ul className="space-y-1">{checkErrors.map(error=><li key={error} className="break-words">{error}</li>)}</ul>}
      {currentRun && <p className="break-all">Candidate <code>{currentRun.head}</code> · workflow base <code>{currentRun.base}</code> · run <code>{currentRun.id}</code></p>}
      {currentRun&&<p className="break-words">Check source: {reportedSource?.name??"Unknown registration"}{reportedSource?.revoked?" · revoked":""} {currentRun.runner&&<code>{currentRun.runner}</code>}</p>}
      {currentRun?.staging && <p>Staging deployment {currentRun.staging.runId} · verified build {currentRun.staging.version} · {currentRun.staging.acceptance.map((e, i) => <a key={e.url} href={e.url} className="underline">Evidence {i + 1} </a>)}</p>}
    </Card>}
    {!!view.deployments?.required.length&&<section aria-label="Required deployments" className="space-y-3 border-y border-line py-4"><h2 className="text-sm font-semibold">Required deployments{p.state==="merged"?" · recorded at merge":""}</h2><ul className="space-y-4">{view.deployments.environments.map(environment=><li key={environment.name} className="min-w-0 space-y-1 text-sm"><p className="break-words font-medium">{environment.name} · {environment.ready?"Deployed successfully":"Deployment required"}</p>{environment.error&&<p className="max-w-3xl break-words text-muted">{environment.error}</p>}{environment.deployment&&<><p className="break-all text-xs text-muted">Deployment {environment.deployment.deploymentId} · source {view.ciSources?.find(source=>source.id===environment.deployment!.runner)?.name??environment.deployment.runner}</p><p className="break-all font-mono text-xs text-muted">Candidate {environment.deployment.head} · base {environment.deployment.base}</p><a href={environment.deployment.url} className="text-xs text-series-1 underline underline-offset-2" target="_blank" rel="noreferrer">View deployment</a></>}</li>)}</ul></section>}
    {view.signatures?.required&&<section aria-label="Commit signatures" className="space-y-2 border-y border-line py-4"><h2 className="text-sm font-semibold">Commit signatures</h2><p className="text-sm text-muted">{view.signatures.verified?`${view.signatures.checked} introduced commits verified.`:`Signed commits required: ${view.signatures.error??"signature verification is unavailable"}`}</p></section>}
    {view.codeOwners && (view.codeOwners.required || view.codeOwners.groups.length > 0) && <section aria-label="Code owner review" className="space-y-3 rounded border border-line p-5">
      <h2 className="text-sm font-semibold">Code owner review{!view.codeOwners.required ? " · optional" : ""}</h2>
      <p className="text-sm text-muted">{p.state === "merged" ? "Recorded ownership from the merged candidate’s base branch." : "Ownership comes from the base branch, including when this pull request changes CODEOWNERS."}</p>
      <p className="text-sm text-muted">{view.codeOwners.file ? view.codeOwners.error ? `${view.codeOwners.file} · ownership check unavailable.` : `${view.codeOwners.file} · ${view.codeOwners.missing} ownership ${view.codeOwners.missing===1?"group":"groups"} awaiting approval.` : "No CODEOWNERS file exists on the base branch. No code owner approvals are assigned."}</p>
      {view.codeOwners.error && <p role="alert" className="text-sm">Cannot verify code owners: {view.codeOwners.error}</p>}
      <ul className="divide-y divide-line">{view.codeOwners.groups.map(group=><li key={group.line} className="space-y-1 py-3 text-sm">
        <p className="break-words"><code>{group.pattern}</code> · line {group.line} · {group.files} changed {group.files===1?"file":"files"}</p>
        <p className="break-words text-muted">{group.owners.join(", ")} · {group.eligibleOwners.length ? group.approved ? "Approved" : "Approval required" : group.approved ? "No eligible owner assigned" : "Owner mapping required"}</p>
        <p className="break-all font-mono text-xs text-muted">{group.paths.join(", ")}{group.files>group.paths.length?", …":""}</p>
      </li>)}</ul>
      {view.codeOwners.warnings.length>0 && <details><summary className="cursor-pointer text-xs text-series-1">Ownership notices ({view.codeOwners.warnings.length})</summary><ul className="mt-2 space-y-1 text-xs text-muted">{view.codeOwners.warnings.map((warning,index)=><li key={index}>{warning.line?`Line ${warning.line}: `:""}{warning.message}</li>)}</ul></details>}
    </section>}
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="space-y-4 p-5"><h2 className="text-sm font-semibold text-ink">{p.state === "merged" ? `Merged into ${p.base}` : p.state === "closed" ? "Closed without merging" : "Ready for review"}</h2>
        <p className="text-xs leading-5 text-muted">{p.state === "merged" ? `Merged as ${p.mergedCommit?.slice(0,10)}. Dependent PRs now target ${p.base}.` : p.state === "closed" ? "The final diff is retained below." : !view.repositoryMode&&p.base !== "main" ? `Merge the PR for ${p.base} first. This diff includes only this layer’s changes.` : `Merge updates ${p.base} through its current protection and conflict checks.`}</p>
        {p.state === "open" && <div className="flex flex-wrap gap-2">
          <MergeAction key={`${trunk}/${p.number}/${view.mergeSettings?.revision??"legacy"}`} defaultMethod={view.mergeSettings?.defaultMethod} readOnly={readOnly||!user||view.canMerge===false} permissionDenied={!readOnly&&!!user&&view.canMerge===false} methods={view.mergeMethods??["fast-forward"]} disabled={readOnly || !user || !view.repositoryMode&&p.base !== "main" || missing.length > 0 || !!policy?.locked || ownershipBlocked || view.deployments?.ready===false || !!view.signatures?.required&&!view.signatures.verified || view.reviewGate?.ready===false} busy={action.busy} signedRequired={!!view.signatures?.required} onMerge={(method,message)=>void run("merge",{method,...(view.mergeSettings?{mergeSettingsRevision:view.mergeSettings.revision}:{}),...(method!=="fast-forward"?{targetBase:base?.commit}:{}),...(message!==undefined?{message}:{})})}/>
          <Button disabled={readOnly || !user || view.canManagePulls===false || action.busy || base?.commit === p.anchor} onClick={() => void run("restack")}>Restack onto {p.base}</Button>
          <Button variant="ghost" disabled={readOnly || !user || view.canManagePulls===false || action.busy} onClick={() => void run("close")}>Close</Button>
        </div>}
        {p.state==="open"&&view.reviewGate?.error&&<p className="text-sm text-muted" role="status">{view.reviewGate.error}</p>}
        {p.state==="open"&&!!view.reviewGate?.sharedHeadBlockers?.length&&<RelatedPullReviews trunk={trunk} blockers={view.reviewGate.sharedHeadBlockers} />}
        {p.state === "open" && base?.commit !== p.anchor && <p className="text-xs text-muted">The base moved. Restack replays this layer on its latest commit; competing edits are left for you to resolve locally. Fetch the updated branch afterward.</p>}
      </Card>
      <aside className="min-w-0 space-y-4" aria-label="Pull request details"><RequestedReviewers trunk={trunk} pull={p.number} commit={view.head.commit} anchor={p.anchor} open={p.state==='open'} readOnly={!!readOnly}/>
      <Card className="p-5"><h2 className="mb-3 text-sm font-semibold text-ink">PR stack</h2><div className="space-y-2 text-xs">
        <span className="text-muted">{parents[0]?.base??p.base}</span>{[...parents, p].map((q) => <div key={q.number}><ArrowDown size={12} className="my-2 text-muted" />
          <Link href={`/t/${trunk}/pulls/${q.number}`} aria-current={q.number === p.number ? "page" : undefined} className={`flex items-start gap-2 rounded-md p-2 ${q.number === p.number ? "bg-wash text-ink" : "text-muted hover:text-ink"}`}>
            <GitPullRequest size={14} className="mt-0.5 shrink-0" /><span>#{q.number} {q.title} {q.state === "merged" && "· merged"}<code className="mt-1 block break-all text-[11px] text-muted">{q.head}</code></span></Link></div>)}
        {children.length > 0 && <div className="border-t border-line pt-3"><p className="mb-2 text-muted">Dependent PRs</p>{children.map((q) => <Link key={q.number} href={`/t/${trunk}/pulls/${q.number}`} className="block py-1 text-series-1">#{q.number} {q.title}</Link>)}</div>}
      </div></Card></aside>
    </div>
    <section aria-label="Changed files"><div className="mb-4 flex flex-wrap gap-4 text-xs text-muted"><span>{view.files.length} changed files</span><span className="text-series-1">+{view.files.reduce((n, f) => n + f.additions, 0)}</span><span>−{view.files.reduce((n, f) => n + f.deletions, 0)}</span>{view.truncated.map((t) => <span key={t}>{t}</span>)}</div>
      <PullFiles trunk={trunk} pull={p.number} commit={view.head.commit} anchor={p.anchor} files={view.files} initial={view.discussion??{comments:[],truncated:false}} initialPending={view.pendingReview??null} open={p.state==="open"} git={!!view.repositoryMode}/>
    </section>
    <section id="pull-review-decision" className="scroll-mt-6"><Card className="p-5"><h2 className="mb-4 text-sm font-semibold text-ink">Reviews</h2>
      {!reviews.length && <p className="mb-4 text-xs text-muted">No reviews yet.</p>}
      <ul className="space-y-4">{reviews.map((r) => <li key={r.id} id={`review-${r.id}`} tabIndex={-1} className="scroll-mt-4 border-b border-line pb-4 text-sm"><div className="flex flex-wrap gap-2"><strong className="text-ink">{r.author.name}</strong><span className="text-xs text-muted">{r.dismissed?r.dismissed.kind==="stale"?"automatically dismissed · originally ":"dismissed · originally ":""}{r.verdict.toLowerCase().replaceAll("_", " ")}</span>
        {r.via?.kind==="cli"&&<span className="text-xs text-muted">via CLI</span>}{(r.commit !== view.head.commit || r.anchor !== p.anchor) && <span className="text-xs text-muted">· {policy?.dismissStaleReviews===false&&r.verdict==="APPROVE"&&!r.dismissed?"approval carried forward":"earlier revision"}</span>}</div><p className="mt-2 whitespace-pre-wrap break-words text-ink-2">{r.body}</p>{!!r.commentIds?.length&&<p className="mt-2 text-xs text-muted">{r.commentIds.length} inline {r.commentIds.length===1?"comment":"comments"}</p>}
        {!r.dismissed&&r.verdict==="APPROVE"&&view.reviewGate?.reviewerAccess?.[r.author.id]==="no_write"&&<p className="mt-2 text-xs text-muted">Approval not counted: this reviewer no longer has repository write access.</p>}
        {!r.dismissed&&r.verdict==="APPROVE"&&view.reviewGate?.reviewerAccess?.[r.author.id]==="unavailable"&&<p className="mt-2 text-xs text-muted">Approval not counted: current write access could not be verified.</p>}
        {r.dismissed&&<div role="status" className="mt-3 space-y-1 text-sm"><p className="text-xs text-muted">Dismissed by {r.dismissed.actor.name} · <time dateTime={new Date(r.dismissed.at).toISOString()}>{new Date(r.dismissed.at).toLocaleString()}</time></p><p className="whitespace-pre-wrap break-words text-ink-2">{r.dismissed.reason}</p></div>}
        {!readOnly&&view.canDismissReviews&&p.state==="open"&&!r.dismissed&&r.verdict!=="COMMENT"&&<DismissReview trunk={trunk} pull={p.number} review={r.id} author={r.author.name}/>}
      </li>)}</ul>
      {view.pendingReview&&<p className="mt-4 text-sm text-muted">Your inline feedback is pending. <a href="#pending-review" className="underline">Finish your review</a> to publish it with a decision.</p>}
      {!readOnly && user && view.canReview!==false && p.state === "open" && !view.pendingReview && <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); const form = new FormData(e.currentTarget); void run("reviews", { verdict: form.get("verdict"), body: form.get("body") }); }}>
        <label className="block space-y-1 text-xs text-muted">Review<textarea className={field} name="body" rows={3} maxLength={16000} placeholder="Leave feedback on this revision" /></label>
        <div className="flex flex-wrap gap-3"><select aria-label="Review decision" className={field + " max-w-56"} name="verdict"><option value="COMMENT">Comment</option><option value="APPROVE">Approve</option><option value="REQUEST_CHANGES">Request changes</option></select><Button disabled={action.busy} type="submit">Submit review</Button></div>
      </form>}
      {!readOnly&&user&&view.canReview===false&&p.state==="open"&&<p className="mt-4 text-sm text-muted">Repository write access is required to submit a review.</p>}
    </Card></section>
  </main>;
}
