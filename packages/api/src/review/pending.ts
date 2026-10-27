import {assertRepositoryWritable} from "../repository/archive";
import type { Branch, Pull, Review } from "./types";
import type { Owner } from "../types";
import type { PullComment } from "./pull-comment-types";
import type { PendingReview, PendingResult } from "./pending-types";
import { PullComments } from "./pull-comments";

type Actor = {id:string;origin:string};
type Identity = {number:number;actor:Actor};
type Observed = {reviewId:string;revision:number};
export type PendingCommand = Identity & (
  | {op:"get"}
  | (Observed & {op:"add";commit:string;anchor:string;author:Owner;comment:PullComment})
  | (Observed & {op:"edit";commentId:string;body:string})
  | (Observed & {op:"remove";commentId:string})
  | (Observed & {op:"discard"})
);
export type SubmitPending = Identity & Observed & {commit:string;anchor:string;verdict:Review["verdict"];body:string};

/** Private drafts never enter ReviewSnapshot or public discussion storage. */
export class PendingReviews {
  constructor(private sql:SqlStorage) {
    new PullComments(sql);
    sql.exec("CREATE TABLE IF NOT EXISTS review_drafts (id TEXT PRIMARY KEY, pull INTEGER NOT NULL, author TEXT NOT NULL, data TEXT NOT NULL)");
    sql.exec("CREATE UNIQUE INDEX IF NOT EXISTS review_drafts_person ON review_drafts(pull,author)");
    sql.exec("CREATE TABLE IF NOT EXISTS review_draft_submissions (id TEXT PRIMARY KEY, pull INTEGER NOT NULL, author TEXT NOT NULL, data TEXT NOT NULL)");
  }
  run(c:PendingCommand,pull:Pull,head?:Branch):PendingResult {
    if (pull.number!==c.number) throw Error("No such pull request");
    const draft=this.get(c.number,c.actor.id);
    if (c.op==="get") return {pending:draft};
    assertRepositoryWritable(this.sql);
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(c.reviewId)||!Number.isSafeInteger(c.revision)||c.revision<0) throw Error("Invalid pending review identity");
    if (draft&&draft.id!==c.reviewId) throw Error("Pending review changed; refresh before editing it");
    if (c.op==="add") {
      if (pull.state!=="open") throw Error("This pull request is no longer open");
      if (head?.commit!==c.commit||pull.anchor!==c.anchor||draft&&(draft.commit!==c.commit||draft.anchor!==c.anchor)) throw Error("Pending review belongs to an earlier diff; keep it private or discard it before starting on the latest diff");
      const next=c.comment;
      if(next.author.id!==c.actor.id||c.author.id!==c.actor.id||next.pull!==c.number||next.commit!==c.commit||next.anchor!==c.anchor||next.replyTo||next.resolved||!next.body.trim()||next.body.length>16000)throw Error("Invalid pending comment");
      if(this.sql.exec("SELECT 1 FROM pull_comments WHERE id = ?",next.id).toArray().length)throw Error("Comment id already used");
      const duplicate=draft?.comments.find(comment=>comment.id===next.id);
      if(duplicate) {
        if(JSON.stringify([duplicate.path,duplicate.side,duplicate.startLine,duplicate.line,duplicate.body])!==JSON.stringify([next.path,next.side,next.startLine,next.line,next.body]))throw Error("Comment id already used");
        return {pending:draft};
      }
      if ((draft?.revision??0)!==c.revision) throw Error("Pending review changed; refresh before editing it");
      if(!draft) {
        if(this.sql.exec("SELECT 1 FROM review_drafts WHERE id = ? UNION ALL SELECT 1 FROM review_draft_submissions WHERE id = ?",c.reviewId,c.reviewId).toArray().length)throw Error("Pending review id already used");
        if(this.sql.exec<{n:number}>("SELECT COUNT(*) AS n FROM review_drafts").toArray()[0].n>=1000)throw Error("Repository pending review limit reached");
      }
      if((draft?.comments.length??0)>=100)throw Error("A pending review can contain at most 100 comments");
      const now=Date.now(),saved:PendingReview={...(draft??{id:c.reviewId,pull:c.number,author:c.author,commit:c.commit,anchor:c.anchor,createdAt:now}),revision:c.revision+1,comments:[...(draft?.comments??[]),next],updatedAt:now};
      this.save(saved);return {pending:saved};
    }
    if(!draft&&c.op==="discard") {
      const old=this.sql.exec<{pull:number;author:string;data:string}>("SELECT pull,author,data FROM review_draft_submissions WHERE id = ?",c.reviewId).toArray()[0];
      const data=old&&JSON.parse(old.data);
      if(old?.pull===c.number&&old.author===c.actor.id&&data.discarded&&data.revision===c.revision)return {pending:null};
    }
    if(!draft)throw Error("No pending review");
    if(draft.revision!==c.revision)throw Error("Pending review changed; refresh before editing it");
    if(c.op==="discard") {
      this.sql.exec("INSERT INTO review_draft_submissions VALUES (?, ?, ?, ?)",draft.id,c.number,c.actor.id,JSON.stringify({discarded:true,revision:draft.revision}));
      this.sql.exec("DELETE FROM review_drafts WHERE id = ? AND author = ?",draft.id,c.actor.id);
      return {pending:null};
    }
    const comment=draft.comments.find(comment=>comment.id===c.commentId);
    if(!comment)throw Error("No pending comment");
    if(c.op==="edit") {
      if(typeof c.body!=="string"||!c.body.trim()||c.body.length>16000)throw Error("Provide a comment of 1–16000 characters");
      comment.body=c.body.trim();
    } else draft.comments=draft.comments.filter(comment=>comment.id!==c.commentId);
    draft.revision++;draft.updatedAt=Date.now();this.save(draft);return {pending:draft};
  }
  /** Caller owns one SQLite transaction encompassing verdict, threads and receipt. */
  submit(c:SubmitPending,pull:Pull,head:Branch|undefined,publish:(draft:PendingReview)=>Review):{pending:null;reviewId:number} {
    assertRepositoryWritable(this.sql);
    const fingerprint=JSON.stringify([c.revision,c.commit,c.anchor,c.verdict,c.body]);
    const receipt=this.sql.exec<{pull:number;author:string;data:string}>("SELECT pull,author,data FROM review_draft_submissions WHERE id = ?",c.reviewId).toArray()[0];
    if(receipt) {
      const data=JSON.parse(receipt.data);
      if(data.discarded)throw Error("This pending review was discarded; start a new review");
      if(receipt.pull!==c.number||receipt.author!==c.actor.id||data.fingerprint!==fingerprint)throw Error("Submitted review id already used");
      return {pending:null,reviewId:data.reviewId};
    }
    const draft=this.get(c.number,c.actor.id);
    if(!draft||draft.id!==c.reviewId)throw Error("No pending review");
    if(draft.revision!==c.revision)throw Error("Pending review changed; refresh before submitting it");
    if(pull.number!==c.number||pull.state!=="open")throw Error("This pull request is no longer open");
    if(head?.commit!==c.commit||pull.anchor!==c.anchor||draft.commit!==c.commit||draft.anchor!==c.anchor)throw Error("PR changed; refresh and review its latest diff. Your pending comments remain private");
    if(!["COMMENT","APPROVE","REQUEST_CHANGES"].includes(c.verdict)||typeof c.body!=="string"||c.body.length>16000)throw Error("Invalid review");
    for(const comment of draft.comments)if(this.sql.exec("SELECT 1 FROM pull_comments WHERE id = ?",comment.id).toArray().length)throw Error("Comment id already used");
    const review=publish(draft),comments=new PullComments(this.sql);
    for(const comment of draft.comments)comments.run({op:"add",number:c.number,commit:c.commit,anchor:c.anchor,actor:c.actor,comment:{...comment,reviewId:review.id,at:Date.now()}},pull,head);
    this.sql.exec("INSERT INTO review_draft_submissions VALUES (?, ?, ?, ?)",draft.id,c.number,c.actor.id,JSON.stringify({fingerprint,reviewId:review.id}));
    this.sql.exec("DELETE FROM review_drafts WHERE id = ? AND author = ?",draft.id,c.actor.id);
    return {pending:null,reviewId:review.id};
  }
  private get(pull:number,author:string):PendingReview|null {
    const row=this.sql.exec<{data:string}>("SELECT data FROM review_drafts WHERE pull = ? AND author = ?",pull,author).toArray()[0];
    return row?JSON.parse(row.data):null;
  }
  private save(draft:PendingReview) {
    const data=JSON.stringify(draft);
    if(new TextEncoder().encode(data).length>1024*1024)throw Error("Pending review exceeds its 1 MiB storage limit");
    this.sql.exec("INSERT INTO review_drafts VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",draft.id,draft.pull,draft.author.id,data);
  }
}
