"use client";
import { useEffect, useState } from "react";
import {useTrunk} from "../context";
import { api, trunkPath } from "@/lib/api";
import { Button } from "@/components/controls";
import { Card } from "@/components/ui";
import { field } from "../review/shared";
type Vault = {
  available: { name: string; binding: string }[];
  legacyValuesAwaitingMigration: number;
  secrets: { name: string; version: number; updated: number }[];
  grants: { id: string; names: string[]; expires: number }[];
  audit: { actor: string; action: string; target: string; at: number }[];
};
export function RepositorySecrets({ trunk }: { trunk: string }) {
  const {readOnly}=useTrunk();
  const [environment, setEnvironment] = useState("staging"),
    [data, setData] = useState<Vault | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [token, setToken] = useState("");
  const path = `${trunkPath(trunk)}/secrets?${new URLSearchParams({ environment })}`;
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    setToken("");
    void api<Vault>(path)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [path]);
  async function act(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
      setData(await api<Vault>(path));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="space-y-4 p-5">
      <h2 className="text-lg font-semibold text-ink">Secrets</h2>
      <p className="text-sm text-muted">
        Cloudflare Secrets Store retains values. This private service runs on
        demand and keeps only references and access metadata. Connect a
        configured binding to allow scoped workload access.
      </p>
      <label className="block max-w-xs text-xs text-muted">
        Environment
        <select
          className={field}
          disabled={busy}
          value={environment}
          onChange={(e) => setEnvironment(e.target.value)}
        >
          <option>staging</option>
          <option>production</option>
          <option>development</option>
        </select>
      </label>
      {data && (
        <>
          {data.legacyValuesAwaitingMigration > 0 && (
            <p role="alert" className="text-sm text-critical">
              {data.legacyValuesAwaitingMigration} legacy values need owner
              migration into Cloudflare Secrets Store.
            </p>
          )}
          {!data.available.length && (
            <p className="text-sm text-muted">
              Create a secret in Cloudflare Secrets Store and configure its
              repository binding to connect it here.
            </p>
          )}
          <ul className="divide-y divide-line">
            {data.secrets.map((s) => (
              <li
                key={s.name}
                className="flex flex-wrap items-center gap-3 py-2 text-xs"
              >
                <code className="flex-1">{s.name}</code>
                <span className="text-muted">version {s.version}</span>
                <Button
                  disabled={busy||readOnly}
                  onClick={() =>
                    void act(() =>
                      api(path, { method: "DELETE", body: { name: s.name } }),
                    )
                  }
                >
                  Disconnect
                </Button>
              </li>
            ))}
          </ul>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget,
                values = new FormData(form);
              const body = {
                name: values.get("name"),
                binding: values.get("binding"),
              };
              form.reset();
              void act(() => api(path, { method: "PUT", body }));
            }}
          >
            <label className="flex-1 text-xs text-muted">
              Secret name
              <input
                name="name"
                className={field}
                pattern="[A-Z_][A-Z0-9_]*"
                placeholder="DEPLOY_TOKEN"
                required
              />
            </label>
            <label className="flex-1 text-xs text-muted">
              Cloudflare binding
              <select name="binding" className={field} required>
                <option value="">Select configured secret</option>
                {data.available.map((s) => (
                  <option key={s.binding} value={s.binding}>
                    {s.name} · {s.binding}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" disabled={busy||readOnly}>
              Connect secret
            </Button>
          </form>
          {!!data.secrets.length && (
            <form
              className="space-y-3 border-t border-line pt-4"
              onSubmit={(e) => {
                e.preventDefault();
                const values = new FormData(e.currentTarget);
                setToken("");
                void act(async () => {
                  const g = await api<{ token: string }>(path, {
                    body: { names: values.getAll("names"), ttlSeconds: 900 },
                  });
                  setToken(g.token);
                });
              }}
            >
              <p className="text-xs text-muted">
                Issue a 15-minute grant for a trusted deployment process. Anyone
                holding it can retrieve the selected values until it expires or
                you revoke it. Keep grants out of candidate builds.
              </p>
              <div className="flex flex-wrap gap-4">
                {data.secrets.map((s) => (
                  <label key={s.name} className="text-xs">
                    <input type="checkbox" name="names" value={s.name} />{" "}
                    {s.name}
                  </label>
                ))}
              </div>
              <Button type="submit" disabled={busy||readOnly}>
                Issue workload grant
              </Button>
            </form>
          )}
          {token && (
            <div className="flex gap-3">
              <input
                aria-label="Workload grant"
                type="password"
                autoComplete="off"
                className={field}
                readOnly
                value={token}
              />
              <Button onClick={() => void navigator.clipboard.writeText(token)}>
                Copy once
              </Button>
              <Button onClick={() => setToken("")}>Hide</Button>
            </div>
          )}
          {data.grants.map((g) => (
            <div
              className="flex flex-wrap items-center gap-3 text-xs"
              key={g.id}
            >
              <code>{g.id.slice(0, 8)}</code>
              <span>
                {g.names.join(", ")} · expires{" "}
                {new Date(g.expires).toLocaleTimeString()}
              </span>
              <Button
                disabled={busy||readOnly}
                onClick={() =>
                  void act(() =>
                    api(path, { method: "DELETE", body: { grantId: g.id } }),
                  )
                }
              >
                Revoke
              </Button>
            </div>
          ))}
          <details>
            <summary className="cursor-pointer text-xs text-muted">
              Recent vault activity
            </summary>
            <ul className="mt-2 space-y-1 text-xs">
              {data.audit.map((a, i) => (
                <li key={i}>
                  {new Date(a.at).toLocaleString()} · {a.actor} · {a.action} ·{" "}
                  {a.target}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-critical">
          {error}
        </p>
      )}
    </Card>
  );
}
