"use client";
import { useEffect, useState } from "react";
import {useTrunk} from "../context";
import { api } from "@/lib/api";
import { Card } from "@/components/ui";
import { Button } from "@/components/controls";
import { field } from "../review/shared";
type Address = { id: string; namespace: string; name: string };
export function RepositoryIdentity({ trunk }: { trunk: string }) {
  const {readOnly}=useTrunk();
  const [address, setAddress] = useState<Address | null>(null),
    [owner, setOwner] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void api<Address>(`/api/repository-addresses/${trunk}`)
      .then(setAddress)
      .catch(() => {});
    void api<{ namespace: { name: string } | null }>("/api/namespaces")
      .then((r) => setOwner(r.namespace?.name ?? ""))
      .catch(() => {});
  }, [trunk]);
  return (
    <Card className="space-y-3 p-5">
      <h2 className="text-lg font-semibold">Repository address</h2>
      {address && (
        <>
          <a
            className="text-sm underline"
            href={`/${address.namespace}/${address.name}`}
          >
            {address.namespace}/{address.name}
          </a>
          <p className="text-xs text-muted">
            Clone with{" "}
            <code className="break-all">
              {typeof window !== "undefined" ? window.location.origin : ""}/git/
              {address.namespace}/{address.name}.git
            </code>
            . Renames keep the same repository data, access and secrets; old
            clone URLs remain aliases.
          </p>
        </>
      )}
      <fieldset disabled={readOnly} className="min-w-0"><form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const values = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          void (async () => {
            if (!address) {
              await api("/api/namespaces", { body: { name: owner } });
              setAddress(
                await api<Address>(`/api/repository-addresses/${trunk}`, {
                  body: { namespace: owner, name: values.get("name") },
                }),
              );
            } else
              setAddress(
                await api<Address>(
                  `/api/repos/${address.namespace}/${address.name}/address`,
                  { body: { name: values.get("name") } },
                ),
              );
          })()
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        {!address && (
          <label className="flex-1 text-xs text-muted">
            Owner handle
            <input
              className={field}
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              required
              pattern="[a-z0-9][a-z0-9-]{0,38}"
            />
          </label>
        )}
        <label className="flex-1 text-xs text-muted">
          {address ? "New repository name" : "Repository name"}
          <input
            key={address?.name}
            className={field}
            name="name"
            defaultValue={address?.name ?? trunk}
            required
            pattern="[a-z0-9][a-z0-9._-]{0,99}"
          />
        </label>
        <Button type="submit" disabled={busy||readOnly}>
          {address ? "Rename repository" : "Set owner/repo address"}
        </Button>
      </form></fieldset>
      {error && (
        <p role="alert" className="text-sm text-critical">
          {error}
        </p>
      )}
    </Card>
  );
}
