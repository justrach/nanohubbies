"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, trunkPath } from "@/lib/api";
import { useSession } from "@/lib/session";
import { agentHandle } from "./model";

export interface PushToken {
  id: string;
  label: string;
  trunk: string | null;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
}

/** Secrets live only in this mount; lists return metadata, never the token. */
export function usePushTokens(trunk: string, initial?: { owner: string | null; tokens: PushToken[] }) {
  const { user } = useSession();
  const seeded = initial && initial.owner === user?.id ? initial.tokens : undefined;
  const first = useRef(true);
  const reading = useRef(false);
  const [tokens, setTokens] = useState<PushToken[]>(seeded ?? []);
  const [made, setMade] = useState<
    (PushToken & { token: string; agent: string }) | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const pending = useRef(false);
  const revision = useRef(0);
  const scope = `${user?.id ?? ""}/${trunk}`;
  const [stateScope, setStateScope] = useState(scope);
  const current = useRef(scope);
  current.current = scope;

  const load = useCallback(async () => {
    if (!user || pending.current || reading.current || document.hidden) return;
    reading.current = true;
    const requested = scope;
    const readRevision = revision.current;
    try {
      const all = await api<PushToken[]>("/api/tokens");
      if (current.current !== requested || readRevision !== revision.current)
        return;
      const next = all.filter(
        (token) => token.trunk === trunk && token.expiresAt > Date.now(),
      );
      setTokens(next);
      setMade((secret) =>
        secret && next.some((token) => token.id === secret.id) ? secret : null,
      );
      setError(null);
    } catch (e) {
      if (current.current === requested) setError((e as Error).message);
    } finally { reading.current = false; }
  }, [user?.id, scope, trunk]);

  useEffect(() => {
    setStateScope(scope);
    const hydrate = first.current && seeded !== undefined;
    first.current = false;
    setTokens(hydrate ? seeded : []);
    setMade(null);
    setError(null);
    if (!hydrate) void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [scope, load]);

  const make = async (name: string, type = "external") => {
    if (!user || pending.current) return;
    pending.current = true;
    revision.current++;
    setBusy("create");
    setError(null);
    const requested = scope;
    try {
      const agent = agentHandle(name);
      await api(`${trunkPath(trunk)}/agents`, { body: { handle: agent, type } });
      const token = await api<PushToken & { token: string }>(`${trunkPath(trunk)}/agents/${agent}/token`, { body: {} });
      if (current.current !== requested) return;
      setMade({ ...token, agent });
      setTokens((list) => [token, ...list.filter((t) => t.id !== token.id)]);
    } catch (e) {
      if (current.current === requested) setError((e as Error).message);
    } finally {
      pending.current = false;
      setBusy(null);
    }
  };

  const revoke = async (id: string) => {
    if (!user || pending.current) return;
    pending.current = true;
    revision.current++;
    setBusy(id);
    setError(null);
    const requested = scope;
    try {
      await api(`/api/tokens/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (current.current !== requested) return;
      setTokens((list) => list.filter((token) => token.id !== id));
      setMade((secret) => (secret?.id === id ? null : secret));
    } catch (e) {
      if (current.current === requested) setError((e as Error).message);
    } finally {
      pending.current = false;
      setBusy(null);
    }
  };

  return {
    tokens: stateScope === scope ? tokens : [],
    made: stateScope === scope ? made : null,
    error: stateScope === scope ? error : null,
    busy,
    make,
    revoke,
    refresh: load,
  };
}
