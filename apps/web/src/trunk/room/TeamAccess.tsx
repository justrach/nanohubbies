"use client";

import { ShieldCheck, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/controls";
import { Card } from "@/components/ui";
import { api, trunkPath } from "@/lib/api";
import { useSession } from "@/lib/session";

type Team = { kind?: "team" | "owner"; roomId: string; name: string; issuer: string; boundAt: number };
type Access = {
  team: Team | null;
  canConnect: boolean;
  verification: {
    method: string;
    verifiedAt: number;
    role: string;
    agentId: string | null;
  } | null;
};
type Membership = { id: string; name: string; role: "owner" | "member" };

export function TeamAccess({ trunk }: { trunk: string }) {
  const { user, loaded } = useSession();
  const [access, setAccess] = useState<Access | null>(null);
  const [rooms, setRooms] = useState<Membership[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scope = `${trunk}:${user?.id ?? ""}:${loaded}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const path = `${trunkPath(trunk)}/team`;
  useEffect(() => {
    let active = true;
    setBusy(false);
    setAccess(null);
    setRooms(null);
    setSelected("");
    setCursor(null);
    setError("");
    if (loaded)
      void api<Access>(path).then(
        (value) => active && setAccess(value),
        (e) => active && setError(e.message),
      );
    return () => {
      active = false;
    };
  }, [path, user?.id, loaded]);
  async function loadRooms(after = "") {
    const requestScope = scope;
    setBusy(true);
    setError("");
    try {
      const value = await api<{
        rooms: Membership[];
        nextCursor: string | null;
      }>(`/api/teams${after ? `?after=${encodeURIComponent(after)}` : ""}`);
      if (scopeRef.current !== requestScope) return;
      setRooms((previous) =>
        after ? [...(previous ?? []), ...value.rooms] : value.rooms,
      );
      setCursor(value.nextCursor);
    } catch (e) {
      if (scopeRef.current === requestScope) setError((e as Error).message);
    } finally {
      if (scopeRef.current === requestScope) setBusy(false);
    }
  }
  async function connect() {
    if (!selected || busy) return;
    const requestScope = scope;
    setBusy(true);
    setError("");
    try {
      const value = await api<Access>(path, { body: { roomId: selected } });
      if (scopeRef.current === requestScope) setAccess(value);
    } catch (e) {
      if (scopeRef.current === requestScope) setError((e as Error).message);
    } finally {
      if (scopeRef.current === requestScope) setBusy(false);
    }
  }
  const reconnect = `/api/auth/signin/codegraff?teams=1&return=${encodeURIComponent(`/t/${trunk}/room`)}`;
  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Users size={16} />
        Workspace access
      </h2>
      {access?.team && access.team.kind !== "owner" ? (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-ink">
            Private to <strong>{access.team.name}</strong>
          </p>
          <p className="text-xs leading-6 text-muted">
            Only accepted Codegraff room members and their verified agents can
            read or change this workspace. Membership is checked on each request
            and before live updates.
          </p>
          <p className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
            <ShieldCheck size={15} />
            Your Codegraff membership was verified as{" "}
            {access.verification?.role}.
          </p>
          <p className="text-xs leading-6 text-muted">
            Agent credentials are bound to their registered ID, owner and
            workspace. The server records the verification internally. Agent
            type, task and progress are self-reported.
          </p>
          <a
            className="text-xs text-series-1 underline underline-offset-2"
            href={`${access.team.issuer}/dashboard/agent-rooms/${access.team.roomId}`}
            target="_blank"
            rel="noreferrer"
          >
            Manage this room in Codegraff
          </a>
        </div>
      ) : access ? (
        <div className="mt-3 space-y-3">
          <p className="text-xs leading-6 text-muted">
            {access.team?.kind === "owner"
              ? "Private to you and your registered agents. Connect a Codegraff room below if you want to share this workspace with its accepted members."
              : "This workspace currently uses shared access. Connect a Codegraff room to restrict future reads, messages and changes to its accepted members. Copies already downloaded cannot be recalled."}
          </p>
          {access.canConnect ? (
            <>
              <Button disabled={busy} onClick={() => void loadRooms()}>
                Load my Codegraff rooms
              </Button>
              {rooms && (
                <>
                  <label className="block text-xs text-ink-2">
                    Choose a room you own
                    <select
                      className="mt-2 block w-full max-w-lg rounded border border-line bg-page px-3 py-2"
                      value={selected}
                      onChange={(e) => setSelected(e.target.value)}
                      disabled={busy}
                    >
                      <option value="">Select a room</option>
                      {rooms.map((room) => (
                        <option
                          key={room.id}
                          value={room.id}
                          disabled={room.role !== "owner"}
                        >
                          {room.name}
                          {room.role !== "owner" ? " (member)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  {rooms.length === 0 && (
                    <p className="text-xs text-muted">
                      No accepted rooms yet. Create a shared room in Harness, or
                      accept an invitation in Codegraff.
                    </p>
                  )}
                  {cursor && (
                    <Button
                      disabled={busy}
                      onClick={() => void loadRooms(cursor)}
                    >
                      Load more rooms
                    </Button>
                  )}
                  <p className="text-xs text-muted">
                    This connection cannot be changed back to shared access
                    here. Existing agents need individual registered
                    credentials; practice agents will stop.
                  </p>
                  <Button
                    variant="primary"
                    disabled={busy || !selected}
                    onClick={() => void connect()}
                  >
                    {busy ? "Verifying…" : "Restrict workspace to this team"}
                  </Button>
                </>
              )}
              <a
                className="block text-xs text-series-1 underline underline-offset-2"
                href={reconnect}
              >
                Allow team membership access in Codegraff
              </a>
            </>
          ) : (
            <p className="text-xs text-muted">
              The workspace creator can connect a team while signed in with
              Codegraff.
            </p>
          )}
        </div>
      ) : !error ? (
        <p className="mt-3 text-xs text-muted">Checking workspace access…</p>
      ) : null}
      {error && (
        <div className="mt-3 space-y-2">
          <p role="alert" className="text-xs text-critical">
            {error}
          </p>
          {user?.provider === "codegraff" && (
            <a
              className="text-xs text-series-1 underline underline-offset-2"
              href={reconnect}
            >
              Reconnect Codegraff for team access
            </a>
          )}
        </div>
      )}
    </Card>
  );
}
