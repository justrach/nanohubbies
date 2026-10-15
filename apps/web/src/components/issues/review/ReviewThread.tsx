import { useState } from "react";
import { Button } from "@/components/controls";
import { ago } from "@/lib/format";
import type { CodeComment } from "./types";
import styles from "./Review.module.css";

export function ReviewThread({
  root,
  replies,
  canComment,
  pending,
  onReply,
  onResolve,
}: {
  root: CodeComment;
  replies: CodeComment[];
  canComment: boolean;
  pending: boolean;
  onReply: (body: string) => Promise<boolean>;
  onResolve: () => Promise<void>;
}) {
  const [replying, setReplying] = useState(false);
  const [body, setBody] = useState("");
  return (
    <article
      className={styles.thread}
      aria-label={`Comment on ${root.path} lines ${root.startLine}–${root.line}`}
    >
      <header>
        <span>
          {root.side === "LEFT" ? "Before" : "After"} · L{root.startLine}
          {root.line !== root.startLine ? `–${root.line}` : ""}
        </span>
        {root.resolved && <span>Resolved</span>}
        {canComment && (
          <button
            type="button"
            disabled={pending}
            onClick={() => void onResolve()}
          >
            {root.resolved ? "Reopen" : "Resolve"}
          </button>
        )}
      </header>
      {[root, ...replies].map((c) => (
        <div className={styles.message} key={c.id}>
          <div>
            <strong>{c.author.name}</strong>
            <time>{ago(Date.now() - c.at)}</time>
          </div>
          <p>{c.body}</p>
        </div>
      ))}
      {canComment && !replying && (
        <button
          className={styles.reply}
          type="button"
          onClick={() => setReplying(true)}
        >
          Reply to thread
        </button>
      )}
      {replying && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (await onReply(body)) {
              setBody("");
              setReplying(false);
            }
          }}
        >
          <textarea
            autoFocus
            aria-label="Reply to review thread"
            value={body}
            maxLength={16000}
            onChange={(e) => setBody(e.target.value)}
            disabled={pending}
            rows={3}
          />
          <footer>
            <Button size="sm" type="submit" disabled={pending || !body.trim()}>
              Reply
            </Button>
            <Button
              size="sm"
              disabled={pending}
              onClick={() => setReplying(false)}
            >
              Cancel
            </Button>
          </footer>
        </form>
      )}
    </article>
  );
}
