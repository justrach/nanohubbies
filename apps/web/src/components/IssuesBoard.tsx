import {
  ChevronDown,
  CircleCheck,
  CircleDot,
  ExternalLink,
  LoaderCircle,
  Plus,
  Search,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { api, trunkPath } from "@/lib/api";
import { ago } from "@/lib/format";
import { Button, Input } from "./controls";
import type { Issue, IssueState } from "@/lib/types";
import { filterIssues, type IssueFilter, type IssueSort } from "./issues/model";
import styles from "./issues/Issues.module.css";

const GROUPS: {
  state: IssueState;
  label: string;
  Icon: LucideIcon;
  color: string;
}[] = [
  { state: "open", label: "Open", Icon: CircleDot, color: "var(--muted)" },
  {
    state: "progress",
    label: "In progress",
    Icon: LoaderCircle,
    color: "var(--series-1)",
  },
  {
    state: "closed",
    label: "Closed",
    Icon: CircleCheck,
    color: "var(--good-text)",
  },
];

/** A grouped issue inbox. The selected row stays visible beside its details. */
export function IssuesBoard({
  trunk,
  issues,
  onOpen,
  selected,
}: {
  trunk: string;
  issues: Issue[];
  onOpen: (n: number) => void;
  selected?: number | null;
}) {
  const [filter, setFilter] = useState<IssueFilter>("all");
  const [query, setQuery] = useState("");
  const [label, setLabel] = useState("");
  const [sort, setSort] = useState<IssueSort>("newest");
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labels = useMemo(
    () =>
      [...new Set(issues.flatMap((i) => i.labels.map((l) => l.name)))].sort(),
    [issues],
  );
  const matching = useMemo(
    () => filterIssues(issues, query, label, sort),
    [issues, query, label, sort],
  );
  const groups = GROUPS.filter(
    (group) => filter === "all" || filter === group.state,
  );
  const count = (state: IssueFilter) =>
    issues.filter((i) => state === "all" || i.state === state).length;
  const clear = () => {
    setQuery("");
    setLabel("");
    setFilter("all");
  };

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api(`${trunkPath(trunk)}/issues`, {
        body: { title: title.trim(), body: "" },
      });
      setTitle("");
      setAdding(false);
      clear();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.inbox} aria-label="Issue inbox">
      <header className={styles.heading}>
        <div>
          <h1>
            Issues <span>{issues.length}</span>
          </h1>
        </div>
        <Button
          onClick={() => {
            setAdding(!adding);
            setError(null);
          }}
          aria-expanded={adding}
        >
          <Plus size={14} aria-hidden /> New issue
        </Button>
      </header>
      {adding && (
        <form onSubmit={add} className={styles.newIssue}>
          <Input
            autoFocus
            aria-label="Issue title"
            placeholder="What needs doing?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
            required
          />
          <Button
            type="submit"
            variant="primary"
            disabled={busy || !title.trim()}
          >
            {busy ? "Creating…" : "Create issue"}
          </Button>
          <Button
            onClick={() => {
              setAdding(false);
              setError(null);
            }}
            disabled={busy}
          >
            Cancel
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.filters} role="group" aria-label="Issue status">
        {([{ state: "all", label: "All issues" }, ...GROUPS] as const).map(
          (tab) => (
            <button
              key={tab.state}
              type="button"
              aria-pressed={filter === tab.state}
              onClick={() => setFilter(tab.state)}
            >
              {tab.label}
              <span>{count(tab.state)}</span>
            </button>
          ),
        )}
      </div>
      <div className={styles.toolbar}>
        <label className={styles.search}>
          <Search size={14} aria-hidden />
          <input
            type="search"
            aria-label="Search issues"
            placeholder="Search issues…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          aria-label="Filter by label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        >
          <option value="">All labels</option>
          {labels.map((entry) => (
            <option key={entry}>{entry}</option>
          ))}
        </select>
        <select
          aria-label="Sort issues"
          value={sort}
          onChange={(e) => setSort(e.target.value as IssueSort)}
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </div>
      <div className={styles.groups}>
        {groups.map((group) => {
          const items = matching.filter((i) => i.state === group.state);
          return (
            <details
              key={`${group.state}:${filter}:${!!query}:${label}`}
              className={styles.group}
              open={
                filter === group.state ||
                items.some((item) => item.number === selected) ||
                (items.length > 0 &&
                  (group.state !== "closed" ||
                    !!query ||
                    !!label ||
                    count("open") + count("progress") === 0))
              }
            >
              <summary>
                <ChevronDown size={13} className={styles.chevron} aria-hidden />
                <group.Icon
                  size={14}
                  style={{ color: group.color }}
                  aria-hidden
                />
                <h2>{group.label}</h2>
                <span>{items.length}</span>
              </summary>
              {items.length ? (
                <ol>
                  {items.map((item) => (
                    <li key={item.number}>
                      <IssueRow
                        issue={item}
                        selected={selected === item.number}
                        onOpen={() => onOpen(item.number)}
                      />
                    </li>
                  ))}
                </ol>
              ) : (
                <p className={styles.empty}>
                  {query || label
                    ? "No matching issues in this section."
                    : `No ${group.label.toLowerCase()} issues.`}
                </p>
              )}
            </details>
          );
        })}
        {matching.filter((i) => filter === "all" || i.state === filter)
          .length === 0 &&
          (query || label) && (
            <button className={styles.clear} type="button" onClick={clear}>
              Clear filters
            </button>
          )}
      </div>
    </section>
  );
}

function IssueRow({
  issue,
  selected,
  onOpen,
}: {
  issue: Issue;
  selected: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.row}
      data-issue-number={issue.number}
      aria-pressed={selected}
      onClick={onOpen}
      aria-label={`Issue #${issue.number}: ${issue.title}`}
    >
      <span className={styles.number}>#{issue.number}</span>
      <span className={styles.rowTitle}>
        <strong title={issue.title}>{issue.title}</strong>
        <span>
          {issue.author}
          {issue.heldBy && issue.state !== "closed"
            ? ` · ${issue.heldBy} is working on this`
            : issue.agents > 0 && issue.state !== "closed"
              ? ` · ${issue.agents} agents working`
              : ""}
        </span>
      </span>
      <span className={styles.rowLabels}>
        {issue.labels.slice(0, 2).map((entry) => (
          <span key={entry.name}>
            <i style={{ background: `#${entry.color}` }} />
            {entry.name}
          </span>
        ))}
        {issue.labels.length > 2 && <span>+{issue.labels.length - 2}</span>}
      </span>
      <span className={styles.rowMeta}>
        {issue.landed > 0 ? (
          `${issue.landed} landed`
        ) : issue.origin === "github" ? (
          <ExternalLink size={12} aria-label="Imported from GitHub" />
        ) : null}
      </span>
      <span className={styles.rowTime}>{ago(Date.now() - issue.created)}</span>
    </button>
  );
}
