import type { Owner } from "../types";

export interface CodeAnchor {
  path: string;
  side: "LEFT" | "RIGHT";
  startLine: number;
  line: number;
}
export interface CodeComment extends CodeAnchor {
  id: string;
  commit: string;
  author: Owner;
  body: string;
  at: number;
  replyTo: string | null;
  resolved: boolean;
}
export interface CommentList {
  comments: CodeComment[];
  truncated: boolean;
}
export type CommentCommand =
  | { op: "list"; commit: string }
  | { op: "add"; comment: CodeComment }
  | { op: "resolve"; commit: string; id: string; resolved: boolean };

/** Comments belong to immutable commits, never to the moving workspace head. */
export class CodeComments {
  constructor(private sql: SqlStorage) {
    sql.exec(
      "CREATE TABLE IF NOT EXISTS code_comments (id TEXT PRIMARY KEY, commit_sha TEXT NOT NULL, data TEXT NOT NULL)",
    );
    sql.exec(
      "CREATE INDEX IF NOT EXISTS code_comments_commit ON code_comments(commit_sha)",
    );
  }
  run(command: CommentCommand): CommentList {
    const commit =
      command.op === "add" ? command.comment.commit : command.commit;
    if (command.op === "add") {
      const c = command.comment;
      const existing = this.sql
        .exec<{
          data: string;
        }>("SELECT data FROM code_comments WHERE id = ?", c.id)
        .toArray()[0];
      if (existing) {
        const old: CodeComment = JSON.parse(existing.data);
        if (
          old.author.id !== c.author.id ||
          old.commit !== c.commit ||
          old.body !== c.body ||
          old.path !== c.path ||
          old.side !== c.side ||
          old.startLine !== c.startLine ||
          old.line !== c.line ||
          old.replyTo !== c.replyTo
        )
          throw new Error("Comment id already used");
      } else {
        const total = this.sql
          .exec<{ n: number }>("SELECT COUNT(*) AS n FROM code_comments")
          .one().n;
        const count = this.sql
          .exec<{
            n: number;
          }>("SELECT COUNT(*) AS n FROM code_comments WHERE commit_sha = ?", commit)
          .one().n;
        if (total >= 5000 || count >= 500)
          throw new Error("Review comment limit reached");
        if (c.replyTo) {
          const root = this.sql
            .exec<{
              data: string;
            }>("SELECT data FROM code_comments WHERE id = ? AND commit_sha = ?", c.replyTo, commit)
            .toArray()[0];
          const parent: CodeComment | null = root
            ? JSON.parse(root.data)
            : null;
          if (
            !parent ||
            parent.replyTo ||
            parent.path !== c.path ||
            parent.side !== c.side ||
            parent.startLine !== c.startLine ||
            parent.line !== c.line
          )
            throw new Error("Reply must use its thread's code selection");
        }
        this.sql.exec(
          "INSERT INTO code_comments VALUES (?, ?, ?)",
          c.id,
          commit,
          JSON.stringify(c),
        );
      }
    } else if (command.op === "resolve") {
      const row = this.sql
        .exec<{
          data: string;
        }>("SELECT data FROM code_comments WHERE id = ? AND commit_sha = ?", command.id, commit)
        .toArray()[0];
      if (!row) throw new Error("No such review thread");
      const root: CodeComment = JSON.parse(row.data);
      if (root.replyTo) throw new Error("Resolve the root thread");
      this.sql.exec(
        "UPDATE code_comments SET data = ? WHERE id = ?",
        JSON.stringify({ ...root, resolved: command.resolved }),
        root.id,
      );
    }
    const rows = this.sql
      .exec<{
        data: string;
      }>("SELECT data FROM code_comments WHERE commit_sha = ? ORDER BY rowid LIMIT 501", commit)
      .toArray();
    return {
      comments: rows.slice(0, 500).map((r) => JSON.parse(r.data)),
      truncated: rows.length > 500,
    };
  }
}

/** Require a contiguous selection in one visible hunk on the selected side. */
export function anchorInPatch(
  patch: string | null,
  anchor: CodeAnchor,
): boolean {
  if (
    !patch ||
    !["LEFT", "RIGHT"].includes(anchor.side) ||
    !Number.isSafeInteger(anchor.startLine) ||
    !Number.isSafeInteger(anchor.line) ||
    anchor.startLine < 1 ||
    anchor.line < anchor.startLine ||
    anchor.line - anchor.startLine > 200
  )
    return false;
  let old = 0,
    next = 0;
  let selected = new Set<number>();
  const covered = () => {
    for (let n = anchor.startLine; n <= anchor.line; n++)
      if (!selected.has(n)) return false;
    return true;
  };
  for (const raw of patch.split("\n")) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (header) {
      if (covered()) return true;
      old = Number(header[1]);
      next = Number(header[2]);
      selected = new Set();
    } else if (
      raw.startsWith("+") ||
      raw.startsWith("-") ||
      raw.startsWith(" ")
    ) {
      const left = raw[0] !== "+",
        right = raw[0] !== "-";
      if (anchor.side === "LEFT" && left) selected.add(old);
      if (anchor.side === "RIGHT" && right) selected.add(next);
      if (left) old++;
      if (right) next++;
    }
  }
  return covered();
}
