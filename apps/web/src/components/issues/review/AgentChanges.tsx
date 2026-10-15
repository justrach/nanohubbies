import { useEffect, useMemo, useRef, useState } from "react";
import { api, trunkPath } from "@/lib/api";
import { useSession } from "@/lib/session";
import Link from "next/link";
import { commitHref } from "@/trunk/paths";
import type { CommitView } from "@/trunk/types";
import { HunkReview } from "./HunkReview";
import type { CodeAnchor, CodeComment, CommentList, IssueWork } from "./types";
import styles from "./Review.module.css";

/** Issue-linked agent changes, loaded only when the review tab is opened. */
export function AgentChanges({
  trunk,
  work,
  initialVersion = null,
}: {
  trunk: string;
  work: IssueWork[];
  initialVersion?: number | null;
}) {
  const { user } = useSession();
  const versions = useMemo(
    () =>
      work
        .filter((w) => w.version !== null && w.outcome === "landed")
        .filter(
          (w, index, list) =>
            list.findIndex((v) => v.version === w.version) === index,
        ),
    [work],
  );
  const [version, setVersion] = useState<number | null>(
    initialVersion ?? versions[0]?.version ?? null,
  );
  const [view, setView] = useState<CommitView | null>(null);
  const [comments, setComments] = useState<CommentList>({
    comments: [],
    truncated: false,
  });
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const requestId = useRef<{ key: string; id: string } | null>(null);
  useEffect(() => {
    if (version === null && versions[0]) setVersion(versions[0].version);
  }, [version, versions]);
  useEffect(() => {
    if (version === null) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setView(null);
    Promise.all([
      api<CommitView>(`${trunkPath(trunk)}/commit/${version}`),
      api<CommentList>(`${trunkPath(trunk)}/commit/${version}/comments`),
    ])
      .then(([change, discussion]) => {
        if (!alive) return;
        setView(change);
        setComments(discussion);
        setPath(change.files[0]?.path ?? "");
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [trunk, version]);
  async function post(anchor: CodeAnchor, body: string, replyTo?: string) {
    if (!view || pending || !body.trim()) return false;
    const key = JSON.stringify([
      view.commit,
      anchor.path,
      anchor.side,
      anchor.startLine,
      anchor.line,
      body,
      replyTo,
    ]);
    if (requestId.current?.key !== key)
      requestId.current = { key, id: crypto.randomUUID() };
    setPending(true);
    setError(null);
    try {
      const result = await api<CommentList>(
        `${trunkPath(trunk)}/commit/${view.version}/comments`,
        {
          body: {
            ...anchor,
            id: requestId.current.id,
            commit: view.commit,
            body,
            replyTo: replyTo ?? null,
          },
        },
      );
      setComments(result);
      requestId.current = null;
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setPending(false);
    }
  }
  async function resolve(root: CodeComment) {
    if (!view || pending) return;
    setPending(true);
    setError(null);
    try {
      setComments(
        await api<CommentList>(
          `${trunkPath(trunk)}/commit/${view.version}/comments`,
          {
            method: "PATCH",
            body: {
              id: root.id,
              commit: view.commit,
              resolved: !root.resolved,
            },
          },
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }
  const file = view?.files.find((f) => f.path === path);
  if (!versions.length)
    return (
      <div className={styles.empty}>
        <h3>No code changes yet</h3>
        <p>
          When an agent lands a change linked to this issue, its files and
          review threads appear here.
        </p>
      </div>
    );
  return (
    <section className={styles.review} aria-label="Agent code review">
      <div className={styles.controls}>
        <label>
          Agent change
          <select
            aria-label="Select agent change"
            value={version ?? ""}
            disabled={pending}
            onChange={(e) => setVersion(Number(e.target.value))}
          >
            {versions.map((w) => (
              <option key={w.version} value={w.version!}>
                v{w.version} · {w.agent}
              </option>
            ))}
          </select>
        </label>
        {view && (
          <Link href={commitHref(trunk, view.version)}>
            Open full change ↗
          </Link>
        )}
      </div>
      {loading && (
        <p role="status" className={styles.empty}>
          Loading code changes…
        </p>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {view && (
        <>
          <p className={styles.subject}>{view.subject}</p>
          <div className={styles.fileBar}>
            <select
              aria-label="Select changed file"
              value={path}
              disabled={pending}
              onChange={(e) => setPath(e.target.value)}
            >
              {view.files.map((f) => (
                <option key={f.path} value={f.path}>
                  {f.path}
                </option>
              ))}
            </select>
            <span>
              {view.files.length} files ·{" "}
              {
                comments.comments.filter((c) => !c.replyTo && !c.resolved)
                  .length
              }{" "}
              open threads
            </span>
          </div>
          {file && (
            <HunkReview
              key={`${view.commit}:${path}`}
              file={file}
              draftKey={`${user?.id ?? "guest"}:${trunk}:${view.commit}:${path}`}
              comments={comments.comments.filter((c) => c.path === path)}
              canComment={!!user}
              pending={pending}
              onComment={post}
              onResolve={resolve}
            />
          )}
          {!view.files.length && (
            <p className={styles.empty}>No file changes in this version.</p>
          )}
          {(comments.truncated || view.truncated.length > 0) && (
            <p className={styles.hint}>
              {view.truncated.join(" · ")}
              {comments.truncated
                ? " · More review comments are not shown."
                : ""}
            </p>
          )}
        </>
      )}
    </section>
  );
}
