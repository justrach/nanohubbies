export interface DeploymentMembership { accounts:Record<string,'member'|'absent'|'unavailable'>; checkedAt:number; expiresAt:number }
export interface DeploymentReview { actor:string; decision:'approve'|'reject'; comment:string; at:number }
export interface DeploymentRequest {
 id:string; run:string; generation:number; environmentId:string; environmentRevision:number; environment:string;
 head:string; base:string; branch:string; initiator:string|null; requestedBy:string;
 ref?:string; refTarget?:string;
 createdAt:number; waitUntil:number; revision:number; reviews:DeploymentReview[]; startedAt?:number;
}
export interface DeploymentRequestStatus extends DeploymentRequest {
 state:'waiting'|'ready'|'running'|'complete'|'rejected'|'stale'; reason:string|null;
 approvals:string[]; canReview:boolean; canApprove:boolean; reviewerAccess:DeploymentMembership['accounts'];
}
export interface DeploymentAuthorization {
 id:string; request:string; run:string; generation:number; environmentId:string; environmentRevision:number;
 runner:string; attempt:number; issuedAt:number; expiresAt:number; reviewers:string[];
}
