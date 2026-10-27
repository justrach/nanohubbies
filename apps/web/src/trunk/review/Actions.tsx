"use client";
import {
  Play,
  Clock,
  Search,
  LoaderCircle,
  CheckCircle2,
  XCircle,
  CircleSlash,
  CircleDot,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { ActionRun, DeploymentEnvironment } from "@swarm/api/review";
import { runConclusion, conclusionLabel } from "@swarm/api/review";
import { DeploymentReviews } from "./DeploymentReviews";
import {useTrunk} from "../context";
import { api, trunkPath } from "@/lib/api";
import { Card } from "@/components/ui";
import { Button } from "@/components/controls";
const filters = [
  ["all", "All workflow runs"],
  ["queued", "Queued"],
  ["running", "In progress"],
  ["waiting", "Waiting for deployment"],
  ["complete", "Completed"],
  ["superseded", "Superseded"],
] as const;
function status(run: ActionRun) {
  if (run.state === "queued")
    return { Icon: Clock, label: "Queued", color: "text-muted" };
  if (run.state === "waiting")
    return { Icon: Clock, label: "Waiting for deployment", color: "text-muted" };
  if (run.state === "running")
    return { Icon: LoaderCircle, label: "In progress", color: "text-series-1" };
  if (run.state === "superseded")
    return { Icon: CircleSlash, label: "Superseded", color: "text-muted" };
  const conclusion = runConclusion([...run.results,...(run.deployments??[])]);
  if (!conclusion) return { Icon: CircleDot, label: "Completed", color: "text-muted" };
  if (conclusion === "success") return { Icon: CheckCircle2, label: conclusionLabel(conclusion), color: "text-good-text" };
  if (["neutral", "skipped", "cancelled"].includes(conclusion)) return { Icon: CircleSlash, label: conclusionLabel(conclusion), color: "text-muted" };
  return { Icon: XCircle, label: conclusionLabel(conclusion), color: "text-critical" };
}
export function Actions({
  trunk,
  initial,
}: {
  trunk: string;
  initial: { runs: ActionRun[]; canConfigure: boolean; canRequestDeployment?:boolean; environments?:DeploymentEnvironment[] };
}) {
  const {readOnly}=useTrunk();
  const [filter, setFilter] = useState("all"),
    [query, setQuery] = useState("");
  const [data, setData] = useState(initial),
    [error, setError] = useState(""),
    [token, setToken] = useState(""),
    [busy, setBusy] = useState(false);
  const [reviewRevision,setReviewRevision]=useState(0);
  const [runnerName,setRunnerName]=useState("codegraff-actions");
  const [registrations,setRegistrations]=useState<{id:string;name:string;revoked:boolean;active:number}[]>([]);
  const path = trunkPath(trunk);
  async function refreshRunners(){
    const r=await api<{registrations:typeof registrations}>(path+"/ci/runners");setRegistrations(r.registrations);
  }
  useEffect(() => {
    if(initial.canConfigure)void refreshRunners().catch(e=>setError(e.message));
    const timer = setInterval(
      () =>
        !document.hidden && void api<typeof initial>(path + "/repository")
          .then(next=>{setData(next);if(next.canConfigure)void refreshRunners().catch(e=>setError(e.message));else setRegistrations([]);})
          .catch((e) => setError(e.message)),
      10000,
    );
    return () => clearInterval(timer);
  }, [path]);
  async function act(operation: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await operation();
      setData(await api(path + "/repository"));
      if(data.canConfigure)await refreshRunners();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const runs = data.runs.filter(
    (run) =>
      (filter === "all" || run.state === filter) &&
      `${run.branch} ${run.head} ${run.id}`
        .toLowerCase()
        .includes(query.toLowerCase().trim()),
  );
  return (
    <main className="repository-actions mx-auto max-w-5xl">
      <aside className="repository-actions-sidebar">
        <h1>Actions</h1>
        <nav aria-label="Workflow run filters">
          {filters.map(([value, label]) => (
            <button
              key={value}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              <Play size={16} aria-hidden />
              {label}
              <span>
                {value === "all"
                  ? data.runs.length
                  : data.runs.filter((run) => run.state === value).length}
              </span>
            </button>
          ))}
        </nav>
        <div className="repository-actions-note">
          <p>Powered by Codegraff</p>
          <span>Each job runs in a disposable sandbox.</span>
        </div>
      </aside>
      <div className="repository-actions-main space-y-4">
        <header>
          <h2>{filters.find(([value]) => value === filter)?.[1]}</h2>
          <p>Runs are pinned to the pushed commit and comparison base.</p>
        </header>
        <label className="repository-list-search">
          <Search size={16} aria-hidden />
          <input
            aria-label="Filter workflow runs"
            placeholder="Filter by branch, commit, or run ID"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <DeploymentReviews key={reviewRevision} trunk={trunk} onChange={()=>void api<typeof initial>(path+"/repository").then(setData).catch(e=>setError(e.message))}/>
        {error && (
          <p role="alert" className="text-sm text-critical">
            {error}
          </p>
        )}
        {!data.runs.length && (
          <Card className="space-y-3 p-5">
            <h2 className="font-medium">No workflow runs yet</h2>
            <p className="text-sm text-muted">
              Commit a workflow in <code>.github/workflows</code>, then push a
              branch. Configure a trusted Codegraff dispatcher to claim queued
              runs.
            </p>
          </Card>
        )}
        {!!data.runs.length && !runs.length && (
          <Card className="p-8 text-center text-sm text-muted">
            No workflow runs match this filter.
          </Card>
        )}
        {runs.map((run) => {
          const state = status(run);
          return (
            <Card key={run.id} className="repository-action-run space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <state.Icon size={18} className={state.color} aria-hidden />
                <code className="min-w-0 break-all font-semibold">{run.branch}</code>
                {run.ref?.startsWith('refs/tags/')&&<span className="text-xs text-muted">Tag</span>}
                <code className="text-xs">{run.head.slice(0, 7)}</code>
                <span className="text-sm text-muted">
                  {state.label} · attempt {run.attempt}
                </span>
                {data.canConfigure && (
                  <Button
                    disabled={
                      readOnly || busy ||
                      run.state === "running" ||
                      run.state === "superseded"
                    }
                    onClick={() =>
                      void act(() =>
                        api(path + "/ci/retry", { body: { runId: run.id } }),
                      )
                    }
                  >
                    Rerun checks
                  </Button>
                )}
                {data.canConfigure&&<Button disabled={readOnly||busy||run.state==="running"||run.state==="superseded"||!!run.deploymentApprovedBy&&run.state==="queued"} onClick={()=>void act(()=>api(path+"/ci/approve",{body:{runId:run.id}}))}>{run.deploymentApprovedBy?"Retry staging":"Approve staging"}</Button>}
              </div>
              <p className="text-xs text-muted">
                Base {run.base.slice(0, 7)} ·{" "}
                {new Date(run.createdAt).toLocaleString()}
              </p>
              {!readOnly&&data.canRequestDeployment&&!!data.environments?.length&&['queued','running','waiting'].includes(run.state)&&<details className="border-t border-line pt-3"><summary className="cursor-pointer text-sm text-series-1">Request deployment review</summary><form className="space-y-3 pt-3" onSubmit={event=>{event.preventDefault();const environment=String(new FormData(event.currentTarget).get('environment'));void act(async()=>{await api(path+'/deployment-requests',{body:{runId:run.id,environment}});setReviewRevision(value=>value+1);});}}><p className="max-w-2xl text-xs leading-5 text-muted">Start this environment’s review and timer for the exact candidate. The trusted runner still performs and verifies deployment.</p><div className="flex flex-wrap items-end gap-3"><label className="block min-w-0 space-y-1 text-sm">Environment<select className="block min-h-9 max-w-full rounded border border-line bg-page px-2" name="environment" disabled={busy}>{data.environments.map(environment=><option key={environment.id} value={environment.name}>{environment.name}</option>)}</select></label><Button type="submit" disabled={busy}>Request review</Button></div></form></details>}
              <ul className="divide-y divide-line">
                {run.results.map((check) => (
                  <li className="space-y-1 py-3 text-sm" key={check.name}>
                    <div className="flex min-w-0 flex-wrap gap-3">
                      <strong className="min-w-0 break-all">{check.name}</strong>
                      <span>{conclusionLabel(check.state)}</span>
                      {check.log&&<a
                        className="ml-auto underline"
                        target="_blank"
                        rel="noreferrer"
                        href={check.log}
                      >
                        Logs
                      </a>}
                    </div>
                    {check.execution && (
                      <p className="text-xs text-muted">
                        Codegraff sandbox{" "}
                        <code>{check.execution.sandboxId}</code> ·{" "}
                        {check.execution.workflow}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              {!!run.deployments?.length&&<section aria-label="Reported deployments" className="space-y-2 border-t border-line pt-3"><h3 className="text-sm font-semibold">Deployments</h3>{run.deployments.map(deployment=><p key={deployment.environment} className="break-words text-sm">{deployment.environment} · {deployment.state} · <a className="text-series-1 underline underline-offset-2" href={deployment.url} target="_blank" rel="noreferrer">{deployment.deploymentId}</a></p>)}</section>}
            </Card>
          );
        })}
        {data.canConfigure && (
          <details className="repository-runner-settings rounded-md border border-line p-4">
            <summary className="cursor-pointer text-sm font-semibold">
              Runner configuration
            </summary>
            <div className="space-y-3 pt-4">
              <p className="text-sm text-muted">
                Multiple trusted workers can share this repository’s queue.
                Each candidate is leased once; independent jobs run in separate
                Codegraff sandboxes. Set the pool’s concurrency to match the
                Nanohub account’s available capacity.
              </p>
              <p className="text-xs leading-5 text-muted">Keep repository runner credentials and the Codegraff account key in the trusted dispatcher. Candidate jobs receive neither. A shared pool can serve multiple repositories with a separate credential for each.</p>
              <label className="block space-y-1 text-xs text-muted">Runner registration name<input className="block h-8 rounded border border-line bg-page px-2 text-sm text-ink" value={runnerName} maxLength={80} pattern="[a-zA-Z0-9_.-]+" onChange={e=>setRunnerName(e.target.value)}/></label>
              <Button
                disabled={readOnly||busy||!/^[\w.-]{1,80}$/.test(runnerName)}
                onClick={() =>
                  void act(async () => {
                    const r = await api<{ token: string }>(
                      path + "/ci/runners",
                      {
                        body: { name: runnerName },
                      },
                    );
                    setToken(r.token);
                  })
                }
              >
                Create runner credential
              </Button>
              {token && (
                <div className="flex gap-3">
                  <input
                    aria-label="Runner credential"
                    type="password"
                    autoComplete="off"
                    readOnly
                    value={token}
                    className="min-w-0 flex-1 rounded border border-line p-2"
                  />
                  <Button
                    onClick={() => void navigator.clipboard.writeText(token)}
                  >
                    Copy once
                  </Button>
                  <Button onClick={() => setToken("")}>Hide</Button>
                </div>
              )}
              {registrations.length>0&&<ul className="divide-y divide-line text-xs">{registrations.map(r=><li key={r.id} className="flex flex-wrap items-center gap-3 py-3"><span className="min-w-0 flex-1 break-all font-medium">{r.name}</span><span className="text-muted">{r.revoked?"Revoked":`${r.active} active candidates`}</span>{!r.revoked&&<Button size="sm" disabled={busy} onClick={()=>void act(()=>api(path+"/ci/"+r.id,{method:"DELETE"}))}>Revoke</Button>}</li>)}</ul>}
              <p className="text-xs text-muted">A registration may serve several worker processes. Revoke releases its running candidates for another worker to retry.</p>
            </div>
          </details>
        )}
      </div>
    </main>
  );
}
