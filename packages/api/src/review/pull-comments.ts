import {assertRepositoryWritable} from "../repository/archive";
import type { PullComment, PullDiscussion } from "./pull-comment-types";
import type { Branch, Pull } from "./types";

export type PullCommentCommand = { number: number } & (
  | { op: "list" }
  | { op: "add"; commit: string; anchor: string; comment: PullComment; actor: { id: string; origin: string } }
  | { op: "resolve"; commit: string; anchor: string; id: string; resolved: boolean; actor: { id: string; origin: string } }
);

/** PR scope and original comparison survive branch pushes, rebases and removal. */
export class PullComments {
  constructor(private sql: SqlStorage) {
    sql.exec("CREATE TABLE IF NOT EXISTS pull_comments (id TEXT PRIMARY KEY, pull INTEGER NOT NULL, data TEXT NOT NULL)");
    sql.exec("CREATE INDEX IF NOT EXISTS pull_comments_pull ON pull_comments(pull)");
  }
  run(c: PullCommentCommand, pull: Pull, head?: Branch): PullDiscussion {
    if(c.op!=="list")assertRepositoryWritable(this.sql);
    if (pull.number !== c.number) throw Error("No such pull request");
    if (c.op !== "list") {
      if (pull.state !== "open") throw Error("This pull request is no longer open");
      if (head?.commit !== c.commit || pull.anchor !== c.anchor) throw Error("PR changed; refresh and review its latest diff");
      if (c.op === "resolve") {
        const root = this.find(c.id, c.number);
        if (!root || root.replyTo) throw Error("No such review thread");
        this.sql.exec("UPDATE pull_comments SET data = ? WHERE id = ? AND pull = ?", JSON.stringify({ ...root, resolved: c.resolved }), root.id, c.number);
      } else {
        const next = c.comment;
        if (next.pull !== c.number || next.author.id !== c.actor.id || !next.body.trim() || next.body.length > 16000) throw Error("Invalid review comment");
        const existing = this.sql.exec<{data:string}>("SELECT data FROM pull_comments WHERE id = ?", next.id).toArray()[0];
        if (existing) {
          const old: PullComment = JSON.parse(existing.data);
          for (const key of ["pull", "commit", "anchor", "path", "side", "startLine", "line", "body", "replyTo"] as const)
            if (old[key] !== next[key]) throw Error("Comment id already used");
          if (old.author.id !== next.author.id) throw Error("Comment id already used");
        } else {
          const count = this.sql.exec<{n:number}>("SELECT COUNT(*) AS n FROM pull_comments").toArray()[0].n;
          const local = this.sql.exec<{n:number}>("SELECT COUNT(*) AS n FROM pull_comments WHERE pull = ?", c.number).toArray()[0].n;
          if (count >= 10000 || local >= 1000) throw Error("Pull request comment limit reached");
          if (next.replyTo) {
            const root = this.find(next.replyTo, c.number);
            if (!root || root.replyTo || root.commit !== next.commit || root.anchor !== next.anchor || root.path !== next.path || root.side !== next.side || root.startLine !== next.startLine || root.line !== next.line)
              throw Error("Reply must use its thread's original code selection");
          } else if (next.commit !== c.commit || next.anchor !== c.anchor) throw Error("PR changed; refresh and review its latest diff");
          this.sql.exec("INSERT INTO pull_comments VALUES (?, ?, ?)", next.id, c.number, JSON.stringify(next));
        }
      }
    }
    const rows = this.sql.exec<{data:string}>("SELECT data FROM pull_comments WHERE pull = ? ORDER BY rowid LIMIT 1001", c.number).toArray();
    return { comments: rows.slice(0, 1000).map(row => JSON.parse(row.data)), truncated: rows.length > 1000 };
  }
  private find(id: string, pull: number): PullComment | undefined {
    const row = this.sql.exec<{data:string}>("SELECT data FROM pull_comments WHERE id = ? AND pull = ?", id, pull).toArray()[0];
    return row && JSON.parse(row.data);
  }
}
