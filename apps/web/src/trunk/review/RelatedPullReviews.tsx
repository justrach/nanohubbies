import Link from "next/link";
import type {ReviewGate} from "@swarm/api/review";

export function RelatedPullReviews({trunk,blockers}:{trunk:string;blockers:NonNullable<ReviewGate["sharedHeadBlockers"]>}) {
  if(!blockers.length)return null;
  const items=(rows:typeof blockers)=><ul className="space-y-2">{rows.map(blocker=><li key={blocker.number} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
    <Link href={`/t/${trunk}/pulls/${blocker.number}`} className="text-series-1 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink">Pull request #{blocker.number}</Link>
    <span className="text-muted">{blocker.changesRequested&&blocker.pendingReview?"Changes requested; review pending":blocker.changesRequested?"Changes requested":"Review pending"}</span>
  </li>)}</ul>;
  return <section aria-labelledby="related-review-heading" className="space-y-3 border-t border-line pt-4">
    <h3 id="related-review-heading" className="text-sm font-semibold text-ink">Related reviews block this merge</h3>
    <p className="max-w-prose text-sm leading-6 text-muted">These open pull requests point to the same commit. Finish their reviews or close them before merging.</p>
    {items(blockers.slice(0,10))}
    {blockers.length>10&&<details className="space-y-3 text-sm"><summary className="cursor-pointer text-series-1">Show {blockers.length-10} more related pull requests</summary>{items(blockers.slice(10))}</details>}
  </section>;
}
