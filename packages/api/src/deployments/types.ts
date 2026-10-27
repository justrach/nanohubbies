export interface DeploymentRefPolicy {mode:'all'|'protected'|'selected';rules?:{type:'branch'|'tag';name:string}[]}
export interface DeploymentEnvironment { id:string; name:string; revision:number; runner?:string; reviewers?:string[]; preventSelfReview?:boolean; waitTimerMinutes?:number; deploymentBranchPolicy?:DeploymentRefPolicy; createdAt:number; updatedAt:number }
export interface EnvironmentInput { name:string; runner?:string; reviewers?:string[]; preventSelfReview?:boolean; waitTimerMinutes?:number; deploymentBranchPolicy?:DeploymentRefPolicy }
/** The runner identity and environment revision are always server-derived. */
export interface DeploymentReport {
  authorizationId?:string; environment:string; head:string; base:string; state:"success"|"failure"|"cancelled";
  deploymentId:string; url:string; verifiedAt:number;
}
export interface DeploymentRecord extends DeploymentReport {
  id:number; environmentId:string; environmentRevision:number; runner:string;
  run:string; attempt:number; at:number;
  ref?:string; refTarget?:string;
}
export interface EnvironmentStatus { name:string; ready:boolean; error:string|null; deployment:DeploymentRecord|null }
export interface DeploymentGate { ready:boolean; required:string[]; environments:EnvironmentStatus[] }
