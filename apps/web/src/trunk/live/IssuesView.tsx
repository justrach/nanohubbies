"use client";

import { useEffect, useRef, useState } from "react";
import { AgentDrawer } from "@/components/AgentDrawer";
import { GitHubSync } from "@/components/GitHubSync";
import { ImportContextNotice } from "@/components/ImportContextNotice";
import { IssueDrawer } from "@/components/IssueDrawer";
import { IssuesBoard } from "@/components/IssuesBoard";
import styles from "@/components/issues/Issues.module.css";
import { PeopleView } from "@/components/PeopleView";
import { useLiveRoom, useTrunk } from "../context";
import { useClock, useIssueList } from "./useClock";

/** The trunk's issues as a board. An issue opens in a drawer, and its number
 *  in the address (#12) opens it straight away, so a commit can link to it. */
export function IssuesView() {
  const { trunk, repo } = useTrunk();
  const room = useLiveRoom();
  const serverNow = useClock(5000) + room.skew;
  const issues = useIssueList(room, serverNow);
  const [issue, setIssue] = useState<number | null>(null);
  const previousIssue = useRef<number | null>(null);
  useEffect(() => {
    if (issue === null && previousIssue.current !== null) {
      document
        .querySelector<HTMLButtonElement>(
          `[data-issue-number="${previousIssue.current}"]`,
        )
        ?.focus({ preventScroll: true });
    }
    previousIssue.current = issue;
  }, [issue]);
  const [agent, setAgent] = useState<string | null>(null);
  useEffect(() => {
    const read = () => {
      const n = Number(location.hash.slice(1));
      setIssue(Number.isInteger(n) && n > 0 ? n : null);
    };
    read();
    addEventListener("hashchange", read);
    return () => removeEventListener("hashchange", read);
  }, []);
  const open = (n: number | null) => {
    history.replaceState(
      null,
      "",
      `${location.pathname}${location.search}${n === null ? "" : `#${n}`}`,
    );
    setIssue(n);
  };

  return (
    <main
      className={`${styles.workspace} ${issue !== null ? styles.withDetail : ""}`}
    >
      <div className={styles.listPane}>
        <ImportContextNotice repo={repo} kind="issues" />
        <IssuesBoard
          trunk={trunk}
          issues={issues}
          onOpen={open}
          selected={issue}
        />
        {repo && (
          <details className={styles.sync}>
            <summary>GitHub context</summary>
            <GitHubSync trunk={trunk} />
          </details>
        )}
      </div>
      {issue !== null && (
        <IssueDrawer
          embedded
          trunk={trunk}
          number={issue}
          onClose={() => open(null)}
          onAgent={(name) => {
            open(null);
            setAgent(name);
          }}
        />
      )}
      {agent && (
        <AgentDrawer
          trunk={trunk}
          name={agent}
          onClose={() => setAgent(null)}
        />
      )}
    </main>
  );
}

/** Everyone whose agents work here, and whose changes they re-planned around. */
export function PeopleTab() {
  const room = useLiveRoom();
  const serverNow = useClock(5000) + room.skew;
  return (
    <main className="mx-auto max-w-[1440px] px-5 py-5">
      <PeopleView
        people={room.people}
        watchers={room.watchers}
        swarms={room.swarms}
        clashes={room.clashes}
        serverNow={serverNow}
      />
    </main>
  );
}
