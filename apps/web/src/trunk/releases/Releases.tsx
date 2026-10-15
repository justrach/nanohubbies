"use client";

import { useState } from "react";
import { Download, Paperclip, Tag, Trash2 } from "lucide-react";
import type { ReleaseList } from "@swarm/api/releases";
import { Button } from "@/components/controls";
import { buttonClass, Card, Empty, Pill } from "@/components/ui";
import { api, ApiError, trunkPath } from "@/lib/api";
import { Link } from "@/lib/router";
import { useTrunk } from "@/trunk/context";
import { trunkHref } from "@/trunk/paths";
import { field, Notice } from "@/trunk/review/shared";

type Release = ReleaseList["releases"][number];

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const size = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** A workspace's releases: tagged source versions with files to download.
 *  Anyone sees the published ones; the owner drafts, attaches, publishes. */
export function Releases({ trunk, initial }: { trunk: string; initial: ReleaseList }) {
  const { head } = useTrunk();
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const base = `${trunkPath(trunk)}/releases`;

  const run = async (key: string, call: () => Promise<ReleaseList>) => {
    if (busy) return false;
    setBusy(key);
    setError("");
    try {
      setData(await call());
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  };
  const attach = (release: Release, file: File) =>
    run(`attach:${release.id}`, async () => {
      // The file is the body, so the browser sends its length; the API needs it.
      const res = await fetch(`${base}/${release.id}/assets?name=${encodeURIComponent(file.name)}`, { method: "POST", body: file });
      const body = (await res.json().catch(() => ({}))) as ReleaseList & { error?: string };
      if (!res.ok) throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status, body as unknown as Record<string, unknown>);
      return body;
    });

  return (
    <main className="mx-auto max-w-[1120px] space-y-5 px-5 py-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Releases</h1>
        <p className="mt-2 text-sm text-muted">Tagged versions of this workspace, with files to download.</p>
      </header>
      <Notice error={error} />
      {data.canManage && data.sourcePrivate && (
        <p className="rounded-md border border-line bg-wash p-3 text-xs leading-5 text-ink-2">
          This workspace is private, but a published release is public: anyone with its link sees its notes and downloads its files.
        </p>
      )}
      {data.canManage && (
        <Card className="p-4">
          <form
            className="grid gap-3 sm:grid-cols-[10rem_1fr_7rem]"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget, values = new FormData(form);
              const body = { tag: values.get("tag"), title: values.get("title"), notes: values.get("notes") ?? "", version: Number(values.get("version")) };
              void run("create", () => api<ReleaseList>(base, { body })).then((ok) => ok && form.reset());
            }}
          >
            <label className="space-y-1 text-xs text-muted">
              Tag
              <input className={field} name="tag" placeholder="v1.0.0" required maxLength={80} pattern="[A-Za-z0-9][A-Za-z0-9._\-]*" />
            </label>
            <label className="space-y-1 text-xs text-muted">
              Title
              <input className={field} name="title" placeholder="What this release is" required maxLength={200} />
            </label>
            <label className="space-y-1 text-xs text-muted">
              Version
              <input className={field} name="version" type="number" min={1} max={head?.version} defaultValue={head?.version ?? 1} required />
            </label>
            <label className="space-y-1 text-xs text-muted sm:col-span-3">
              Notes
              <textarea className={`${field} min-h-20`} name="notes" maxLength={16000} placeholder="What changed, and anything to know before using it" />
            </label>
            <div className="sm:col-span-3">
              <Button type="submit" variant="primary" disabled={!!busy}>
                {busy === "create" ? "Drafting…" : "Draft a release"}
              </Button>
            </div>
          </form>
        </Card>
      )}
      {data.releases.length === 0 ? (
        <Card>
          <Empty title="No releases yet">
            {data.canManage ? "Draft one from a published version above, attach its files, then publish it." : "Published releases and their files appear here."}
          </Empty>
        </Card>
      ) : (
        data.releases.map((r) => (
          <Card key={r.id} className="p-5">
            <header className="flex flex-wrap items-center gap-2">
              <Tag size={15} className="text-series-1" aria-hidden />
              <h2 className="text-base font-semibold text-ink">{r.title}</h2>
              <code className="text-xs text-muted">{r.tag}</code>
              <Pill>{r.state === "published" ? "Published" : "Draft"}</Pill>
              {r.version !== undefined && (
                <Link to={trunkHref(trunk, `/commit/${r.version}`)} className="text-xs text-series-1 hover:underline">
                  v{r.version}
                </Link>
              )}
              <span className="ml-auto text-xs text-muted">{r.published ? `Published ${day(r.published)}` : `Drafted ${day(r.created)}`}</span>
            </header>
            {r.notes && <p className="mt-3 text-sm leading-6 whitespace-pre-wrap text-ink-2">{r.notes}</p>}
            <ul className="mt-4 divide-y divide-line rounded-md border border-line">
              {r.assets.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <Download size={14} className="text-muted" aria-hidden />
                  {r.state === "published" ? (
                    <a href={`/api/public-releases/${encodeURIComponent(trunk)}/${r.id}/${a.id}`} className="break-all text-ink hover:text-series-1" download>
                      {a.name}
                    </a>
                  ) : (
                    <span className="break-all text-ink">{a.name}</span>
                  )}
                  <span className="ml-auto text-xs text-muted">{size(a.size)}</span>
                </li>
              ))}
              {!r.assets.length && <li className="px-3 py-2 text-xs text-muted">No files attached.</li>}
            </ul>
            {data.canManage && (
              <footer className="mt-4 flex flex-wrap items-center gap-2">
                {r.state === "draft" && (
                  <label className={buttonClass("secondary", "sm", busy ? "pointer-events-none opacity-50" : "cursor-pointer")}>
                    <Paperclip size={13} aria-hidden /> {busy === `attach:${r.id}` ? "Uploading…" : "Attach a file"}
                    <input
                      type="file"
                      className="sr-only"
                      disabled={!!busy}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file) void attach(r, file);
                      }}
                    />
                  </label>
                )}
                <Button size="sm" variant={r.state === "draft" ? "primary" : "secondary"} disabled={!!busy}
                  onClick={() => void run(`publish:${r.id}`, () => api<ReleaseList>(`${base}/${r.id}/${r.state === "draft" ? "publish" : "unpublish"}`, { body: {} }))}>
                  {r.state === "draft" ? "Publish" : "Unpublish"}
                </Button>
                <Button size="sm" variant="ghost" disabled={!!busy}
                  onClick={() => confirm(`Delete ${r.tag} and its files?`) && void run(`delete:${r.id}`, () => api<ReleaseList>(`${base}/${r.id}`, { method: "DELETE" }))}>
                  <Trash2 size={13} aria-hidden /> Delete
                </Button>
              </footer>
            )}
          </Card>
        ))
      )}
    </main>
  );
}
