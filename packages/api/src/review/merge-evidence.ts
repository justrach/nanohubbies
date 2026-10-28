import type {RefProof} from "../repository/types";

/** A generated merge may reuse deployments of its exact reviewed tree only
 * through a trusted, old/new-bound merge proof. Ordinary pushes cannot opt in. */
export function reviewedMergeHead(proof:RefProof|undefined,old:string|null,next:string):string {
  const evidence=proof?.merge;
  if(!evidence)return next;
  if(evidence.version!==1||!["merge","squash","rebase"].includes(evidence.method)||!old||proof.old!==old||proof.next!==next||evidence.base!==old||evidence.result!==next||evidence.head===next||![evidence.base,evidence.head,evidence.result,evidence.tree].every(sha=>/^[a-f0-9]{40}$/.test(sha)))throw Error("Invalid generated merge evidence; refresh and retry");
  return evidence.head;
}
