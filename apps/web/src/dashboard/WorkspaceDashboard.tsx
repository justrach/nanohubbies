"use client";

import { useState } from "react";
import { FolderGit2, Plus, Search } from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { Button, Input } from "@/components/controls";
import { LinkButton } from "@/components/ui";
import type { TrunkListing } from "@/lib/types";
import { WorkspaceHome, sourceLabel } from "./WorkspaceHome";
import styles from "./WorkspaceDashboard.module.css";
import { useSession } from "@/lib/session";
import { DashboardWelcome } from "./DashboardWelcome";

/** A project sidebar and one focused workspace, following Harness's layout. */
export function WorkspaceDashboard({
  repositories,
  unavailable = false,
  error = null,
  localApi = false,
}: {
  repositories: TrunkListing[];
  unavailable?: boolean;
  error?: string | null;
  localApi?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const { user } = useSession();
  const ordered = [...repositories].sort((a, b) => b.created - a.created);
  const current =
    ordered.find((repo) => repo.name === selected) ?? ordered[0] ?? null;
  const shown = ordered.filter((repo) =>
    `${repo.name} ${repo.source}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  if (!user) return <DashboardWelcome error={error} />;
  return (
    <div className={styles.app}>
      <TopBar crumbs={<span className="text-sm text-ink-2">Workspaces</span>} />
      {localApi && <div className={styles.environment}><strong>Local development</strong><span>These workspaces are on your local server.</span><a href="https://nanohub.sh/dashboard">Open hosted workspaces ↗</a></div>}
      {error && (
        <p
          role="alert"
          className="border-b border-line px-5 py-3 text-sm text-critical"
        >
          {error}
        </p>
      )}
      <div className={styles.layout}>
        <aside className={styles.sidebar} aria-label="Workspace navigation">
          <div className={styles.sidebarHeading}>
            <span>Workspaces</span>
            <span className={styles.count}>{repositories.length}</span>
          </div>
          {repositories.length > 0 && <LinkButton href="/start" className={styles.newWorkspace}>
            <Plus size={15} />
            New workspace
          </LinkButton>}
          {repositories.length > 0 && (
            <label className={styles.search}>
              <Search size={14} aria-hidden />
              <Input
                type="search"
                aria-label="Find a workspace"
                placeholder="Find a workspace…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="min-w-0 flex-1 border-0 bg-transparent"
              />
            </label>
          )}
          <nav className={styles.workspaceList} aria-label="Your workspaces">
            {shown.map((repo) => (
              <button
                key={repo.name}
                type="button"
                className={`${styles.workspace} ${current?.name === repo.name ? styles.selected : ""}`}
                aria-current={current?.name === repo.name ? "true" : undefined}
                title={`${repo.name} · ${sourceLabel(repo.source)}`}
                onClick={() => setSelected(repo.name)}
              >
                <FolderGit2 size={17} aria-hidden />
                <span>
                  <strong>{repo.name}</strong>

                </span>
              </button>
            ))}
            {!shown.length && (
              <p className={styles.sidebarEmpty}>
                {query
                  ? "No matching workspaces."
                  : "Your workspaces will appear here."}
              </p>
            )}
          </nav>
          <div className={styles.sidebarNote}>
            <strong>One place for the work</strong>
            <p>
              Code, issues, agent conversations and changes in each
              workspace.
            </p>
          </div>
        </aside>
        <main className={styles.main}>
          {unavailable ? (
            <section role="alert" className={styles.empty}>
              <h1>Workspaces couldn’t be loaded</h1>
              <p>The workspace service is unavailable. Try loading it again.</p>
              <Button onClick={() => window.location.reload()}>
                Reload workspaces
              </Button>
            </section>
          ) : current ? (
            <WorkspaceHome key={current.name} workspace={current} />
          ) : (
            <section className={styles.empty}>
              <div className={styles.emptyIcon}>
                <FolderGit2 size={27} />
              </div>
              <p className={styles.eyebrow}>Your coding workspace</p>
              <h1>Start with a repository</h1>
              <p>
                Bring in a repository, connect an agent you already use, and
                keep its work in one place.
              </p>
              <LinkButton href="/start" variant="primary">
                <Plus size={15} />
                Create your first workspace
              </LinkButton>
              <ol className={styles.steps}>
                <li>
                  <span>1</span>Choose a repository
                </li>
                <li>
                  <span>2</span>Connect your agent
                </li>
                <li>
                  <span>3</span>Review its changes
                </li>
              </ol>
            </section>
          )}
          {repositories.length === 500 && (
            <p className="mt-5 text-xs text-muted">
              Showing the newest 500 workspaces returned by the server.
            </p>
          )}
        </main>
      </div>
    </div>
  );
}
