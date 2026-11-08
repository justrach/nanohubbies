import {assertRepositoryWritable} from "../repository/archive";
import {Environments} from './store';
import {approvedReviewers,freshMembership,verifyDeploymentAuthorization} from './authorization';
import {deploymentRefError,requireDeploymentRef} from './ref-policy';
import {runRef,runRefTarget} from '../ci/ref';
import {defaultRef} from '../repository/default-branch';
import type {Run} from '../ci/types';
import type {DeploymentRequest,DeploymentMembership,DeploymentRequestStatus,DeploymentAuthorization} from './approval-types';
export class DeploymentRequests {
 constructor(private sql:SqlStorage){sql.exec('CREATE TABLE IF NOT EXISTS deployment_requests (id TEXT PRIMARY KEY, event_key TEXT NOT NULL UNIQUE, data TEXT NOT NULL)');sql.exec('CREATE TABLE IF NOT EXISTS deployment_authorizations (id TEXT PRIMARY KEY, event_key TEXT NOT NULL UNIQUE, data TEXT NOT NULL)');}
 get(id:string):DeploymentRequest{const row=this.sql.exec<{data:string}>('SELECT data FROM deployment_requests WHERE id=?',id).toArray()[0];if(!row)throw Error('Deployment request not found');return JSON.parse(row.data);}
 list(before?:number,limit=25){if(!Number.isSafeInteger(limit)||limit<1||limit>50||before!==undefined&&(!Number.isSafeInteger(before)||before<1))throw Error('Invalid deployment request cursor');const rows=this.sql.exec<{rowid:number;data:string}>(`SELECT rowid,data FROM deployment_requests${before?' WHERE rowid < ?':''} ORDER BY rowid DESC LIMIT ?`,...(before?[before]:[]),limit+1).toArray();return {requests:rows.slice(0,limit).map(row=>JSON.parse(row.data) as DeploymentRequest),nextCursor:rows.length>limit?rows[limit-1].rowid:null};}
 private save(request:DeploymentRequest){this.sql.exec('UPDATE deployment_requests SET data=? WHERE id=?',JSON.stringify(request),request.id);}
 private current(request:DeploymentRequest,run:Run){
  const env=new Environments(this.sql).find(request.environment);if(!env||env.id!==request.environmentId||env.revision!==request.environmentRevision||run.id!==request.run||(run.generation??1)!==request.generation||run.head!==request.head||run.base!==request.base||run.branch!==request.branch||run.state==='superseded')return;
  if(runRef(request)!==runRef(run)||runRefTarget(request)!==runRefTarget(run))return;
  const trusted=defaultRef(this.sql),refs=this.sql.exec<{name:string;commit_sha:string}>('SELECT name,commit_sha FROM repository_refs WHERE name IN (?,?)',runRef(run),trusted).toArray();if(refs.find(ref=>ref.name===runRef(run))?.commit_sha!==runRefTarget(run)||refs.find(ref=>ref.name===trusted)?.commit_sha!==run.base)return;
  return env;
 }
 private initiator(run:Run):string|null {
  if(run.initiator)return run.initiator;
  const row=this.sql.exec<{data:string}>("SELECT data FROM repository_audit WHERE json_extract(data,'$.ref')=? AND json_extract(data,'$.next')=? ORDER BY id DESC LIMIT 1",runRef(run),runRefTarget(run)).toArray()[0];return row?JSON.parse(row.data).actor??null:null;
 }
 request(run:Run,name:string,actor:string,now=Date.now(),created?:(request:DeploymentRequest)=>void):DeploymentRequest {
  assertRepositoryWritable(this.sql);
  const env=new Environments(this.sql).find(name);if(!env)throw Error(`Unknown deployment environment: ${name}`);
  requireDeploymentRef(this.sql,env,runRef(run));
  if(!['queued','running','waiting'].includes(run.state))throw Error('Retry checks before requesting this deployment');
  const event=`${env.id}:${env.revision}:${run.id}:${run.generation??1}`,prior=this.sql.exec<{data:string}>('SELECT data FROM deployment_requests WHERE event_key=?',event).toArray()[0];if(prior)return JSON.parse(prior.data);
  const request:DeploymentRequest={id:crypto.randomUUID(),run:run.id,generation:run.generation??1,environmentId:env.id,environmentRevision:env.revision,environment:env.name,head:run.head,base:run.base,branch:run.branch,ref:runRef(run),refTarget:runRefTarget(run),initiator:this.initiator(run),requestedBy:actor,createdAt:now,waitUntil:now+(env.waitTimerMinutes??0)*60000,revision:0,reviews:[]};
  if(!this.current(request,run))throw Error('Deployment candidate or environment changed; refresh');
  this.sql.exec('INSERT INTO deployment_requests VALUES (?,?,?)',request.id,event,JSON.stringify(request));created?.(request);return request;
 }
 status(request:DeploymentRequest,run:Run,proof:DeploymentMembership|undefined,actor='',now=Date.now()):DeploymentRequestStatus {
  const env=this.current(request,run),approvals=env?approvedReviewers(request,env,proof,now):[];
  let state:DeploymentRequestStatus['state']='ready',reason:string|null=null;
  if(!env){state='stale';reason='Candidate, run or environment changed; request a new deployment';}
  else if(deploymentRefError(this.sql,env,runRef(run))){state='stale';reason=deploymentRefError(this.sql,env,runRef(run));}
  else if(request.reviews.some(review=>review.decision==='reject')){state='rejected';reason='Deployment was rejected; retry checks to start a new request';}
  else if(run.state==='complete'){state='complete';}
  else if(env.reviewers?.length&&!approvals.length){state='waiting';reason=env.preventSelfReview&&!request.initiator?'The deployment initiator could not be verified; retry checks':'Waiting for an eligible required reviewer';}
  else if(now<request.waitUntil){state='waiting';reason='Waiting for the environment timer';}
  else if(request.startedAt&&run.state==='running'){state='running';}
  const canReview=!!env&&['waiting','ready'].includes(state)&&!request.startedAt&&!!env.reviewers?.includes(actor)&&freshMembership(proof,now)&&proof!.accounts[actor]==='member'&&!request.reviews.some(review=>review.actor===actor);
  const canApprove=canReview&&(!env!.preventSelfReview||!!request.initiator&&actor!==request.initiator);
  return {...request,state,reason,approvals,canReview,canApprove,reviewerAccess:proof?.accounts??{}};
 }
 review(id:string,run:Run,actor:string,decision:'approve'|'reject',comment:string,revision:number,proof:DeploymentMembership,now=Date.now()) {
  assertRepositoryWritable(this.sql);
  if(!['approve','reject'].includes(decision)||typeof comment!=='string'||comment.length>16000||!Number.isSafeInteger(revision)||revision<0)throw Error('Invalid deployment review');
  const request=this.get(id),prior=request.reviews.find(review=>review.actor===actor);
  if(prior){if(prior.decision!==decision||prior.comment!==comment)throw Error('Deployment review already recorded');return request;}
  if(request.revision!==revision)throw Error('Deployment request changed; refresh before reviewing');
  const status=this.status(request,run,proof,actor,now);
  if(!status.canReview||decision==='approve'&&!status.canApprove)throw Error('Account cannot review this deployment or self-review is prevented');
  request.reviews.push({actor,decision,comment,at:now});request.revision++;this.save(request);return request;
 }
 revalidate(id:string,authorizationId:string,run:Run,runner:string,proof:DeploymentMembership|undefined,now=Date.now()) {
  assertRepositoryWritable(this.sql);
  const request=this.get(id),env=this.current(request,run),status=this.status(request,run,proof,'',now);
  if(!env||!['ready','running'].includes(status.state)||run.state!=='running'||run.runner!==runner||run.leaseUntil<=now||env.runner&&env.runner!==runner)throw Error(status.reason??'Deployment authorization is unavailable');
  const authorization=verifyDeploymentAuthorization(this.sql,env,{authorizationId,verifiedAt:now},run,runner,proof,now);
  if(!authorization||authorization.request!==id)throw Error('Deployment authorization does not match the requested deployment');
  // This is a fresh observation, not another issuance or an extended lease.
  return {authorization,checkedAt:now};
 }
 authorize(id:string,run:Run,runner:string,proof:DeploymentMembership|undefined,now=Date.now(),issued?:(authorization:DeploymentAuthorization)=>void):DeploymentAuthorization {
  assertRepositoryWritable(this.sql);
  const request=this.get(id),env=this.current(request,run),status=this.status(request,run,proof,'',now);
  if(!env||!['ready','running'].includes(status.state)||run.state!=='running'||run.runner!==runner||run.leaseUntil<=now||env.runner&&env.runner!==runner)throw Error(status.reason??'Deployment authorization is unavailable');
  const key=`${id}:${runner}:${run.attempt}`,prior=this.sql.exec<{data:string}>('SELECT data FROM deployment_authorizations WHERE event_key=?',key).toArray()[0];if(prior)return JSON.parse(prior.data);
  const auth:DeploymentAuthorization={id:crypto.randomUUID(),request:id,run:run.id,generation:run.generation??1,environmentId:env.id,environmentRevision:env.revision,runner,attempt:run.attempt,issuedAt:now,expiresAt:run.leaseUntil,reviewers:status.approvals};
  this.sql.exec('INSERT INTO deployment_authorizations VALUES (?,?,?)',auth.id,key,JSON.stringify(auth));issued?.(auth);request.startedAt=now;this.save(request);return auth;
 }
}
