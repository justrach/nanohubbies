"use client";

import { NavigationPending } from "./NavigationPending";
import { WorkspaceNav, workspaceSection } from "./WorkspaceNav";
import { GettingStarted } from "@/onboarding/GettingStarted";

import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { openReviews } from "@/components/ReviewQueue";
import { SessionProvider } from "@/lib/session";
import type { WorkspaceBootstrap } from "./bootstrap";
import { useImportStatus } from "@/onboarding/useImportStatus";
import { ImportProgress } from "@/onboarding/ImportProgress";
import { TopBar } from "@/components/TopBar";
import { api, trunkPath } from "@/lib/api";
import { useRoom } from "@/lib/room";
import type { TrunkInfo } from "@/lib/types";
import { RoomContext, TrunkContext, type TrunkState } from "./context";
import { trunkHref } from "./paths";

/** Tabs the trunk page had before it had routes, kept working as links. */
const OLD_TABS: Record<string, string> = {
  "#live": "/live",
  "#issues": "/issues",
  "#people": "/people",
  "#code": "",
};

/** Every page of a trunk: the bar, the tabs, and the live feed they share. The
 *  feed stays connected while you move between tabs. */
export function TrunkShell({
  trunk,
  children,
  initial,
}: {
  trunk: string;
  children: ReactNode;
  initial: WorkspaceBootstrap;
}) {
  return (
    <SessionProvider key={trunk} initial={initial.session}>
      <WorkspaceShell trunk={trunk} initial={initial}>
        {children}
      </WorkspaceShell>
    </SessionProvider>
  );
}

function WorkspaceShell({
  trunk,
  children,
  initial,
}: {
  trunk: string;
  children: ReactNode;
  initial: WorkspaceBootstrap;
}) {
  const [archive,setArchive]=useState(initial.archive);
  const refreshArchive=useCallback(()=>{void api<NonNullable<WorkspaceBootstrap["archive"]>>(`${trunkPath(trunk)}/archive`).then(setArchive).catch(()=>{});},[trunk]);
  useEffect(()=>{setArchive(initial.archive);},[initial.archive]);
  useEffect(()=>{const timer=setInterval(()=>{if(!document.hidden)refreshArchive();},10000);window.addEventListener("focus",refreshArchive);return()=>{clearInterval(timer);window.removeEventListener("focus",refreshArchive);};},[refreshArchive]);
  const room = useRoom(trunk);
  const importing = useImportStatus(trunk, initial.job);
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const [info, setInfo] = useState<TrunkInfo | null>(initial.info);

  const pending = useRef(false);
  const activeTrunk = useRef(trunk);
  activeTrunk.current = trunk;
  const refreshHead = useCallback(async () => {
    if (document.hidden || pending.current) return;
    pending.current = true;
    try {
      const next = await api<TrunkInfo>(`${trunkPath(trunk)}/info`);
      if (activeTrunk.current === trunk) setInfo(next);
    } catch {
      /* The live connection and next poll can recover. */
    } finally {
      pending.current = false;
    }
  }, [trunk]);

  // Live changes trigger a debounced refresh; a visible-only poll recovers
  // missed events without waking hidden tabs every five seconds.
  useEffect(() => {
    // Initial state arrived in the authorized server render.
    const t = window.setInterval(() => void refreshHead(), 30000);
    const resume = () => void refreshHead();
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [refreshHead]);
  useEffect(() => {
    if (!room.version || room.version <= (info?.head.version ?? 0)) return;
    const t = window.setTimeout(() => void refreshHead(), 1000);
    return () => window.clearTimeout(t);
  }, [room.version, info?.head.version, refreshHead]);
  useEffect(() => {
    const to = OLD_TABS[location.hash];
    if (to !== undefined && location.pathname === trunkHref(trunk))
      router.replace(trunkHref(trunk, to));
  }, [trunk, router]);

  useEffect(() => {
    if (importing.job?.ready && !info?.head) void refreshHead();
  }, [importing.job?.ready, refreshHead]);

  const head = info?.head ?? null;
  const tip = Math.max(info?.tip.version ?? 0, room.version);
  const state = useMemo<TrunkState>(
    () => ({
      trunk,archive,readOnly:!!archive?.archived||!!archive?.transition&&!archive.transition.committed,refreshArchive,
      address: initial.address,
      isPrivate: initial.access?.private,
      repositoryMode: initial.repository?.mode,
      head,
      tip,
      repo: room.repo ?? initial.repo,
      importJob: importing.job,
      initialTokens: {
        owner: initial.session.user?.id ?? null,
        tokens: initial.tokens,
      },
    }),
    [trunk, head?.commit, tip, room.repo, importing.job, initial,archive,refreshArchive],
  ); // eslint-disable-line react-hooks/exhaustive-deps
  const reviews = useMemo(
    () => openReviews(trunk, room.feed),
    [trunk, room.tick],
  ); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <TrunkContext.Provider value={state}>
      <RoomContext.Provider value={room}>
        <div className="repo-shell workspace-shell">
          <NavigationPending />
          <div className="workspace-content">
            <div className="repo-chrome border-b border-line">
              <TopBar
                displayName={
                  initial.address
                    ? `${initial.address.namespace}/${initial.address.name}`
                    : undefined
                }
                workspaceHref={
                  initial.address
                    ? `/${initial.address.namespace}/${initial.address.name}`
                    : undefined
                }
                flush
                workspace
                section={workspaceSection(
                  pathname.slice(trunkHref(trunk).length),
                )}
                actions={
                  pathname.endsWith("/setup") ? undefined : <GettingStarted />
                }
                trunk={trunk}
                status={room.status}
                watchers={room.watchers}
                reviews={reviews}
                onBell={() => router.push(trunkHref(trunk, "/live#review"))}
              />
              <WorkspaceNav trunk={trunk} />
            </div>
            {(archive?.archived||archive?.transition)&&<aside className="border-b border-line bg-wash px-4 py-4 text-sm leading-6" role="status"><div className="mx-auto max-w-6xl"><strong>{archive.transition?.committed?'Repository is unarchiving.':archive.transition?'Archive change pending.':'This repository is archived.'}</strong>{' '}{archive.transition?.committed?'Some write paths remain locked until activation finishes.':archive.transition?'New writes are paused until the operation finishes.':'It is read-only. Existing members can still browse and clone.'}{' '}<a className="text-series-1 underline underline-offset-2" href={`${trunkHref(trunk,'/people')}#repository-archive`}>View archive settings</a></div></aside>}
            <ImportProgress job={importing.job} onRetry={importing.refresh} />
            {children}
          </div>
        </div>
      </RoomContext.Provider>
    </TrunkContext.Provider>
  );
}
