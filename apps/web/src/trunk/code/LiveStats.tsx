"use client";

import { useEffect, useState } from "react";
import { useLiveRoom } from "../context";

const QUIET_MS = 120_000;

/** What the trunk's agents are doing now, from the live feed. */
export function LiveStats() {
  const room = useLiveRoom();
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(t);
  }, []);
  let live = 0;
  for (const a of room.agents.values()) if (now && now + room.skew - a.seen < QUIET_MS) live++;
  const rows: [string, number][] = [
    ["agents working now", live],
    ["changes landed", room.totals.landed],
    ["conflicts re-planned", room.totals.conflicts],
    ["people", room.people.length],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5">
      {rows.map(([label, n]) => (
        <div key={label}>
          <dt className="sr-only">{label}</dt>
          <dd className="tabular text-lg leading-6 font-semibold text-ink">{n.toLocaleString("en-US")}</dd>
          <dd className="text-[11px] text-muted">{label}</dd>
        </div>
      ))}
    </dl>
  );
}
