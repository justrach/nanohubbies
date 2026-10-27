import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/controls";
import { ago } from "@/lib/format";
import type { CodeComment } from "./types";
import styles from "./Review.module.css";
import { suggestionText } from "@swarm/api/review";

export function ReviewThread({
  root,
  replies,
  canComment,
  pending,
  onReply,
  onResolve,
  onChooseSuggestion,
  suggestionSelected,
}: {
  root: CodeComment;
  replies: CodeComment[];
  canComment: boolean;
  pending: boolean;
  onReply: (body: string) => Promise<boolean>;
  onResolve: () => Promise<void>;
  onChooseSuggestion?:(comment:CodeComment,single:boolean)=>void;
  suggestionSelected?:boolean;
}) {
  const [replying, setReplying] = useState(false);
  const [body, setBody] = useState("");
  const article = useRef<HTMLElement>(null), wasReplying = useRef(false);
  useEffect(() => {
    if (wasReplying.current && !replying) article.current?.focus();
    wasReplying.current = replying;
  }, [replying]);
  return (
    <article
      ref={article}
      id={`code-thread-${root.id}`}
      tabIndex={-1}
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
      {[root, ...replies].map((c) => {const suggestion=suggestionText(c.body);return (
        <div className={styles.message} key={c.id}>
          <div>
            <strong>{c.author.name}</strong>
            {c.via?.kind==="cli"&&<span>via CLI</span>}
            <time>{ago(Date.now() - c.at)}</time>
          </div>
          {suggestion?<><p>{suggestion.before}</p><div className={styles.suggestion}><strong>Suggested change</strong>{suggestion.lines.length?<pre><code>{suggestion.lines.join("\n")||" "}</code></pre>:<p>Remove the selected lines.</p>}
            {c.applied?<p>Applied in <code>{c.applied.commit.slice(0,7)}</code> by {c.applied.actor.name}</p>:c.id===root.id&&onChooseSuggestion&&canComment&&root.side==="RIGHT"?<footer><Button size="sm" disabled={pending} onClick={()=>onChooseSuggestion(root,true)}>Apply suggestion</Button><Button size="sm" aria-pressed={!!suggestionSelected} disabled={pending} onClick={()=>onChooseSuggestion(root,false)}>{suggestionSelected?"Remove from batch":"Add suggestion to batch"}</Button></footer>:<p className={styles.hint}>{root.side==="LEFT"?"Review the current after-side lines to apply a suggestion.":"This suggestion can be inspected in its original revision."}</p>}
          </div><p>{suggestion.after}</p></>:<p>{c.body}</p>}
        </div>
      );})}
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
