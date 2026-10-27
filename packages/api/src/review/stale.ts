import { Policies } from "../repository/policy";
import type { Pull, Review } from "./types";

type Candidate = { commit: string; tree: string; anchor: string; anchorTree: string };
type Audit = (event: Record<string,unknown>) => void;
/** Called within the same transaction as the accepted ref/comparison change.
 * Dismissal is irreversible: pushing the old tree back cannot revive a review. */
export function dismissChangedApprovals(sql: SqlStorage, pull: Pull, candidate: Candidate, audit: Audit) {
  const policy=new Policies(sql).get(pull.base);
  if (!policy || policy.dismissStaleReviews === false) return;
  const rows=sql.exec<{id:number;data:string}>("SELECT id,data FROM review_reviews WHERE pull = ? ORDER BY id",pull.number).toArray();
  const at=Date.now(),reason="The pull request's files or comparison base changed after this approval.";
  for(const row of rows) {
    const review: Review={...JSON.parse(row.data),id:row.id};
    if(review.verdict!=="APPROVE"||review.dismissed)continue;
    const sameHead=review.tree ? review.tree===candidate.tree : review.commit===candidate.commit;
    const sameBase=review.anchorTree ? review.anchorTree===candidate.anchorTree : review.anchor===candidate.anchor;
    if(sameHead&&sameBase)continue;
    review.dismissed={actor:{id:"system:review-policy",name:"Nanohub"},reason,at,kind:"stale"};
    sql.exec("UPDATE review_reviews SET data = ? WHERE id = ? AND pull = ?",JSON.stringify(review),review.id,pull.number);
    audit({actor:"system:review-policy",dismissal:{pull:pull.number,review:review.id,branch:pull.base,reason,previousVerdict:review.verdict,automatic:true}});
  }
}

export function dismissAfterHeadChange(sql: SqlStorage, branch: string, next: {commit:string;tree:string}, audit: Audit) {
  if(!sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='review_reviews'").toArray().length)return;
  const pulls=sql.exec<{number:number;data:string}>("SELECT number,data FROM review_pulls").toArray();
  for(const row of pulls) {
    const pull:Pull={...JSON.parse(row.data),number:row.number};
    if(pull.state==="open"&&pull.head===branch)
      dismissChangedApprovals(sql,pull,{...next,anchor:pull.anchor,anchorTree:pull.anchorTree},audit);
  }
}
