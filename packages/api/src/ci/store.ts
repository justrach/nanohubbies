import {ArchiveStore,archiveLocked,assertRepositoryWritable} from "../repository/archive";
import {validCheckResults} from "./validation";
import type {DeploymentMembership} from "../deployments/approval-types";
import { Environments } from "../deployments/store";
import type { DeploymentReport } from "../deployments/types";
import { createHash, randomBytes } from "node:crypto";

import type { Run, CheckResult, StagingEvidence } from "./types";
import type { CheckSource } from "../repository/types";
import { checkFailure } from "./check-gate";
import { passingCheck } from "./conclusions";
export type { Run, CheckResult, StagingEvidence } from "./types";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const secret = (prefix: string) => prefix + randomBytes(32).toString("hex");
export class CIStore {
  constructor(private sql: SqlStorage) {
    sql.exec("CREATE TABLE IF NOT EXISTS ci_runners (id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0)");
    sql.exec("CREATE TABLE IF NOT EXISTS ci_runs (id TEXT PRIMARY KEY, event_key TEXT NOT NULL UNIQUE, data TEXT NOT NULL, lease_hash TEXT)");
    sql.exec("CREATE INDEX IF NOT EXISTS ci_run_queue ON ci_runs(json_extract(data,'$.state'),json_extract(data,'$.leaseUntil'))");
    sql.exec("CREATE INDEX IF NOT EXISTS ci_run_runner ON ci_runs(json_extract(data,'$.runner'),json_extract(data,'$.state'))");
  }
  registrations() {
    return this.sql.exec<{id:string;name:string;revoked:number;active:number}>("SELECT r.id,r.name,r.revoked,(SELECT count(*) FROM ci_runs WHERE json_extract(data,'$.runner')=r.id AND json_extract(data,'$.state')='running' AND json_extract(data,'$.leaseUntil')>?) AS active FROM ci_runners r ORDER BY r.rowid DESC",Date.now()).toArray().map(r=>({...r,revoked:!!r.revoked}));
  }
  sources(): import("./types").RunnerSource[] {
    return this.sql.exec<{id:string;name:string;revoked:number}>("SELECT id,name,revoked FROM ci_runners ORDER BY rowid DESC").toArray().map(source=>({...source,revoked:!!source.revoked}));
  }
  runner(name: string) {
    assertRepositoryWritable(this.sql);
    if (typeof name !== "string" || !/^[\w.-]{1,80}$/.test(name)) throw new Error("Invalid runner name");
    const id = crypto.randomUUID(), token = secret("nhci_");
    this.sql.exec("INSERT INTO ci_runners (id, hash, name) VALUES (?, ?, ?)", id, hash(token), name);
    return { id, name, token };
  }
  revoke(id: string) {
    this.sql.exec("UPDATE ci_runners SET revoked=1 WHERE id=?", id);
    // Release this registration's work immediately so another pool worker can
    // take over. Old read tokens and completion attempts lose authority.
    this.sql.exec("UPDATE ci_runs SET data=json_set(data,'$.state','queued','$.runner',NULL,'$.leaseUntil',0,'$.generation',COALESCE(json_extract(data,'$.generation'),1)+1,'$.results',json('[]'),'$.environmentWait',NULL),lease_hash=NULL WHERE json_extract(data,'$.runner')=? AND json_extract(data,'$.state') IN ('running','waiting')",id);
  }
  authenticate(token: string) {
    const row = this.sql.exec<{ id: string }>("SELECT id FROM ci_runners WHERE hash=? AND revoked=0", hash(token)).toArray()[0];
    if (!row) throw new Error("Invalid CI runner credential");
    return row.id;
  }
  list(): Run[] { return this.sql.exec<{ data: string }>("SELECT data FROM ci_runs ORDER BY rowid DESC LIMIT 200").toArray().map(r => JSON.parse(r.data)); }
  get(id: string): Run {
    const row = this.sql.exec<{ data: string }>("SELECT data FROM ci_runs WHERE id=?", id).toArray()[0];
    if (!row) throw new Error("No such CI run");
    return JSON.parse(row.data);
  }
  private save(run: Run) { this.sql.exec("UPDATE ci_runs SET data=? WHERE id=?", JSON.stringify(run), run.id); }
  enqueue(branch: string, head: string, base: string,initiator?:string,tag?:{ref:string;target:string}) {
    assertRepositoryWritable(this.sql);
    if(tag&&(tag.ref!==`refs/tags/${branch}`||!/^[a-f0-9]{40}$/.test(tag.target)||!/^[a-f0-9]{40}$/.test(head)))throw Error('Invalid trusted tag CI context');
    const key = tag?`${tag.ref}:${tag.target}:${head}:${base}`:`${branch}:${head}:${base}`;
    const existing = this.sql.exec<{ data: string }>("SELECT data FROM ci_runs WHERE event_key=?", key).toArray()[0];
    if (existing) {
      const prior: Run = JSON.parse(existing.data);
      if (prior.state === "superseded") {
        prior.generation=(prior.generation??1)+1;if(initiator)prior.initiator=initiator;else delete prior.initiator;delete prior.environmentWait;prior.deploymentApprovedBy = null; prior.state = "queued"; prior.results = []; prior.staging = null; prior.deployments=[]; prior.runner = null; prior.leaseUntil = 0;
        this.save(prior); this.sql.exec("UPDATE ci_runs SET lease_hash=NULL WHERE id=?", prior.id);
      }
      return prior;
    }
    const run: Run = { id: crypto.randomUUID(), branch, head, base,...(tag?{ref:tag.ref,refTarget:tag.target}:{}), state: "queued", generation:1,...(initiator?{initiator}:{}), deploymentApprovedBy: null, attempt: 0, leaseUntil: 0, runner: null, results: [], staging: null, createdAt: Date.now() };
    this.sql.exec("INSERT INTO ci_runs (id,event_key,data) VALUES (?,?,?)", run.id, key, JSON.stringify(run));
    return run;
  }
  approveDeployment(id: string, actor: string, currentHead: string | undefined, currentBase: string | undefined) {
    assertRepositoryWritable(this.sql);
    const run = this.get(id);
    if (run.head !== currentHead || run.base !== currentBase || run.state === "superseded") throw new Error("Candidate changed; refresh before approving staging");
    if (run.state === "running") throw new Error("Wait for current checks before approving the staging run");
    run.generation=(run.generation??1)+1;delete run.environmentWait;if(actor!=="retry")run.initiator=actor;run.deploymentApprovedBy = actor; run.state = "queued"; run.results = []; run.staging = null; run.deployments=[]; run.runner = null; run.leaseUntil = 0;
    this.save(run); this.sql.exec("UPDATE ci_runs SET lease_hash=NULL WHERE id=?", run.id);
    return run;
  }
  retry(id:string,currentHead:string|undefined,currentBase:string|undefined,initiator?:string) {
    const run=this.approveDeployment(id,"retry",currentHead,currentBase);run.deploymentApprovedBy=null;if(initiator)run.initiator=initiator;this.save(run);return run;
  }
  baseMoved(base: string) {
    this.sql.exec("UPDATE ci_runs SET data=json_set(data,'$.state','superseded'),lease_hash=NULL WHERE json_extract(data,'$.base')<>? AND json_extract(data,'$.state') IN ('queued','running','waiting')",base);
  }
  supersede(branch: string, head: string | null) {
    this.supersedeRef(`refs/heads/${branch}`,head);
  }
  supersedeRef(ref:string,target:string|null) {
    this.sql.exec("UPDATE ci_runs SET data=json_set(data,'$.state','superseded'),lease_hash=NULL WHERE COALESCE(json_extract(data,'$.ref'),'refs/heads/'||json_extract(data,'$.branch'))=? AND (? IS NULL OR COALESCE(json_extract(data,'$.refTarget'),json_extract(data,'$.head'))<>?) AND json_extract(data,'$.state')<>'superseded'",ref,target,target);
  }
  claim(token: string, now = Date.now(),waiting:string[]=[],ready?:(run:Run)=>boolean) {
    const runner = this.authenticate(token);
    if(archiveLocked(new ArchiveStore(this.sql).state()))return null;
    // The UI history window is not a queue limit. Claims are serialized by
    // the sequencer transaction, even across processes sharing a credential.
    const row = this.sql.exec<{data:string}>("SELECT data FROM ci_runs WHERE json_extract(data,'$.state')='queued' OR (json_extract(data,'$.state')='running' AND json_extract(data,'$.leaseUntil')<=?) OR (json_extract(data,'$.state')='waiting' AND json_extract(data,'$.runner')=? AND id IN (SELECT value FROM json_each(?))) ORDER BY rowid LIMIT 1",now,runner,JSON.stringify(waiting)).toArray()[0];
    if (!row) return null;
    const run:Run=JSON.parse(row.data);
    if(run.state==="waiting"&&(!ready||!ready(run)))return null;
    run.state = "running"; run.runner = runner; run.attempt++; run.leaseUntil = now + 2 * 60 * 60_000;
    const readToken = secret("nhread_");
    this.save(run);
    this.sql.exec("UPDATE ci_runs SET lease_hash=? WHERE id=?", hash(readToken), run.id);
    return { ...run, readToken };
  }
  waiting(token:string) {
    const runner=this.authenticate(token);if(archiveLocked(new ArchiveStore(this.sql).state()))return [];this.sql.exec("CREATE TABLE IF NOT EXISTS ci_wait_cursors (runner TEXT PRIMARY KEY, cursor INTEGER NOT NULL)");
    const cursor=this.sql.exec<{cursor:number}>("SELECT cursor FROM ci_wait_cursors WHERE runner=?",runner).toArray()[0]?.cursor??0;
    const rows=this.sql.exec<{rowid:number;data:string}>("SELECT rowid,data FROM ci_runs WHERE rowid>? AND json_extract(data,'$.state')='waiting' AND json_extract(data,'$.runner')=? ORDER BY rowid LIMIT 32",cursor,runner).toArray();
    this.sql.exec("INSERT INTO ci_wait_cursors VALUES (?,?) ON CONFLICT(runner) DO UPDATE SET cursor=excluded.cursor",runner,rows.length===32?rows.at(-1)!.rowid:0);
    return rows.map(row=>JSON.parse(row.data) as Run);
  }
  defer(token:string,id:string,attempt:number,request:string,results:CheckResult[]) {
    assertRepositoryWritable(this.sql);
    this.logAccess(token,id,attempt);const run=this.get(id);
    if(!validCheckResults(results)||JSON.stringify(results).length>100000||results.some(result=>!passingCheck(result)))throw Error("Only passing checks or an unstarted pipeline may wait for deployment");
    run.results=results;run.state="waiting";run.environmentWait=request;run.leaseUntil=0;this.save(run);this.sql.exec("UPDATE ci_runs SET lease_hash=NULL WHERE id=?",id);return run;
  }
  rejectEnvironment(id:string,request:string,environment:string) {
    const run=this.get(id);if(run.state!=="waiting"||run.environmentWait!==request)return;
    run.state="complete";run.leaseUntil=0;const name=`environment/${environment}`;run.results=[...run.results.filter(result=>result.name!==name),{name,state:"failure",command:"Required deployment review rejected",log:"",artifacts:[]}];this.save(run);this.sql.exec("UPDATE ci_runs SET lease_hash=NULL WHERE id=?",run.id);
  }
  cancelForArchive() {
    const results=[{name:"repository-archive",state:"cancelled",command:"Repository archived; explicitly rerun after unarchiving",log:"",artifacts:[]}];
    this.sql.exec("UPDATE ci_runs SET data=json_set(data,'$.state','complete','$.leaseUntil',0,'$.generation',COALESCE(json_extract(data,'$.generation'),1)+1,'$.results',json(?),'$.environmentWait',NULL,'$.staging',NULL,'$.deployments',json('[]'),'$.deploymentApprovedBy',NULL),lease_hash=NULL WHERE json_extract(data,'$.state') IN ('queued','running','waiting')",JSON.stringify(results));
  }
  logAccess(token:string,id:string,attempt:number) {
    const runner=this.authenticate(token),run=this.get(id);assertRepositoryWritable(this.sql);
    if(run.runner!==runner || run.attempt!==attempt || run.state!=="running" || run.leaseUntil<=Date.now())throw new Error("Expired or superseded CI log lease");
    return true;
  }
  readable(token: string, now = Date.now()) {
    if(archiveLocked(new ArchiveStore(this.sql).state()))return false;
    const row = this.sql.exec<{ data: string }>("SELECT data FROM ci_runs WHERE lease_hash=?", hash(token)).toArray()[0];
    if (!row) return false;
    const run: Run = JSON.parse(row.data);
    return run.state === "running" && run.leaseUntil > now && !!this.sql.exec("SELECT 1 FROM ci_runners WHERE id=? AND revoked=0", run.runner).toArray().length;
  }
  complete(token: string, id: string, attempt: number, results: CheckResult[], staging: StagingEvidence | null, now = Date.now(), deployments:DeploymentReport[] = [],membership?:DeploymentMembership) {
    const runner = this.authenticate(token), run = this.get(id);assertRepositoryWritable(this.sql);
    if (run.runner !== runner || run.attempt !== attempt) throw new Error("Stale CI delivery attempt");
    if(JSON.stringify({results,staging,deployments}).length>100000||!Array.isArray(deployments)||deployments.length>30||new Set(deployments.map(report=>typeof report?.environment==="string"?report.environment.toLowerCase():null)).size!==deployments.length||!validCheckResults(results))throw Error("Invalid check results");
    if (run.state === "complete") {
      if (JSON.stringify(run.results) !== JSON.stringify(results) || JSON.stringify(run.staging) !== JSON.stringify(staging) || JSON.stringify(run.deployments??[])!==JSON.stringify(deployments)) throw new Error("Conflicting completion retry");
      return run;
    }
    if (run.state !== "running" || run.leaseUntil <= now) throw new Error("Expired or superseded CI run");
    if (staging && (staging.head !== run.head || staging.candidate !== run.head || staging.base !== run.base || staging.version !== run.head
      || (staging.observedBuildId !== undefined && ![run.head,run.head.slice(0,7)].includes(staging.observedBuildId))
      || !staging.runId || !Number.isSafeInteger(staging.verifiedAt) || staging.verifiedAt < run.createdAt || staging.verifiedAt > now + 30_000
      || !Array.isArray(staging.acceptance) || !staging.acceptance.length || staging.acceptance.some(e => !e.url || e.realService !== true))) throw new Error("Staging must verify this exact candidate, deployment run and real-service acceptance evidence");
    if (results.some(r => r.name === "staging" && r.state === "success") && !staging) throw new Error("Successful staging requires deployment/version/acceptance evidence");
    const environments=new Environments(this.sql), reports=[...deployments];
    if(!deployments.length&&staging&&run.deploymentApprovedBy&&results.some(result=>result.name==="staging"&&result.state==="success")&&environments.find("staging")&&!reports.some(report=>report.environment.toLowerCase()==="staging"))reports.push({environment:"staging",head:run.head,base:run.base,state:"success",deploymentId:staging.runId,url:staging.acceptance[0].url,verifiedAt:staging.verifiedAt});
    if(reports.length)environments.record(reports,run,runner,now,membership);
    run.results = results; run.staging = staging; run.deployments=deployments; run.state = "complete"; this.save(run);
    return run;
  }
  require(branch: string, head: string, base: string, names: string[], pins: CheckSource[] = [],successOnly=false) {
    if (!names.length) return;
    const row=this.sql.exec<{data:string}>("SELECT data FROM ci_runs WHERE event_key=? AND json_extract(data,'$.state')='complete'",`${branch}:${head}:${base}`).toArray()[0];
    const run:Run|undefined=row?JSON.parse(row.data):undefined;
    const sources = pins.length ? this.sources() : [];
    for (const name of names) {
      const error = checkFailure(run,name,pins,sources,successOnly);
      if (error) throw new Error(`${error} for candidate ${head.slice(0, 7)} on base ${base.slice(0, 7)}`);
    }
    return run;
  }
}
