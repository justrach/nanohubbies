import { useMemo, useState } from "react";
import { parsePatch, type Row } from "@/pr/patch";
import { Button } from "@/components/controls";
import type { ChangedFile } from "@/trunk/types";
import type { CodeAnchor, CodeComment } from "./types";
import { ReviewThread } from "./ReviewThread";
import styles from "./Review.module.css";
import { useReviewDraft } from "./useReviewDraft";
import { suggestionFence } from "@swarm/api/review";

export function HunkReview({
  file,
  draftKey,
  comments,
  canComment,
  pending,
  onComment,
  onResolve,
  onPendingComment,
  pendingLabel,
  onChooseSuggestion,
  selectedSuggestions,
}: {
  file: ChangedFile;
  draftKey: string;
  comments: CodeComment[];
  canComment: boolean;
  pending: boolean;
  onComment: (
    anchor: CodeAnchor,
    body: string,
    replyTo?: string,
  ) => Promise<boolean>;
  onResolve: (root: CodeComment) => Promise<void>;
  onPendingComment?: (anchor:CodeAnchor,body:string)=>Promise<boolean>;
  pendingLabel?: string;
  onChooseSuggestion?:(comment:CodeComment,single:boolean)=>void;
  selectedSuggestions?:Set<string>;
}) {
  const hunks = useMemo(() => parsePatch(file.patch ?? ""), [file.patch]);
  const [draft, setDraft] = useReviewDraft(draftKey);
  const { selection, body } = draft;
  const setSelection = (selection: typeof draft.selection) =>
    setDraft((previous) => ({ ...previous, selection }));
  const setBody = (body: string) =>
    setDraft((previous) => ({ ...previous, body }));
  const [notice, setNotice] = useState("");
  const [shown, setShown] = useState(200);
  const select = (row: Row, hunk: number, extend: boolean) => {
    if (pending) return;
    if (body.trim() && !extend) {
      setNotice("Post or cancel your draft before selecting another chunk.");
      return;
    }
    const side = row.kind === "del" ? "LEFT" : "RIGHT";
    const line = side === "LEFT" ? row.old : row.new;
    if (line === null) return;
    const start =
      extend && selection?.side === side && selection.hunk === hunk
        ? selection.startLine
        : line;
    if (Math.abs(start - line) > 200) {
      setNotice("Select up to 201 lines in a chunk.");
      return;
    }
    setSelection({
      path: file.path,
      side,
      startLine: Math.min(start, line),
      line: Math.max(start, line),
      hunk,
    });
    setNotice("");
  };
  if (!file.patch)
    return (
      <p className={styles.empty}>
        This file is binary or too large for an inline diff. Open the full
        change to inspect it.
      </p>
    );
  return (
    <div>
      <p className={styles.hint}>
        {canComment
          ? "Select a line number to comment. Shift-click another line to select a range."
          : "Sign in to comment on a code selection."}
      </p>
      {notice && (
        <p role="status" className={styles.error}>
          {notice}
        </p>
      )}
      {hunks.map((hunk, hi) => {
        const roots = comments.filter(
          (c) =>
            !c.replyTo &&
            hunk.rows.some((r) =>
              c.side === "LEFT"
                ? r.kind !== "add" && r.old === c.line
                : r.kind !== "del" && r.new === c.line,
            ),
        );
        const chosen = selection?.hunk === hi ? selection : null;
        const first =
          hunk.rows.find((r) => r.new !== null) ??
          hunk.rows.find((r) => r.old !== null);
        return (
          <section
            className={styles.hunk}
            key={hi}
            aria-label={`Code chunk ${hi + 1}`}
          >
            <header>
              <code>
                @@ −{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},
                {hunk.newLines} @@ {hunk.section}
              </code>
              {canComment && first && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (body.trim()) {
                      setNotice(
                        "Post or cancel your draft before selecting another chunk.",
                      );
                      return;
                    }
                    const side = first.new !== null ? "RIGHT" : "LEFT";
                    const lines = hunk.rows.flatMap((r) =>
                      side === "RIGHT"
                        ? r.new === null
                          ? []
                          : [r.new]
                        : r.old === null
                          ? []
                          : [r.old],
                    );
                    setSelection({
                      path: file.path,
                      side,
                      startLine: lines[0],
                      line: Math.min(lines.at(-1)!, lines[0] + 200),
                      hunk: hi,
                    });
                    setNotice("");
                  }}
                >
                  Comment on chunk
                </button>
              )}
            </header>
            <div className={styles.code}>
              {hunk.rows.slice(0, shown).map((r, ri) => {
                const side = r.kind === "del" ? "LEFT" : "RIGHT",
                  line = side === "LEFT" ? r.old : r.new;
                const active =
                  chosen?.side === side &&
                  line !== null &&
                  line >= chosen.startLine &&
                  line <= chosen.line;
                return (
                  <div
                    key={ri}
                    className={`${styles.codeRow} ${r.kind === "add" ? styles.add : r.kind === "del" ? styles.del : ""} ${active ? styles.selected : ""}`}
                  >
                    <button
                      disabled={!canComment || r.kind === "meta" || pending}
                      type="button"
                      aria-label={`Comment on ${side === "LEFT" ? "old" : "new"} line ${line}`}
                      aria-pressed={!!active}
                      onClick={(e) => select(r, hi, e.shiftKey)}
                    >
                      <span>{r.old}</span>
                      <span>{r.new}</span>
                    </button>
                    <span>
                      {r.kind === "add" ? "+" : r.kind === "del" ? "−" : " "}
                    </span>
                    <code>{r.text || " "}</code>
                  </div>
                );
              })}
            </div>
            {hunk.rows.length > shown && (
              <button
                type="button"
                className={styles.more}
                onClick={() => setShown(shown + 200)}
              >
                Show more lines ({hunk.rows.length - shown} remaining)
              </button>
            )}
            {chosen && (
              <form
                className={styles.composer}
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await (onPendingComment??onComment)(chosen, body)) {
                    setBody("");
                    setSelection(null);
                  }
                }}
              >
                {chosen.side==="RIGHT"&&<Button size="sm" disabled={pending} onClick={()=>{
                  const selected=hunk.rows.filter(row=>row.new!==null&&row.new>=chosen.startLine&&row.new<=chosen.line).map(row=>row.text);
                  const next=(body.trim()?body.trimEnd()+"\n\n":"")+suggestionFence(selected);
                  if(next.length>16000){setNotice("This selection is too large for a suggestion. Select fewer lines.");return;}
                  setBody(next);document.getElementById(`review-${hi}`)?.focus();
                }}>Suggest change</Button>}
                <label htmlFor={`review-${hi}`}>
                  Comment on {chosen.side === "LEFT" ? "before" : "after"} · L
                  {chosen.startLine}
                  {chosen.line !== chosen.startLine ? `–${chosen.line}` : ""}
                </label>
                <textarea
                  id={`review-${hi}`}
                  aria-label="Code review comment"
                  autoFocus
                  rows={3}
                  maxLength={16000}
                  placeholder="Describe your feedback on this code"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  disabled={pending}
                />
                <footer>
                  <Button
                    size="sm"
                    variant="primary"
                    type="submit"
                    disabled={pending || !body.trim()}
                  >
                    {pending ? "Saving…" : onPendingComment ? pendingLabel : "Post comment"}
                  </Button>
                  {onPendingComment&&<Button size="sm" disabled={pending||!body.trim()} onClick={async()=>{if(await onComment(chosen,body)){setBody("");setSelection(null);}}}>Post single comment</Button>}
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() => {
                      setBody("");
                      setSelection(null);
                      setNotice("");
                    }}
                  >
                    Cancel
                  </Button>
                </footer>
              </form>
            )}
            {roots.map((root) => (
              <ReviewThread
                key={root.id}
                root={root}
                replies={comments.filter((c) => c.replyTo === root.id)}
                canComment={canComment}
                pending={pending}
                onReply={(text) => onComment(root, text, root.id)}
                onResolve={() => onResolve(root)}
                onChooseSuggestion={onChooseSuggestion}
                suggestionSelected={selectedSuggestions?.has(root.id)}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}
