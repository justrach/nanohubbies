import {newRefName} from "../repository/ref-name";
import type {RulesetActor} from '../repository/bypass';
import {ArchiveStore,assertRepositoryWritable} from "../repository/archive";
import {Environments} from "../deployments/store";
import {deploymentGate} from "../deployments/requirements";
import type { RuleObserver } from "../repository/insight-types";
import { Repository } from "../repository/store";
import {MergeSettingsStore} from '../repository/merge-settings';
import { Rulesets } from "../repository/rulesets";
import { Policies } from "../repository/policy";
import { CIStore } from "../ci/store";
import { codeOwnerDecision } from "../repository/codeowners";
import { dismissChangedApprovals, dismissAfterHeadChange } from "./stale";
import {requireSharedHeadReviews} from "./shared-head";
import {reviewedMergeHead} from "./merge-evidence";
import {RequestedReviews} from './requests';
import {feedbackStorage} from './feedback-storage';
import {reviewDecision} from './feedback';
import type { ReviewerMembership } from "./reviewer-types";
import type { ChangeRequest, Head, Submitted } from "../types";
import { branchName, type Branch, type Pull, type Review, type ReviewCommand, type ReviewSnapshot } from "./types";

/** Ref and review mutations share the sequencer's serialized writer. Objects
 * are published before a ref moves; every update compares the observed head. */
export class ReviewStore {
  constructor(private sql: SqlStorage, private main: () => Head, private git = false,private membership?:ReviewerMembership, private observe?:RuleObserver,private authority?:RulesetActor) {
    sql.exec("CREATE TABLE IF NOT EXISTS review_branches (name TEXT PRIMARY KEY, commit_sha TEXT NOT NULL, tree_sha TEXT NOT NULL, updated_at INTEGER NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS review_pulls (number INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS review_reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, pull INTEGER NOT NULL, data TEXT NOT NULL)");
    feedbackStorage(sql);
  }

  snapshot(): ReviewSnapshot {
    const repo=this.git?new Repository(this.sql,this.observe,this.authority):null,defaultBranch=repo?.defaultBranch()??"main";
    return {archive:new ArchiveStore(this.sql).state(),defaultBranch,ciBase:repo?repo.refs().find(ref=>ref.name===`refs/heads/${defaultBranch}`)?.commit??null:this.main().commit,
      branches: this.branches(),
      repositoryMode:this.git,
      mergeMethods:this.git?new MergeSettingsStore(this.sql).get().allowedMethods:["fast-forward"],
      mergeSettings:this.git?new MergeSettingsStore(this.sql).get():undefined,
      environments:this.git?new Environments(this.sql).list():[],
      rulesets:this.git?new Rulesets(this.sql).plan().rulesets:[],
      policies: new Policies(this.sql).list(),
      effectivePolicies: Object.fromEntries(this.branches().map(b=>[b.name,new Policies(this.sql).get(b.name)]).filter(([,p])=>!!p)),
      runs: new CIStore(this.sql).list(),
      ciSources: new CIStore(this.sql).sources(),
      pulls: this.sql.exec<{ number: number; data: string }>("SELECT * FROM review_pulls ORDER BY number DESC").toArray().map((r) => ({ ...JSON.parse(r.data), number: r.number })),
      reviews: this.sql.exec<{ id: number; data: string }>("SELECT * FROM review_reviews ORDER BY id").toArray().map((r) => ({ ...JSON.parse(r.data), id: r.id })),
    };
  }

  branches(): Branch[] {
    if (this.git) return new Repository(this.sql,this.observe,this.authority).refs().filter(r => r.name.startsWith("refs/heads/")).map(r => ({ ...r, name: r.name.slice(11) }));
    const main = this.main();
    const branches = this.sql.exec<{ name: string; commit_sha: string; tree_sha: string; updated_at: number }>("SELECT * FROM review_branches ORDER BY name").toArray()
      .map((r) => ({ name: r.name, commit: r.commit_sha, tree: r.tree_sha, updatedAt: r.updated_at }));
    return [{ name: "main", commit: main.commit, tree: main.tree, updatedAt: 0 }, ...branches];
  }

