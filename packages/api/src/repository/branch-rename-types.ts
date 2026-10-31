export interface BranchRenameInput {from:string;to:string;commit:string;revision:string}
export interface BranchRenameConfiguration {
 protocol:1;mode:'git'|'snapshot';defaultBranch:string;revision:string;
 conditionalWrites:true;revisionTracking:'storage';cliAudit:true;
 branches:{name:string;commit:string;tree:string;updatedAt:number}[];
}
export interface BranchRenamePreview extends BranchRenameInput {
 defaultBranch:boolean;requiresAdmin:boolean;retargetedPulls:number[];closedPulls:number[];
 protectionFollows:boolean;updatedRulesets:number[];
}
