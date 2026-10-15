"use client";

import { useEffect, useMemo, useState } from "react";
import type { RoomView } from "@/lib/room";
import type { Issue } from "@/lib/types";

const QUIET_MS = 120_000;

/** The time now, every `ms`: a slow clock, so charts keep sliding when the trunk is quiet. */
export function useClock(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

/** The trunk's issues, with how many agents are on each: those whose latest
 *  change named it, recently. A hint, like the agenda the agents pick from. */
export function useIssueList(room: RoomView, serverNow: number): Issue[] {
  return useMemo(() => {
    const on = new Map<number, number>();
    for (const a of room.agents.values()) if (a.issue != null && serverNow - a.seen < QUIET_MS) on.set(a.issue, (on.get(a.issue) ?? 0) + 1);
    return [...room.issues.values()]
      .map((i): Issue => ({ ...i, agents: on.get(i.number) ?? 0 }))
      .sort((a, b) => (a.state === "closed" && b.state === "closed" ? (b.closedIn ?? 0) - (a.closedIn ?? 0) : a.number - b.number));
  }, [room.tick, Math.floor(serverNow / 5000)]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** How many agents were seen in the last two minutes. */
export function useLiveCount(room: RoomView, serverNow: number): number {
  return useMemo(() => {
    let n = 0;
    for (const a of room.agents.values()) if (serverNow - a.seen < QUIET_MS) n++;
    return n;
  }, [room.tick, Math.floor(serverNow / 5000)]); // eslint-disable-line react-hooks/exhaustive-deps
}