  run(command: ReviewCommand, land: (req: ChangeRequest) => Submitted): ReviewSnapshot {
    if(command.op!=="snapshot")assertRepositoryWritable(this.sql);
    const s = this.snapshot();
    const policies = new Policies(this.sql,this.membership), ci = new CIStore(this.sql);
    const branch = (name: string) => {
      const b = s.branches.find((b) => b.name === name);
      if (!b) throw new Error(`No branch ${name}`);
      return b;
    };
    const matches = (b: Branch) => {
      if (branch(b.name).commit !== b.commit||branch(b.name).tree!==b.tree) throw new Error(`${b.name} changed; refresh and try again`);
    };
    const write = (name: string, next: { commit: string; tree: string }, actor:string) => {
      this.sql.exec(
        "INSERT INTO review_branches VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET commit_sha=excluded.commit_sha, tree_sha=excluded.tree_sha, updated_at=excluded.updated_at",
        name, next.commit, next.tree, Date.now());
      const repo=new Repository(this.sql,this.observe,this.authority),reviewable=s.branches.find(b=>b.name===name)?.tree!==next.tree;
      repo.audit({actor,ref:`refs/heads/${name}`,old:s.branches.find(b=>b.name===name)?.commit??null,next:next.commit,merge:false,reviewable});
      if(reviewable)dismissAfterHeadChange(this.sql,name,next,event=>repo.audit(event));
    };
    if (command.op === "snapshot") return s;
    if (command.op === "branch") {
      const c = command;
      branchName(c.name);
      if (!this.git&&c.name === "main") throw new Error("Use the main landing path to update main");
      const old = s.branches.find((b) => b.name === c.name);
      if (!old && c.next) newRefName(`refs/heads/${c.name}`);
      if ((old?.commit ?? null) !== c.old) throw new Error("Branch changed; fetch and try again");
      if (c.source) matches(c.source);
      if (!old && (s.branches.length >= 200 || s.branches.some((b) => b.name.startsWith(c.name + "/") || c.name.startsWith(b.name + "/")))) throw new Error("Branch limit or conflicting branch name");
      if (!this.git) policies.direct(c.name, !c.next, !old || !!c.source || c.fastForward === true,c.actor??"");
      if (!c.next) {
        if (s.pulls.some((p) => p.state === "open" && (p.head === c.name || p.base === c.name))) throw new Error("Close or merge the open PRs using this branch first");
        if (this.git) new Repository(this.sql,this.observe,this.authority).update(`refs/heads/${c.name}`, c.old, null, false, c.actor ?? "api",false,c.proof,c.human);
        else this.sql.exec("DELETE FROM review_branches WHERE name = ?", c.name);
      } else {
        for (const update of c.rebased ?? []) {
          const p = s.pulls.find((p) => p.number === update.number);
          if (!p || p.state !== "open" || p.head !== c.name || p.anchor !== update.anchor || p.base !== update.base.name) throw new Error("PR changed while pushing; refresh and retry");
          matches(update.base);
          p.anchor = update.base.commit; p.anchorTree = update.base.tree;
          if(c.next)dismissChangedApprovals(this.sql,p,{...c.next,anchor:p.anchor,anchorTree:p.anchorTree},event=>new Repository(this.sql,this.observe,this.authority).audit(event));
          this.save(p);
        }
        if (this.git) new Repository(this.sql,this.observe,this.authority).update(`refs/heads/${c.name}`, c.old, c.next, !!c.source || c.fastForward === true, c.actor ?? "api",false,c.proof,c.human);
        else write(c.name, c.next,c.actor??"");
      }
    } else if (command.op === "open") {
      const c = command;
      matches(c.head); matches(c.base);
      if(!s.ciBase)throw Error("Push the repository default branch before opening a pull request");
      ci.require(c.head.name, c.head.commit, s.ciBase, policies.get(c.base.name)?.beforeOpen ?? [], policies.get(c.base.name)?.checkSources,policies.get(c.base.name)?.successOnlyChecks);
      if (!c.title.trim() || c.title.length > 200 || c.body.length > 16000) throw new Error("Provide a title of up to 200 characters and body of up to 16000");
      if ((!this.git&&c.head.name === "main") || c.head.name === c.base.name) throw new Error("Choose a feature branch and a different base");
      if (s.pulls.length >= 500) throw new Error("This workspace has reached its 500 PR limit");
      if (s.pulls.some((p) => p.head === c.head.name && p.state === "open")) throw new Error("An open PR already uses this head branch");
      const seen = new Set([c.head.name]);
      for (let name = c.base.name; name !== s.defaultBranch;) {
        if (seen.has(name)) throw new Error("A PR stack cannot contain a cycle");
        seen.add(name);
        const parent = s.pulls.find((p) => p.head === name && p.state === "open");
        if (!parent) break;
        name = parent.base;
      }
      const now = Date.now();
      const p: Omit<Pull, "number"> = { title: c.title.trim(), body: c.body, head: c.head.name, base: c.base.name, anchor: c.anchor, anchorTree: c.anchorTree,
        parent: s.pulls.find((q) => q.state === "open" && q.head === c.base.name)?.number ?? null,
        headCommit: c.head.commit, headTree: c.head.tree, openedPushEvent:policies.pushEvent(c.head.name), author: c.author, state: "open", createdAt: now, updatedAt: now, mergedCommit: null, mergedVersion: null };
      this.sql.exec("INSERT INTO review_pulls (data) VALUES (?)", JSON.stringify(p));
    } else {
      const c = command;
      const p = s.pulls.find((p) => p.number === c.number);
      if (!p) throw new Error("No such pull request");
      // Merge retries are idempotent, including after the published head moves.
      if (c.op === "merge" && p.state === "merged") return s;
      if (p.state !== "open") throw new Error("This pull request is no longer open");
      if (c.op === "close") { p.headCommit = branch(p.head).commit; p.headTree = branch(p.head).tree; p.state = "closed"; }
      if (c.op === "review") {
        if (!["COMMENT", "APPROVE", "REQUEST_CHANGES"].includes(c.verdict) || c.body.length > 16000) throw new Error("Invalid review");
        if (branch(p.head).commit !== c.commit || p.anchor !== c.anchor) throw new Error("The PR changed; review its latest diff");
        if (s.reviews.length >= 2000) throw new Error("Workspace review limit reached");
        const r: Omit<Review, "id"> = { pull: p.number, author: c.author, body: c.body, verdict: c.verdict, commit: c.commit, anchor: c.anchor, tree:branch(p.head).tree,anchorTree:p.anchorTree,independent: c.independent === true, pushEvent: policies.pushEvent(p.head), at: Date.now() };
        if(c.batch){r.batchId=c.batch.id;r.commentIds=c.batch.comments;}
        if(c.via)r.via=c.via;
        if(c.feedback)r.feedback=c.feedback;
        new RequestedReviews(this.sql);
        this.sql.exec("INSERT INTO review_reviews (pull, data) VALUES (?, ?)", p.number, JSON.stringify(r));
      }
      if (c.op === "dismiss") {
        if (!c.human) throw Error("Review dismissal requires a signed-in repository writer");
        if (!policies.canDismiss(p.base,c.actor.id)) throw Error("Account is not allowed to dismiss reviews for this branch");
        if (!Number.isSafeInteger(c.reviewId) || c.reviewId < 1 || typeof c.reason !== "string" || !c.reason.trim() || c.reason.length > 16000)
          throw Error("Provide a review ID and a dismissal reason of up to 16000 characters");
        const review=s.reviews.find(r=>r.id===c.reviewId&&r.pull===p.number);
        if (!review) throw Error("No such review on this pull request");
        const verdict=reviewDecision(review);
        if (verdict === "COMMENT") throw Error("Comment-only reviews cannot be dismissed");
        const reason=c.reason.trim();
        if (review.dismissed) {
          if (review.dismissed.actor.id === c.actor.id && review.dismissed.reason === reason) return s;
          throw Error("This review has already been dismissed");
        }
        review.dismissed={actor:c.actor,reason,at:Date.now()};
        this.sql.exec("UPDATE review_reviews SET data = ? WHERE id = ? AND pull = ?",JSON.stringify(review),review.id,p.number);
        new Repository(this.sql,this.observe,this.authority).audit({actor:c.actor.id,human:true,dismissal:{pull:p.number,review:review.id,branch:p.base,reason,previousVerdict:verdict}});
      }
      if (c.op === "compare") {
        if(p.head!==c.head.name||p.base!==c.base.name||(p.anchor!==c.previousAnchor&&p.anchor!==c.anchor))throw Error("PR changed; refresh and try again");
        matches(c.head);matches(c.base);
        p.anchor=c.anchor;p.anchorTree=c.anchorTree;
        dismissChangedApprovals(this.sql,p,{commit:c.head.commit,tree:c.head.tree,anchor:p.anchor,anchorTree:p.anchorTree},event=>new Repository(this.sql,this.observe,this.authority).audit(event));
      }
      if (c.op === "restack" || c.op === "merge") {
        if (c.head.name !== p.head || c.anchor !== p.anchor) throw new Error("PR changed; refresh and try again");
        matches(c.head);
        if (c.op === "restack") {
          if (c.base.name !== p.base) throw new Error("PR base changed; refresh and try again");
          matches(c.base);
          if (this.git) new Repository(this.sql,this.observe,this.authority).update(`refs/heads/${p.head}`, c.head.commit, c.next, false, c.actor??"",false,c.proof,c.human);
          else { policies.direct(p.head, false, false,c.actor??""); write(p.head, c.next,c.actor??""); }
          p.anchor = c.base.commit; p.anchorTree = c.base.tree;
          dismissChangedApprovals(this.sql,p,{commit:c.next.commit,tree:c.next.tree,anchor:p.anchor,anchorTree:p.anchorTree},event=>new Repository(this.sql,this.observe,this.authority).audit(event));
        } else {
          if (!this.git&&p.base !== "main") throw new Error("Merge the parent PR first");
          if ((this.git?branch(p.base).commit:this.main().commit) !== c.base.commit) throw new Error("Base changed; refresh and try again");
          const ciBase=this.main().commit;
          if(!this.membership||!Number.isFinite(this.membership.checkedAt)||!Number.isFinite(this.membership.expiresAt)||this.membership.checkedAt>Date.now()+1000||this.membership.expiresAt<=Date.now()||Date.now()-this.membership.checkedAt>30000)throw Error("Current reviewer membership evidence is required; refresh and retry");
          policies.reviews(p.base, p, s.reviews, c.head.commit);
          requireSharedHeadReviews(this.sql,p,c.head.commit,s);
          if(policies.get(p.base)?.requireCodeOwnerReview) {
            if(!this.git||!c.codeOwners||!c.codeOwnerAccounts||c.codeOwners.head!==c.head.commit||c.codeOwners.base!==c.base.commit)
              throw Error("Current base/head CODEOWNERS evidence is required; refresh and retry");
            const decision=codeOwnerDecision(c.codeOwners,c.codeOwnerAccounts,policies.eligibleApprovals(p,s.reviews,c.head.commit).map(r=>r.author.id),true);
            if(decision.error)throw Error(`Code owner review cannot be verified: ${decision.error}`);
            const missing=decision.groups.find(g=>!g.approved);
            if(missing)throw Error(`Requires code owner approval for ${missing.pattern} (CODEOWNERS line ${missing.line})`);
            p.codeOwners=decision;
          }
          ci.require(p.head, c.head.commit, ciBase, policies.get(p.base)?.checks ?? [], policies.get(p.base)?.checkSources,policies.get(p.base)?.successOnlyChecks);
          if (this.git) {
            if (!c.candidate || c.candidate.tree !== c.head.tree || c.candidate.base !== c.base.commit) throw new Error("Merge requires the exact reviewed tree and current target branch; refresh and retry");
            const method=c.candidate.method??"fast-forward";
            new MergeSettingsStore(this.sql).require(method,c.mergeSettingsRevision);
            if(method==="fast-forward") {
              if(c.candidate.commit!==c.head.commit||c.proof?.merge)throw Error("Fast-forward merge requires the reviewed head commit");
            } else {
              if(!c.proof?.merge||c.proof.merge.method!==method||c.proof.merge.tree!==c.head.tree||reviewedMergeHead(c.proof,c.base.commit,c.candidate.commit)!==c.head.commit)throw Error("Generated merge requires current object-derived head/base/tree evidence");
            }
            const deployments=deploymentGate(this.sql,p.base,c.head.commit,ciBase,c.request.owner?.id??"review",!!c.human,this.authority);
            new Repository(this.sql,this.observe,this.authority).update(`refs/heads/${p.base}`, c.base.commit, c.candidate, true, c.request.owner?.id ?? "review", true, c.proof,c.human,undefined,ciBase);
            p.deployments=deployments;
            p.state = "merged"; p.mergedCommit = c.candidate.commit; p.mergedVersion = p.base===s.defaultBranch?this.main().version:null;
            if(method!=="fast-forward")p.mergeMethod=method;
          } else {
            if (policies.get(p.base)?.checks.length) throw new Error("Exact-candidate CI requires Git repository mode");
            const result = land(c.request);
            if (result.status !== "landed") throw new Error(`Merge ${result.status}: ${"error" in result ? result.error : "refresh and retry after resolving conflicts"}`);
            p.state = "merged"; p.mergedCommit = result.commit; p.mergedVersion = result.version;
          }
          p.mergedBase = c.base.commit;
          p.mergedCIBase=ciBase;
          p.headCommit = c.head.commit; p.headTree = c.head.tree;
          // Keep each child's anchor: its diff remains incremental after the
          // parent's squash landing. Restacking replays only the child's work.
          for (const child of s.pulls.filter((q) => q.state === "open" && q.base === p.head)) {
            child.base = p.base; child.parent = p.number; this.save(child);
          }
        }
      }
      this.save(p);
    }
    return this.snapshot();
  }

  private save(p: Pull) {
    p.updatedAt = Date.now();
    this.sql.exec("UPDATE review_pulls SET data = ? WHERE number = ?", JSON.stringify(p), p.number);
  }
}
