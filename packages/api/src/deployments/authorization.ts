import type {DeploymentEnvironment,DeploymentReport} from './types';
import type {DeploymentRequest,DeploymentAuthorization,DeploymentMembership} from './approval-types';
import {runRef,runRefTarget} from '../ci/ref';
export const protectedEnvironment=(env:DeploymentEnvironment)=>!!env.reviewers?.length||!!env.waitTimerMinutes||!!env.deploymentBranchPolicy&&env.deploymentBranchPolicy.mode!=='all';
export const freshMembership=(proof:DeploymentMembership|undefined,now:number)=>!!proof&&Number.isFinite(proof.checkedAt)&&proof.checkedAt<=now+1000&&now-proof.checkedAt<=30000&&proof.expiresAt>now;
export function approvedReviewers(request:DeploymentRequest,env:DeploymentEnvironment,proof:DeploymentMembership|undefined,now:number) {
 if(!freshMembership(proof,now))return [];
 return request.reviews.filter(review=>review.decision==='approve'&&env.reviewers?.includes(review.actor)&&(!env.preventSelfReview||!!request.initiator&&review.actor!==request.initiator)&&proof!.accounts[review.actor]==='member').map(review=>review.actor);
}
/** The ID is a receipt, not a bearer credential. The authenticated CI lease,
 * current environment, exact run generation and current approvers must agree. */
export function verifyDeploymentAuthorization(sql:SqlStorage,env:DeploymentEnvironment,report:Pick<DeploymentReport,'authorizationId'|'verifiedAt'>,run:{id:string;head:string;base:string;generation?:number;attempt:number;branch:string;ref?:string;refTarget?:string},runner:string,proof:DeploymentMembership|undefined,now:number):DeploymentAuthorization|undefined {
 if(!protectedEnvironment(env)&&!report.authorizationId)return;
 if(typeof report.authorizationId!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(report.authorizationId))throw Error(`Deployment environment ${env.name} requires authorization before deployment`);
 if(!sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='deployment_authorizations'").toArray().length)throw Error('Deployment authorization unavailable');
 const row=sql.exec<{data:string}>('SELECT data FROM deployment_authorizations WHERE id=?',report.authorizationId).toArray()[0],auth:DeploymentAuthorization|undefined=row&&JSON.parse(row.data);
 const requestRow=auth&&sql.exec<{data:string}>('SELECT data FROM deployment_requests WHERE id=?',auth.request).toArray()[0],request:DeploymentRequest|undefined=requestRow&&JSON.parse(requestRow.data);
 if(!auth||!request||request.run!==run.id||request.head!==run.head||request.base!==run.base||request.environmentId!==env.id||auth.environmentId!==env.id||auth.environmentRevision!==env.revision||request.environmentRevision!==env.revision||auth.run!==run.id||auth.generation!==(run.generation??1)||request.generation!==auth.generation||auth.runner!==runner||auth.attempt!==run.attempt||auth.expiresAt<=now||auth.issuedAt>report.verifiedAt||request.waitUntil>auth.issuedAt||request.reviews.some(review=>review.decision==='reject'))throw Error('Deployment authorization expired or changed; request authorization again');
 if(runRef(request)!==runRef(run)||runRefTarget(request)!==runRefTarget(run))throw Error('Deployment ref identity changed; request authorization again');
 if(env.reviewers?.length&&!approvedReviewers(request,env,proof,now).some(id=>auth.reviewers.includes(id)))throw Error('Deployment approver is no longer an eligible repository member');
 return auth;
}
