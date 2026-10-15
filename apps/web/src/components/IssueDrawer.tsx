import {
  CircleCheck,
  CircleX,
  ExternalLink,
  RotateCcw,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, trunkPath } from "@/lib/api";
import { ago } from "@/lib/format";
import type { Issue } from "@/lib/types";
import styles from "./issues/Issues.module.css";
import { AgentChanges } from "./issues/review/AgentChanges";

interface Detail {
  issue: Issue;
  work: {
    agent: string;
    owner: string | null;
    change: string;
    version: number | null;
    outcome: string;
    at: number;
  }[];
}

const OUTCOME: Record<
  string,
  { label: string; color: string; Icon: LucideIcon }
> = {
  landed: { label: "landed", color: "var(--good)", Icon: CircleCheck },
  conflict: {
    label: "conflicted, re-planned",
    color: "var(--warning)",
    Icon: RotateCcw,
  },
  rejected: { label: "rejected", color: "var(--critical)", Icon: CircleX },
};

/** One issue: what it asks for, and every change that worked on it. */
export function IssueDrawer({
  trunk,
  number,
  onClose,
  onAgent,
  embedded = false,
}: {
  trunk: string;
  number: number;
  onClose: () => void;
  onAgent: (name: string) => void;
  embedded?: boolean;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const close = useRef<HTMLButtonElement>(null);
  const pane = useRef<HTMLElement>(null);
  const [mobile, setMobile] = useState(false);
  const [tab, setTab] = useState("details");
  const [reviewVersion, setReviewVersion] = useState<number | null>(null);
  const modal = mobile || !embedded;
  useEffect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!mobile) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [mobile]);
  useEffect(() => {
    close.current?.focus({ preventScroll: true });
    setTab("details");
    setReviewVersion(null);
  }, [number]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (!modal || event.key !== "Tab") return;
      const controls = pane.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
      );
      if (!controls?.length) return;
      const first = controls[0],
        last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [number, onClose, modal]);
  useEffect(() => {
    let alive = true;
    let pending = false;
    setDetail(null);
    setError(null);
    async function load() {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const next = await api<Detail>(`${trunkPath(trunk)}/issues/${number}`);
        if (alive) {
          setDetail(next);
          setError(null);
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        pending = false;
      }
    }
    void load();
    const timer = window.setInterval(load, 3000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [trunk, number]);
  const i = detail?.issue;

  return (
    <aside
      ref={pane}
      role={modal ? "dialog" : undefined}
      aria-modal={modal || undefined}
      className={`${styles.detail} ${embedded ? styles.embedded : styles.floating}`}
      aria-label={`Issue ${number}`}
      tabIndex={-1}
    >
      <div className={styles.detailToolbar}>
        <h2 className={styles.detailTitle}>{i?.title ?? "Loading issue…"}</h2>
        <button
          ref={close}
          type="button"
          onClick={onClose}
          aria-label="Close issue"
          title="Close (Escape)"
          className="grid size-7 shrink-0 place-items-center rounded text-ink-2 hover:bg-wash"
        >
          <X size={16} />
        </button>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {!i && !error && (
        <p role="status" className={styles.loading}>
          Loading issue…
        </p>
      )}
      {i && (
        <>
          <p className={styles.detailMeta}>
            #{number}
            {" · "}
            {i.state === "closed"
              ? i.closedBy
                ? `Closed by ${i.closedBy}${i.closedIn ? ` in v${i.closedIn}` : ""}`
                : "Closed on GitHub"
              : i.state === "progress"
                ? "In progress"
                : "Open"}
            {i.heldBy && i.state !== "closed" ? `, held by ${i.heldBy}` : ""}
            {i.origin === "github" &&
            i.state === "closed" &&
            i.upstream === "open"
              ? " on this trunk, still open on GitHub"
              : ""}
            {" · "}opened by {i.author} {ago(Date.now() - i.created)}
            {i.url && (
              <a
                href={i.url}
                target="_blank"
                rel="noreferrer"
                className="ml-2 inline-flex items-center gap-0.5 text-ink-2 hover:text-ink"
              >
                on GitHub <ExternalLink size={10} aria-hidden />
              </a>
            )}
          </p>
          {i.labels.length > 0 && (
            <div className={styles.detailLabels}>
              {i.labels.map((l) => (
                <span key={l.name} className="flex items-center gap-1">
                  <span
                    className="inline-block size-2 rounded-full"
                    style={{ background: `#${l.color}` }}
                    aria-hidden
                  />
                  {l.name}
                </span>
              ))}
            </div>
          )}
          <div
            className={styles.detailTabs}
            role="group"
            aria-label="Issue view"
          >
            <button
              type="button"
              aria-pressed={tab === "details"}
              onClick={() => setTab("details")}
            >
              Details
            </button>
            <button
              type="button"
              aria-pressed={tab === "changes"}
              onClick={() => setTab("changes")}
            >
              Code changes{" "}
              <span>
                {
                  detail!.work.filter(
                    (w) => w.version !== null && w.outcome === "landed",
                  ).length
                }
              </span>
            </button>
          </div>
          {tab === "changes" ? (
            <AgentChanges
              key={`${number}:${reviewVersion}`}
              initialVersion={reviewVersion}
              trunk={trunk}
              work={detail!.work}
            />
          ) : (
            <>
              <section
                className={styles.description}
                aria-label="Issue description"
              >
                <h3>Description</h3>
                <div className="md">
                  {/* Issue templates leave HTML comments, which GitHub hides too. */}
                  {i.body.replace(/<!--[\s\S]*?-->/g, "").trim() ? (
                    <Markdown remarkPlugins={[remarkGfm]}>
                      {i.body.replace(/<!--[\s\S]*?-->/g, "")}
                    </Markdown>
                  ) : (
                    <p className="text-muted">No description.</p>
                  )}
                </div>
              </section>
              <h3 className="mt-8 text-sm font-medium text-ink">
                Agent activity{" "}
                <span className="tabular font-normal text-muted">
                  {detail!.work.length}
                </span>
              </h3>
              {detail!.work.length === 0 && (
                <p className="mt-2 text-xs text-muted">
                  No agent has taken it yet.
                </p>
              )}
              <ol className="mt-2 divide-y divide-line">
                {detail!.work.map((w) => {
                  const o = OUTCOME[w.outcome] ?? OUTCOME.landed;
                  return (
                    <li
                      key={w.change}
                      className="flex items-start gap-2 py-3 text-xs"
                    >
                      <o.Icon
                        size={13}
                        strokeWidth={2.25}
                        style={{ color: o.color }}
                        className="mt-0.5 shrink-0"
                        aria-hidden
                      />
                      <p className="min-w-0 flex-1 truncate">
                        <button
                          type="button"
                          onClick={() => onAgent(w.agent)}
                          className="font-medium text-ink hover:underline"
                        >
                          {w.agent}
                        </button>{" "}
                        <span className="text-ink-2">{o.label}</span>
                        {w.version ? (
                          <span className="tabular text-muted">
                            {" "}
                            as v{w.version}
                          </span>
                        ) : null}
                        {w.owner && (
                          <span className="text-muted"> for {w.owner}</span>
                        )}
                      </p>
                      {w.version && (
                        <button
                          type="button"
                          onClick={() => {
                            setReviewVersion(w.version);
                            setTab("changes");
                          }}
                          className="shrink-0 text-ink-2 hover:underline"
                        >
                          Review code
                        </button>
                      )}
                      <span className="tabular shrink-0 text-[11px] text-muted">
                        {ago(Date.now() - w.at)}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </>
      )}
    </aside>
  );
}
