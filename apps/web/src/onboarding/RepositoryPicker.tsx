"use client";

import { Check, GitFork, Lock, RefreshCw, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Input } from "@/components/controls";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import {
  FRESH_FOR,
  repositoryCache,
  type Repository,
  type RepositorySnapshot,
} from "@/lib/repository-cache";

export function RepositoryPicker({
  compact = false,
  selected,
  disabled,
  onSelect,
}: {
  compact?: boolean;
  selected: string;
  disabled: boolean;
  onSelect: (repo: string) => void;
}) {
  const { user, github } = useSession();
  const scope =
    user?.provider === "codegraff" && github?.connected
      ? JSON.stringify([user.id, github.login ?? ""])
      : "";
  const active = useRef(scope);
  active.current = scope;
  const [snapshot, setSnapshot] = useState<RepositorySnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(compact ? 6 : 12);
  async function load(force: boolean) {
    if (!scope) return;
    const requestScope = scope;
    setLoading(true);
    setError("");
    try {
      const result = await repositoryCache.load(
        scope,
        () => api<Repository[]>("/api/github/repos"),
        force,
      );
      if (active.current === requestScope) setSnapshot(result);
    } catch (e) {
      if (active.current === requestScope) setError((e as Error).message);
    } finally {
      if (active.current === requestScope) setLoading(false);
    }
  }
  useEffect(() => {
    active.current = scope;
    setError("");
    setQuery("");
    setLimit(compact ? 6 : 12);
    setLoading(false);
    if (!scope) {
      setSnapshot(null);
      return;
    }
    const cached = repositoryCache.read(scope);
    setSnapshot(cached);
    if (!cached || Date.now() - cached.updatedAt >= FRESH_FOR) void load(false);
    return () => {
      active.current = "";
    };
    // Account scope changes own the request lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);
  if (!scope) return null;
  const current = snapshot?.scope === scope ? snapshot : null;
  const repos = current?.repos ?? [];
  const matches = repos.filter((r) =>
    r.full_name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <section
      className={compact ? "mt-6 border-t border-line pt-5" : "mt-6 rounded-xl border border-line bg-surface p-4"}
      aria-labelledby="your-repositories"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="your-repositories" className="text-sm font-semibold text-ink">
            Your GitHub repositories
          </h3>
          <p className="mt-1 text-xs text-muted" aria-live="polite">
            {current
              ? `${repos.length} available · Updated ${new Date(current.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              : "Choose a repository connected through Codegraff."}
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          type="button"
          disabled={loading || disabled}
          onClick={() => void load(true)}
        >
          <RefreshCw
            size={13}
            className={loading ? "animate-spin" : ""}
            aria-hidden
          />
          {loading && current ? "Refreshing…" : "Refresh"}
        </Button>
      </div>
      <label className="mt-4 flex items-center gap-2 rounded-md border border-line bg-page px-3">
        <Search size={14} className="shrink-0 text-muted" aria-hidden />
        <Input
          aria-label="Filter your repositories"
          placeholder="Find a repository…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(compact ? 6 : 12);
          }}
          className="min-w-0 flex-1 border-0 bg-transparent"
        />
      </label>
      {error && (
        <p role="alert" className="mt-3 text-xs text-critical">
          {current
            ? "Couldn’t refresh. Showing the saved list. "
            : "Couldn’t load repositories. "}
          {error}
        </p>
      )}
      {!current && loading ? (
        <div role="status" className="py-6 text-center text-sm text-muted">
          Loading your repositories…
        </div>
      ) : current && matches.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">
          {query
            ? "No repositories match your search."
            : "No repositories found. Try Refresh, or paste a repository URL above."}
        </p>
      ) : (
        <ul
          className={compact ? "mt-3 grid gap-1" : "mt-3 grid gap-2 sm:grid-cols-2"}
          aria-label="Your repositories"
        >
          {matches.slice(0, limit).map((repo) => (
            <li key={repo.full_name} className="min-w-0">
              <button
                type="button"
                disabled={disabled}
                aria-pressed={selected === repo.full_name}
                onClick={() => onSelect(repo.full_name)}
                title={repo.full_name}
                className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors disabled:opacity-50 ${selected === repo.full_name ? "border-series-1 bg-wash text-ink" : "border-line text-ink-2 hover:bg-wash hover:text-ink"}`}
              >
                {repo.private ? (
                  <Lock
                    size={14}
                    className="shrink-0"
                    aria-label="Private repository"
                  />
                ) : (
                  <GitFork
                    size={14}
                    className="shrink-0"
                    aria-label="Public repository"
                  />
                )}
                <span className="min-w-0 flex-1 truncate">
                  {repo.full_name}
                </span>
                {selected === repo.full_name && (
                  <Check
                    size={14}
                    className="shrink-0 text-series-1"
                    aria-hidden
                  />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {matches.length > limit && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-3"
          onClick={() => setLimit(limit + 24)}
        >
          Show more ({matches.length - limit} remaining)
        </Button>
      )}
      <p className="mt-3 text-xs text-muted">
        {compact ? "Select a repository, then continue below." : "Select a repository, then continue above."}
      </p>
    </section>
  );
}
