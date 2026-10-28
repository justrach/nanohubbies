import {Policies} from "../repository/policy";
import type {Pull,Review,ReviewSnapshot,SharedHeadReviewBlocker} from "./types";

/** Called on current storage inside the final serialized merge transaction.
 * Follow live branch refs, not the PR's recorded opening/last-reviewed SHA. */
export function sharedHeadReviewBlockers(sql:SqlStorage,pull:Pull,head:string,snapshot:ReviewSnapshot):SharedHeadReviewBlocker[] {
  const policy=new Policies(sql).get(pull.base);
  if(pull.state!=="open"||!policy||!(policy.pullRequest||policy.approvals||policy.requireLastPushApproval||policy.requireCodeOwnerReview))return [];
  const branches=new Map(snapshot.branches.map(branch=>[branch.name,branch.commit]));
  const peers=snapshot.pulls.filter(peer=>peer.number!==pull.number&&peer.state==="open"&&branches.get(peer.head)===head);
  if(!peers.length)return [];
  const ids=new Set(peers.map(peer=>peer.number)),latest=new Map<number,Map<string,Review>>();
  for(const review of snapshot.reviews)if(ids.has(review.pull)&&review.verdict!=="COMMENT") {
    const people=latest.get(review.pull)??new Map<string,Review>();
    if(!people.has(review.author.id)||people.get(review.author.id)!.id<review.id)people.set(review.author.id,review);
    latest.set(review.pull,people);
  }
  // Only PR numbers cross the private-draft boundary. All drafts count until
  // submitted/discarded or their PR closes, including earlier-diff drafts.
  const pending=new Set(sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='review_drafts'").toArray().length
    ?sql.exec<{pull:number}>("SELECT DISTINCT pull FROM review_drafts").toArray().map(row=>row.pull):[]);
  return peers.map(peer=>({number:peer.number,changesRequested:[...(latest.get(peer.number)?.values()??[])].some(review=>!review.dismissed&&review.verdict==="REQUEST_CHANGES"),pendingReview:pending.has(peer.number)}))
    .filter(peer=>peer.changesRequested||peer.pendingReview).sort((a,b)=>a.number-b.number);
}

export function sharedHeadReviewMessage(blockers:SharedHeadReviewBlocker[]) {
  const first=blockers[0];
  if(!first)return null;
  const reason=first.changesRequested&&first.pendingReview?"requested changes and a pending review":first.changesRequested?"requested changes":"a pending review";
  return `Resolve ${reason} in pull request #${first.number} at the same head commit before merging${blockers.length>1?` (${blockers.length} related pull requests are blocked)`:""}`;
}

export function requireSharedHeadReviews(sql:SqlStorage,pull:Pull,head:string,snapshot:ReviewSnapshot) {
  const message=sharedHeadReviewMessage(sharedHeadReviewBlockers(sql,pull,head,snapshot));
  if(message)throw Error(message);
}
