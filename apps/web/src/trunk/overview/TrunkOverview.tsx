"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { LinkButton } from "@/components/ui";
import { ViewToggle } from "@/components/Panel";
import { TimeSeries } from "@/components/TimeSeries";
import { openReviews } from "@/components/ReviewQueue";
import { useLiveRoom, useTrunk } from "../context";
import { trunkHref, commitHref } from "../paths";
import { useClock } from "../live/useClock";

export function TrunkOverview() {
  const { trunk, repo, head } = useTrunk();
  const room = useLiveRoom();
  const now = useClock() + room.skew;
  const [table, setTable] = useState(false);
  const [reviews, setReviews] = useState<number | null>(null);
  useEffect(
    () => setReviews(openReviews(trunk, room.feed)),
    [trunk, room.tick, room.feed],
  );
  const agents = [...room.agents.values()];
  const real = agents.filter((a) => a.kind === "agent");
  const practice = agents.filter((a) => a.kind === "scripted");
  const active = real.filter((a) => now - a.seen < 120_000);
  const open = [...room.issues.values()].filter((i) => i.state !== "closed");
  const changes = room.feed
    .filter((e) => e.t === "landed" || e.t === "conflict" || e.t === "rejected")
    .slice(-8)
    .reverse();
  const hasCodingLanding =
    real.some((a) => a.landed > 0) ||
    room.feed.some((e) => e.t === "landed" && e.kind === "agent");
  const setup = real.length === 0 && !hasCodingLanding;
  const needsFirstChange = !hasCodingLanding;
  const last = Math.floor(now / 1000) - 1;
  const values = Array.from(
    { length: 120 },
    (_, i) => room.seconds.get(last - 119 + i)?.landed ?? 0,
  );
  const connected = room.status === "live";
  const loaded = connected || room.agents.size > 0 || room.feed.length > 0;
  return (
    <main className="mx-auto max-w-6xl space-y-6 px-5 py-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-xs text-muted">Repository overview</p>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            {repo?.fullName ?? trunk}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-2">
            {repo?.description ??
              "Agent work, changes and next steps on this trunk."}
          </p>
          <p role="status" className="mt-2 text-xs text-muted">
            {connected
              ? "Live updates connected"
              : room.status === "connecting"
                ? "Connecting to repository activity…"
                : "Activity disconnected. Reconnecting; displayed values may be stale."}
            {head && ` · Published v${head.version}`}
          </p>
        </div>
        <LinkButton href={trunkHref(trunk)} variant="secondary">
          View code →
        </LinkButton>
      </header>
      {loaded && needsFirstChange && (
        <section className="flex flex-wrap items-center justify-between gap-4 border-y border-line py-6">
          <div>
            <h2 className="text-base font-semibold text-ink">
              {setup
                ? "Connect your first coding agent"
                : "Land your first change"}
            </h2>
            <p className="mt-1 max-w-xl text-sm leading-6 text-ink-2">
              {setup
                ? "Give your agent access to this trunk, then assign an issue. Its work will appear below."
                : "Your coding agent has connected. Assign a task, send a change and verify its first landing."}
              {practice.length > 0 &&
                " Recorded agents so far are practice agents."}
            </p>
          </div>
          <LinkButton href={trunkHref(trunk, "/setup")} variant="primary">
            {setup ? "Open agent setup →" : "Land first change →"}
          </LinkButton>
        </section>
      )}
      {loaded && (
        <>
          <dl className="grid grid-cols-2 border-y border-line md:grid-cols-4">
            <Metric
              label="Active coding agents"
              value={connected ? active.length : "N/A"}
              note={
                connected
                  ? "Seen in the last 2 minutes"
                  : "Unavailable while disconnected"
              }
            />
            <Metric
              label="Recorded landings"
              value={room.totals.landed}
              note="Includes practice agents"
            />
            <Metric
              label="Open issues"
              value={open.length}
              note="Open or in progress"
              href={trunkHref(trunk, "/issues")}
            />
            <Metric
              label="Review items"
              value={reviews ?? "N/A"}
              note="Unreviewed in recent feed"
              href={trunkHref(trunk, "/live#review")}
            />
          </dl>
          <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-ink">
                  Recent changes
                </h2>
                <Link
                  href={trunkHref(trunk, "/live")}
                  className="text-xs text-series-1 hover:underline"
                >
                  All activity →
                </Link>
              </div>
              {changes.length === 0 ? (
                <div className="border-y border-line py-8">
                  <p className="text-sm text-ink-2">
                    No changes in the recent activity feed.
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Assign work to an agent, or browse the imported commit
                    history.
                  </p>
                  <Link
                    href={trunkHref(trunk, "/commits")}
                    className="mt-3 inline-block text-xs text-series-1 hover:underline"
                  >
                    View commit history →
                  </Link>
                </div>
              ) : (
                <ul className="border-t border-line">
                  {changes.map((e) => {
                    if (
                      e.t !== "landed" &&
                      e.t !== "conflict" &&
                      e.t !== "rejected"
                    )
                      return null;
                    return (
                      <li key={e.seq} className="border-b border-line py-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm text-ink">
                              {e.t === "landed" ? (
                                <Link
                                  href={commitHref(trunk, e.version)}
                                  className="font-medium hover:underline"
                                >
                                  {e.intent || `Landed v${e.version}`}
                                </Link>
                              ) : e.t === "conflict" ? (
                                e.intent || "Change requires re-planning"
                              ) : (
                                "Change rejected"
                              )}
                            </p>
                            <p className="mt-1 text-xs text-muted">
                              {e.agent} ·{" "}
                              {e.kind === "scripted"
                                ? "Practice agent"
                                : "Coding agent"}{" "}
                              ·{" "}
                              {e.t === "landed"
                                ? `Landed v${e.version}`
                                : e.t === "conflict"
                                  ? "Conflict"
                                  : e.error}
                            </p>
                          </div>
                          <time
                            dateTime={new Date(e.at).toISOString()}
                            className="text-[11px] text-muted"
                          >
                            {new Date(e.at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </time>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-ink">Agent status</h2>
                <Link
                  href={trunkHref(trunk, "/people")}
                  className="text-xs text-series-1 hover:underline"
                >
                  People →
                </Link>
              </div>
              <p className="mb-4 text-xs leading-5 text-muted">
                {real.length} coding agents recorded · {practice.length}{" "}
                practice agents recorded. Recorded agents may be inactive.
              </p>
              {real.length === 0 ? (
                <p className="border-t border-line py-4 text-sm text-ink-2">
                  No coding agent has reported yet.
                </p>
              ) : (
                <ul className="border-t border-line">
                  {real.slice(0, 6).map((a) => (
                    <li
                      key={a.name}
                      className="flex justify-between gap-3 border-b border-line py-3 text-xs"
                    >
                      <span className="truncate font-medium text-ink">
                        {a.name}
                      </span>
                      <span className="shrink-0 text-muted">
                        {!connected
                          ? "Status unavailable"
                          : now - a.seen < 120_000
                            ? "Seen recently"
                            : "Inactive"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-6 border-t border-line pt-4">
                <h3 className="text-xs font-semibold text-ink">Next work</h3>
                {open.length === 0 ? (
                  <p className="mt-2 text-xs text-muted">
                    No open issues. Add a task for an agent to pick up.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {open.slice(0, 3).map((i) => (
                      <li key={i.number}>
                        <Link
                          href={trunkHref(trunk, "/issues")}
                          className="text-xs text-ink-2 hover:underline"
                        >
                          #{i.number} {i.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                <Link
                  href={trunkHref(trunk, "/issues")}
                  className="mt-3 inline-block text-xs text-series-1 hover:underline"
                >
                  Open issues →
                </Link>
              </div>
            </section>
          </div>
          {values.some((n) => n > 0) ? (
            <section className="border-t border-line pt-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-ink">
                    Recent landing activity
                  </h2>
                  <p className="mt-1 text-xs text-muted">
                    Last 2 minutes, per second. Includes coding and practice
                    agents.
                  </p>
                </div>
                <ViewToggle table={table} onChange={setTable} />
              </div>
              <TimeSeries
                values={values}
                color="var(--series-1)"
                name="Landings"
                table={table}
                height={160}
              />
            </section>
          ) : (
            <p className="border-t border-line pt-5 text-xs text-muted">
              No landings recorded in the last 2 minutes. Live activity will
              appear as changes land.
            </p>
          )}
        </>
      )}
    </main>
  );
}
function Metric({
  label,
  value,
  note,
  href,
}: {
  label: string;
  value: number | string;
  note: string;
  href?: string;
}) {
  return (
    <div className="border-line px-4 py-4 even:border-l md:[&:not(:first-child)]:border-l">
      <dt className="text-xs text-ink-2">
        {href ? (
          <Link href={href} className="hover:underline">
            {label} →
          </Link>
        ) : (
          label
        )}
      </dt>
      <dd className="mt-1 text-2xl font-semibold text-ink">
        {typeof value === "number" ? value.toLocaleString("en-US") : value}
      </dd>
      <p className="mt-1 text-[11px] text-muted">{note}</p>
    </div>
  );
}
