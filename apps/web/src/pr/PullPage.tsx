import { useEffect, useRef, useState } from "react";
import { Tabs } from "@/components/Tabs";
import { TopBar } from "@/components/TopBar";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useHashTab } from "@/lib/useHashTab";
import { AccessNote } from "./Access";
import { Commits } from "./Commits";
import { Files } from "./Files";
import { Header } from "./Header";
import { Overview } from "./Overview";
import type { Access, PullView } from "./types";


const TABS = ["overview", "files", "commits"] as const;

/** A GitHub pull request, laid out to be read: what it says, what it changes
 *  file by file, and what reviewers said where. */
export function PullPage({ owner, repo, number }: { owner: string; repo: string; number: number }) {
  const [pull, setPull] = useState<PullView | null>(null);
  const [error, setError] = useState<{ message: string; access?: Access } | null>(null);
  const [tab, setTab] = useHashTab(TABS, "overview");
  const [round, setRound] = useState(0);

  // Back from connecting GitHub on Codegraff: read it again, with yours.
  const { github } = useSession();
  const lacked = useRef(false);
  useEffect(() => {
    if (github && !github.connected) lacked.current = true;
    else if (github?.connected && lacked.current) {
      lacked.current = false;
      setRound((n) => n + 1);
    }
  }, [github]);

  useEffect(() => {
    setPull(null);
    setError(null);
    api<PullView>(`/api/github/pulls/${owner}/${repo}/${number}`).then(setPull, (e: Error) =>
      setError({ message: e.message, access: e instanceof ApiError ? (e.body.access as Access | undefined) : undefined }),
    );
  }, [owner, repo, number, round]);
  useEffect(() => {
    document.title = pull ? `${pull.title} · ${pull.repo}#${pull.number}` : `${owner}/${repo}#${number}`;
  }, [pull, owner, repo, number]);

  return (
    <div className="pull-review min-h-screen">
      <TopBar
        crumbs={
          <span className="text-sm text-ink">
            {owner}/{repo} <span className="text-muted">#{number}</span>
          </span>
        }
      />
      <main className="mx-auto max-w-[1440px] px-5 pb-24 sm:px-8">
        {error && (
          <div className="mt-10 rounded-xl border border-line bg-surface p-5 text-sm">
            <p className="font-medium text-ink">Could not read this pull request.</p>
            <p className="mt-1 text-ink-2">{error.message}</p>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
              {error.access && <AccessNote access={error.access} />}
              <a href={`https://github.com/${owner}/${repo}/pull/${number}`} target="_blank" rel="noreferrer" className="text-ink-2 underline underline-offset-2">
                Open it on GitHub
              </a>
            </div>
          </div>
        )}
        {!pull && !error && <Loading />}
        {pull && (
          <>
            <Header pull={pull} />
            <div className="pull-review-tabs sticky top-0 z-20 mb-6 flex h-12 items-end bg-page">
              <div className="w-full">
                <Tabs
                  value={tab}
                  onChange={setTab}
                  tabs={[
                    { id: "overview", label: "Overview" },
                    { id: "files", label: "Files", count: pull.changedFiles },
                    { id: "commits", label: "Commits", count: pull.commits },
                  ]}
                />
              </div>
            </div>
            {tab === "overview" && <Overview pull={pull} onFiles={() => setTab("files")} />}
            {tab === "files" && <Files files={pull.files} threads={pull.threads} viewedKey={`${pull.repo}#${pull.number}`} />}
            {tab === "commits" && <Commits pull={pull} />}
          </>
        )}
      </main>
    </div>
  );
}

function Loading() {
  return (
    <div className="animate-pulse pt-8" aria-label="Loading">
      <div className="h-3 w-40 rounded bg-wash" />
      <div className="mt-3 h-7 w-2/3 rounded bg-wash" />
      <div className="mt-4 h-4 w-1/2 rounded bg-wash" />
      <div className="mt-10 h-64 rounded-xl bg-wash" />
      <p className="mt-3 text-xs text-muted">Reading the pull request from GitHub…</p>
    </div>
  );
}
