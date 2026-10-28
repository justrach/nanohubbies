import {assertRepositoryWritable} from "./archive";
import {Environments,environmentNames} from "../deployments/store";
import type { Pull, Review } from "../review/types";
import type { ReviewerMembership } from "../review/reviewer-types";
import { matchesBranch, branchPattern } from "./pattern";
import type { BranchPolicy, RefProof } from "./types";
import { CIStore } from "../ci/store";
import {defaultCommit} from "./default-branch";
import {reviewedMergeHead} from "../review/merge-evidence";
export type { BranchPolicy } from "./types";

/** Only authenticated settings routes call set(). Final writes read SQL again. */
export class Policies {
  constructor(private sql: SqlStorage,private membership?:ReviewerMembership) {
    sql.exec(
      "CREATE TABLE IF NOT EXISTS branch_policies (branch TEXT PRIMARY KEY, data TEXT NOT NULL)",
    );
    const existingCounter=sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='branch_policy_revision'").toArray().length>0;
    sql.exec("CREATE TABLE IF NOT EXISTS branch_policy_revision (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL)");
    sql.exec("INSERT OR IGNORE INTO branch_policy_revision VALUES (1,0)");
    const triggers=["insert","update","delete"] as const;
    const installed=sql.exec<{n:number}>("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name IN ('branch_policy_revision_insert','branch_policy_revision_update','branch_policy_revision_delete')").toArray()[0].n;
    if(installed!==triggers.length) {
      // Invalidate exports made before the storage fence existed. Bump before
      // installation: an interrupted migration can safely invalidate again.
      if(existingCounter)sql.exec("UPDATE branch_policy_revision SET revision=revision+1 WHERE id=1");
      for(const event of triggers)sql.exec(`CREATE TRIGGER IF NOT EXISTS branch_policy_revision_${event} AFTER ${event.toUpperCase()} ON branch_policies BEGIN UPDATE branch_policy_revision SET revision=revision+1 WHERE id=1; END`);
    }
  }
  revision():number {return this.sql.exec<{revision:number}>("SELECT revision FROM branch_policy_revision WHERE id=1").toArray()[0].revision;}
  list(): BranchPolicy[] {
    return this.sql
      .exec<{ data: string }>(
        "SELECT data FROM branch_policies ORDER BY branch",
      )
      .toArray()
      .map((r) => JSON.parse(r.data));
  }
  /** Overlapping rules compose; adding an exact rule cannot weaken a glob. */
  get(branch: string): BranchPolicy | undefined {
    const matches = this.list().filter((p) => matchesBranch(p.branch, branch));
    if (!matches.length) return;
    const allowed = matches
      .filter((p) => p.allowPush !== undefined)
      .map((p) => p.allowPush!);
    const forceRules=matches.filter(p=>p.preventForce);
    const forceActors=forceRules.some(p=>p.allowForcePush!==undefined)?(forceRules[0].allowForcePush??[]).filter(id=>forceRules.every(p=>p.allowForcePush?.includes(id))):undefined;
    const dismissers = matches.filter(p => p.allowDismiss !== undefined).map(p => p.allowDismiss!);
    return {
      branch,
      pullRequest: matches.some((p) => p.pullRequest),
      approvals: Math.max(...matches.map((p) => p.approvals)),
      checks: [...new Set(matches.flatMap((p) => p.checks))],
      successOnlyChecks: matches.some(p=>p.successOnlyChecks===true),
      beforeOpen: [...new Set(matches.flatMap((p) => p.beforeOpen))],
      ...(matches.some(p=>p.checkSources?.length) ? {checkSources:[...new Map(matches.flatMap(p=>p.checkSources??[]).map(pin=>[`${pin.name}:${pin.runner}`,pin])).values()]} : {}),
      ...(matches.some(p=>p.environments?.length)?{environments:environmentNames(matches.flatMap(p=>p.environments??[]),100)}:{}),
      preventForce: forceRules.length>0,
      ...(forceActors===undefined?{}:{allowForcePush:forceActors}),
      preventDelete: matches.some((p) => p.preventDelete),
      locked: matches.some((p) => p.locked),
      requireLastPushApproval: matches.some((p) => p.requireLastPushApproval),
      requireConversationResolution: matches.some(
        (p) => p.requireConversationResolution,
      ),
      requireLinearHistory: matches.some((p) => p.requireLinearHistory),
      requireCodeOwnerReview: matches.some((p) => p.requireCodeOwnerReview),
      requireSignedCommits: matches.some(p=>p.requireSignedCommits),
      dismissStaleReviews: matches.some(p=>p.dismissStaleReviews !== false),
      ...(dismissers.length ? { allowDismiss: dismissers[0].filter(id => dismissers.every(ids => ids.includes(id))) } : {}),
      ...(allowed.length
        ? {
            allowPush: allowed[0].filter((id) =>
              allowed.every((a) => a.includes(id)),
            ),
          }
        : {}),
    };
  }
  set(p: BranchPolicy) {
    assertRepositoryWritable(this.sql);
    if (
      !p ||
      !Number.isInteger(p.approvals) ||
      p.approvals < 0 ||
      p.approvals > 20 ||
      ![p.pullRequest, p.preventForce, p.preventDelete].every(
        (v) => typeof v === "boolean",
      ) ||
      ![p.checks, p.beforeOpen].every(
        (a) =>
          Array.isArray(a) &&
          a.length <= 30 &&
          a.every(
            (n) =>
              typeof n === "string" && /^[a-zA-Z0-9][\w./-]{0,99}$/.test(n),
          ),
      ) ||
      ![
        p.locked,
        p.requireLastPushApproval,
        p.requireConversationResolution,
        p.requireLinearHistory,
        p.requireCodeOwnerReview,
        p.requireSignedCommits,
        p.dismissStaleReviews,
        p.successOnlyChecks,
      ].every((v) => v === undefined || typeof v === "boolean") ||
      ![p.allowPush,p.allowDismiss,p.allowForcePush].every(ids => ids === undefined ||
        (Array.isArray(ids) &&
          ids.length <= 100 &&
          ids.every(
            (id) =>
              typeof id === "string" &&
              id.length > 0 &&
              id.length <= 256 &&
              !/[\r\n\0]/.test(id),
          )))
    )
      throw Error("Invalid branch policy");
    if(p.allowForcePush!==undefined&&!p.preventForce)throw Error("Selected force-push accounts require force-push blocking; omit the list to allow all writers");
    if(p.successOnlyChecks===undefined&&this.list().find(existing=>existing.branch===p.branch)?.successOnlyChecks===true)throw Error("Include successOnlyChecks explicitly when replacing a success-only policy");
    branchPattern(p.branch);
    const environments=p.environments===undefined?undefined:new Environments(this.sql).resolve(p.environments);
    if (p.checkSources !== undefined) {
      if (!Array.isArray(p.checkSources) || p.checkSources.length > 60 || new Set(p.checkSources.map(pin=>pin?.name)).size !== p.checkSources.length ||
        p.checkSources.some(pin=>!pin || typeof pin !== "object" || Object.keys(pin).some(key=>!["name","runner"].includes(key)) ||
          typeof pin.name !== "string" || ![...p.checks,...p.beforeOpen].includes(pin.name) || typeof pin.runner !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(pin.runner))) throw Error("Expected check sources must name distinct required checks and runner registrations");
      const sources = new CIStore(this.sql).sources();
      if (p.checkSources.some(pin=>!sources.some(source=>source.id===pin.runner))) throw Error("Expected check source is not a runner registered in this repository");
    }
    if (
      !this.list().some((r) => r.branch === p.branch) &&
      this.list().length >= 100
    )
      throw Error("At most 100 branch protection rules");
    // Store known fields only; request bodies cannot introduce bypass flags.
    const value: BranchPolicy = {
      branch: p.branch,
      pullRequest: p.pullRequest,
      approvals: p.approvals,
      checks: [...new Set(p.checks)],
      successOnlyChecks:p.successOnlyChecks??false,
      beforeOpen: [...new Set(p.beforeOpen)],
      ...(p.checkSources?.length ? {checkSources:p.checkSources.map(pin=>({name:pin.name,runner:pin.runner}))} : {}),
      ...(environments?.length?{environments}:{}),
      preventForce: p.preventForce,
      preventDelete: p.preventDelete,
      locked: p.locked ?? false,
      requireLastPushApproval: p.requireLastPushApproval ?? false,
      requireConversationResolution: p.requireConversationResolution ?? false,
      requireLinearHistory: p.requireLinearHistory ?? false,
      requireCodeOwnerReview: p.requireCodeOwnerReview ?? false,
      requireSignedCommits: p.requireSignedCommits ?? false,
      dismissStaleReviews: p.dismissStaleReviews ?? true,
      ...(p.allowForcePush===undefined?{}:{allowForcePush:[...new Set(p.allowForcePush)]}),
      ...(p.allowDismiss === undefined ? {} : { allowDismiss: [...new Set(p.allowDismiss)] }),
      ...(p.allowPush === undefined
        ? {}
        : { allowPush: [...new Set(p.allowPush)] }),
    };
    this.sql.exec(
      "INSERT INTO branch_policies VALUES (?,?) ON CONFLICT(branch) DO UPDATE SET data=excluded.data",
      p.branch,
      JSON.stringify(value),
    );
    return this.list();
  }
  remove(pattern: string) {
    assertRepositoryWritable(this.sql);
    branchPattern(pattern);
    this.sql.exec("DELETE FROM branch_policies WHERE branch = ?", pattern);
    return this.list();
  }
  restrictions(
    branch: string,
    actor: string,
    deleting: boolean,
    old: string | null,
    next: string | null,
    proof?: RefProof,
    deploymentBase?:string|null,
  ) {
    const p = this.get(branch);
    if (!p) return;
    if (p.locked) throw Error(`${branch}: branch is locked`);
    if(next&&p.environments?.length){const base=deploymentBase===undefined?defaultCommit(this.sql):deploymentBase;if(!base)throw Error("Current deployment base is unavailable");new Environments(this.sql).require(p.environments,reviewedMergeHead(proof,old,next),base);}
    if(old&&next&&p.requireSignedCommits&&(!proof||proof.old!==old||proof.next!==next||!proof.signatures?.verified))throw Error(`${branch}: requires verified signed commits${proof?.signatures?.reason?`; ${proof.signatures.reason}`:"; retry with current signature evidence"}`);
    if (p.allowPush !== undefined && !p.allowPush.includes(actor))
      throw Error(
        `${branch}: account is not allowed to update this protected branch`,
      );
    if (deleting && p.preventDelete)
      throw Error(`${branch}: protected branch cannot be deleted`);
    if (
      next &&
      p.requireLinearHistory &&
      (!proof || proof.old !== old || proof.next !== next || !proof.linear)
    )
      throw Error(
        `${branch}: requires linear history without introduced merge commits`,
      );
  }
  direct(
    branch: string,
    deleting = false,
    fastForward = false,
    actor = "",
    old: string | null = null,
    next: string | null = null,
    proof?: RefProof,
    deploymentBase?:string|null,
  ) {
    const p = this.get(branch);
    if (!p) return;
    this.restrictions(branch, actor, deleting, old, next, proof,deploymentBase);
    if (deleting) return;
    if (p.preventForce && !fastForward && !p.allowForcePush?.includes(actor))
      throw Error(`${branch}: protected branch requires a fast-forward update`);
    if (
      p.pullRequest ||
      p.approvals ||
      p.checks.length ||
      p.requireLastPushApproval ||
      p.requireConversationResolution
      || p.requireCodeOwnerReview
    )
      throw Error(
        `${branch}: protected branch requires a reviewed pull request and its required checks`,
      );
  }
  reviews(branch: string, pull: Pull, reviews: Review[], head: string) {
    const p = this.get(branch), { latest, latestPush, approved } = this.reviewState(pull,reviews,head);
    if ([...latest.values()].some((r) => !r.dismissed && r.verdict === "REQUEST_CHANGES"))
      throw Error("Resolve requested changes before merging");
    const history = this.history(pull);
    const required = p?.approvals ?? 0;
    if (approved.length < required) {
      if(this.membership&&Object.values(this.membership.accounts).includes("unavailable"))throw Error("Current reviewer write access could not be verified; refresh or ask the reviewer to reconnect");
      throw Error(
        `Requires ${required} independent ${required===1?"approval":"approvals"}${p?.dismissStaleReviews===false?"":" on the reviewed files and comparison base"}; has ${approved.length}`,
      );
    }
    if (p?.requireLastPushApproval) {
      const last = latestPush;
      if (
        !last?.actor ||
        !approved.some(
          (r) => r.author.id !== last.actor && r.pushEvent === last.id && this.currentDiff(r,pull,head),
        )
      )
        throw Error(
          "Requires approval of the latest push by someone other than its pusher",
        );
    }
    if (p?.requireConversationResolution && this.sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='pull_comments'").toArray().length &&
      this.sql.exec<{data:string}>("SELECT data FROM pull_comments WHERE pull = ?", pull.number).toArray().some(row => {
        const comment = JSON.parse(row.data);
        return !comment.replyTo && !comment.resolved;
      })) throw Error("Resolve all review conversations, including outdated threads, before merging");
    if (
      p?.requireConversationResolution &&
      this.sql
        .exec(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='code_comments'",
        )
        .toArray().length
    ) {
      const commits = new Set([
        head,
        pull.headCommit,
        ...history.map((e) => e.next).filter((sha): sha is string => !!sha),
      ]);
      const unresolved = this.sql
        .exec<{ commit_sha: string; data: string }>(
          "SELECT commit_sha,data FROM code_comments",
        )
        .toArray()
        .some((row) => {
          const c = JSON.parse(row.data);
          return commits.has(row.commit_sha) && !c.replyTo && !c.resolved;
        });
      if (unresolved)
        throw Error(
          "Resolve all review conversations, including outdated threads, before merging",
        );
    }
  }
  /** Without membership this discovers candidates only; final merge requires proof. */
  eligibleApprovals(pull: Pull, reviews: Review[], head: string) { return this.reviewState(pull,reviews,head).approved; }
  canDismiss(branch: string, actor: string) {
    const allowed=this.get(branch)?.allowDismiss;
    return allowed === undefined || allowed.includes(actor);
  }
  reviewGate(pull: Pull, reviews: Review[], head: string): import("../review/types").ReviewGate {
    const approvals=this.eligibleApprovals(pull,reviews,head).length,required=this.get(pull.base)?.approvals??0;
    try { this.reviews(pull.base,pull,reviews,head); return {ready:true,error:null,approvals,required}; }
    catch(error) { return {ready:false,error:(error as Error).message,approvals,required}; }
  }
  private reviewState(pull: Pull, reviews: Review[], head: string) {
    const latest=new Map<string,Review>();
    for(const review of reviews)if(review.pull===pull.number&&review.verdict!=="COMMENT")latest.set(review.author.id,review);
    const latestPush=this.history(pull).filter(e=>e.reviewable!==false).at(-1);
    const strict=this.get(pull.base)?.dismissStaleReviews !== false;
    // Keep a dismissed verdict as the author's latest decision, then exclude it.
    // Skipping it before building this map would resurrect an older approval.
    const approved=[...latest.values()].filter(r=>(!this.membership||this.membership.accounts[r.author.id]==="writer")&&!r.dismissed&&(!strict||this.currentDiff(r,pull,head))&&r.verdict==="APPROVE"&&
      r.author.id!==pull.author.id&&(!strict||r.author.id!==latestPush?.actor)&&r.independent===true);
    return {latest,latestPush,approved};
  }
  private currentDiff(review: Review, pull: Pull, head: string) {
    let current=pull.state!=="open"?pull.headTree:undefined;
    if(!current)for(const table of ["repository_refs","review_branches"] as const) {
      if(!this.sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?",table).toArray().length)continue;
      current=this.sql.exec<{tree_sha:string}>(`SELECT tree_sha FROM ${table} WHERE name = ?`,table==="repository_refs"?`refs/heads/${pull.head}`:pull.head).toArray()[0]?.tree_sha;
      if(current)break;
    }
    // Old records without a trusted tree retain the former exact-ID behavior.
    return (review.tree && current ? review.tree===current : review.commit===head) &&
      (review.anchorTree ? review.anchorTree===pull.anchorTree : review.anchor===pull.anchor);
  }
  pushEvent(branch: string) {
    if (
      !this.sql
        .exec(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='repository_audit'",
        )
        .toArray().length
    )
      return undefined;
    return this.sql
      .exec<{ id: number; data: string }>(
        "SELECT id,data FROM repository_audit WHERE json_extract(data, '$.ref') = ? AND json_extract(data, '$.reviewable') IS NOT 0 ORDER BY id DESC LIMIT 1",
        `refs/heads/${branch}`,
      )
      .toArray()
      .at(0)?.id;
  }
  private history(pull: Pull) {
    if (
      !this.sql
        .exec(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='repository_audit'",
        )
        .toArray().length
    )
      return [];
    // Include the initial head's last push (before PR creation) and every later
    // head. A new push must not hide unresolved conversations on an old revision.
    const events = this.sql
      .exec<{ id: number; data: string }>(
        "SELECT id,data FROM repository_audit WHERE json_extract(data, '$.ref') = ? ORDER BY id",
        `refs/heads/${pull.head}`,
      )
      .toArray()
      .map(
        (r) =>
          ({ ...JSON.parse(r.data), id: r.id }) as {
            id: number;
            ref?: string;
            old?: string | null;
            next?: string | null;
            actor?: string;
            reviewable?: boolean;
            at: number;
          },
      );
    if(pull.openedPushEvent!==undefined)return events.filter(e=>e.id>=pull.openedPushEvent!);
    const initial = events
      .filter(
        (e) =>
          e.ref === `refs/heads/${pull.head}` &&
          e.next === pull.headCommit &&
          e.at <= pull.createdAt,
      )
      .at(-1);
    return [
      ...(initial ? [initial] : []),
      ...events.filter(
        (e) => initial ? e.id>initial.id : e.at>=pull.createdAt,
      ),
    ];
  }
}
