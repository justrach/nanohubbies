import { cache } from "react";
import type { WorkspaceBootstrap } from "@/trunk/bootstrap";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { RepoInfo, TrunkInfo, TrunkListing } from "@/lib/types";
import type { BlobView, CommitView, CompareView, History, TreeView } from "@/trunk/types";

// The API from server components. Deployed, the pages and the API are one
// Worker (worker.ts), which hands its API handler over on globalThis: a page
// calls it in-process with the Worker's bindings from getCloudflareContext(),
// with no network hop. Under `next dev` the API runs on its own
// (packages/api), and pages reach it over HTTP.

interface Handler {
  fetch(request: Request, env: unknown, ctx?: { waitUntil(promise: Promise<unknown>): void }): Promise<Response>;
}

const DEV_API = process.env.SWARM_API ?? "http://localhost:8787";
/** The origin in-process calls carry when the answer does not depend on it. */

/** A failure the page can show, with the API's status. */
export class ServerApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** What `p` gives, or the not-found page when the trunk, or what was asked
 *  for in it, is not there. A name no trunk could have is not there either. */
export async function orMissing<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof ServerApiError && (e.status === 404 || /no such trunk|bad trunk name/.test(e.message))) notFound();
    throw e;
  }
}

async function call(path: string, from?: string): Promise<Response> {
  const incoming = await headers();
  const auth = new Headers();
  for (const name of ["cookie", "authorization"]) {
    const value = incoming.get(name);
    if (value) auth.set(name, value);
  }
  const baseOrigin = from ?? await origin();
  const handler = (globalThis as { __swarmApi?: Handler }).__swarmApi;
  if (!handler) return fetch(`${DEV_API}${path}`, { cache: "no-store", headers: auth });
  const { env, ctx } = await getCloudflareContext({ async: true });
  return handler.fetch(new Request(`${baseOrigin}${path}`, { headers: auth }), env, ctx);
}

export async function get<T>(path: string, from?: string): Promise<T> {
  const res = await call(path, from);
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (res.status === 409 && body.code === "import_in_progress") {
    const trunk = /^\/api\/trunks\/([^/]+)/.exec(path)?.[1];
    if (trunk) redirect(`/t/${trunk}/room`);
  }
  if (!res.ok) throw new ServerApiError(body.error ?? `HTTP ${res.status}`, res.status);
  return body;
}

/** Markdown or plain text from the API, for answers made for agents. */
export async function text(path: string): Promise<string> {
  const res = await call(path, await origin());
  if (!res.ok) throw new ServerApiError((await res.text()) || `HTTP ${res.status}`, res.status);
  return res.text();
}

/** The origin the page was asked for, as people and agents see it. */
export async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(host);
  return `${h.get("x-forwarded-proto") ?? (local ? "http" : "https")}://${host}`;
}

const enc = encodeURIComponent;
const base = (trunk: string) => `/api/trunks/${enc(trunk)}`;

export const trunks = () => get<TrunkListing[]>("/api/trunks");
/** Trunks imported from one GitHub repository, newest first. */
export const lookup = (repo: string) => get<TrunkListing[]>(`/api/github/trunks?repo=${enc(repo)}`);
export const bootstrap = cache((trunk: string) => get<WorkspaceBootstrap>(`${base(trunk)}/bootstrap`));
export const workspace = async (trunk: string) => (await bootstrap(trunk)).workspace;
export async function info(trunk: string): Promise<TrunkInfo> {
  const initial = await bootstrap(trunk);
  if (initial.info) return initial.info;
  if (initial.job && !initial.job.ready) redirect(`/t/${enc(trunk)}/room`);
  throw new ServerApiError("no such trunk", 404);
}
export const repo = async (trunk: string): Promise<RepoInfo | null> => (await bootstrap(trunk)).repo;

/** A published version and its commit. */
export interface At {
  version: number;
  commit: string;
}

/** The newest published version, or `v`. Not cached: it is how a page learns
 *  which commit it shows, and the rest is cached by that commit. */
export async function at(trunk: string, v?: number): Promise<At> {
  if (!v) return (await info(trunk)).head;
  const found = (await get<History>(`${base(trunk)}/commits?from=${v}&limit=1`)).commits[0];
  if (found?.version !== v) throw new ServerApiError(`v${v} is not published yet`, 404);
  return { version: v, commit: found.commit };
}

// Even immutable content needs fresh authorization. Never share rendered/API
// results across sessions or return a cached private result after revocation.
const cached = <T>(_key: string[], path: string) => get<T>(path);

export const tree = (trunk: string, a: At, path: string) => cached<TreeView>(["tree", trunk, a.commit, path], `${base(trunk)}/tree?v=${a.version}&path=${enc(path)}`);

export const blob = (trunk: string, a: At, path: string) => cached<BlobView>(["blob", trunk, a.commit, path], `${base(trunk)}/blob?v=${a.version}&path=${enc(path)}`);

/** One version's commit and diff; `id` is its version number or its commit. */
export const commit = (trunk: string, id: string, sha: string) => cached<CommitView>(["commit", trunk, sha], `${base(trunk)}/commit/${enc(id)}`);

export const compare = (trunk: string, from: At, to: At) =>
  cached<CompareView>(["compare", trunk, from.commit, to.commit], `${base(trunk)}/compare?from=${from.version}&to=${to.version}`);

/** A page of history from `from` down; from the newest version when not given,
 *  which is not cached, as changes keep landing. */
export const history = (trunk: string, from?: At | number) =>
  get<History>(`${base(trunk)}/commits?limit=30${from ? `&from=${typeof from === "number" ? from : from.version}` : ""}`);
