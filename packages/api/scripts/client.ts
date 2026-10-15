// A small client for the swarm API, shared by the scripts.

import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const BASE = process.env.SWARM_URL ?? "http://localhost:8787";

export type Edit =
  | { op: "replace"; path: string; symbol: string; text: string }
  | { op: "insert"; path: string; after?: string; text: string }
  | { op: "delete"; path: string; symbol: string }
  | { op: "create"; path: string; text: string }
  | { op: "remove"; path: string };
export type Plan = { intent: string; edits: Edit[] };
export type Overlap = { key: string; kind: string; by: string; version: number };
export type Result = { status: "landed" | "conflict" | "rejected"; version?: number; conflicts?: Overlap[]; revalidate?: Overlap[]; error?: string };
type Info = { tip: { version: number; commit: string }; mirror: { remote: string; pushed: number } | null };

/** One API call. `cookie` is a session from `signIn`, to act as that person. */
export async function call<T>(method: string, path: string, body?: unknown, cookie?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  const send = () => fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  // One retry for a connection the server closed while it sat idle in the
  // keep-alive pool; HTTP errors are not retried.
  const res = await send().catch(() => send());
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(`${method} ${path}: ${data.error}`);
  return data;
}

/** Signs in with the development login, which only a local server offers, so
 *  a script can act as several people. Returns the session cookie. */
export async function signIn(name: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/dev`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .find((c) => c.startsWith("swarm_session="));
  if (!res.ok || !cookie) throw new Error(`could not sign in as ${name}: HTTP ${res.status}`);
  return cookie;
}

/** An agent's workspace on a trunk. `start` begins a new life on the newest
 *  version; reads and the submit belong to the current life. With a session
 *  cookie, the agent works for that person. */
export function session(trunk: string, agent: string, cookie?: string) {
  const base = `/api/trunks/${trunk}/agents/${agent}`;
  let life: number | undefined;
  const get = <T>(action: string, params: Record<string, string>) => call<T>("GET", `${base}/${action}?${new URLSearchParams(params)}`, undefined, cookie);
  return {
    async start() {
      const started = await call<{ life: number; base: number }>("POST", `${base}/lives`, { kind: "agent" }, cookie);
      life = started.life;
      return started;
    },
    file: (path: string) => get<{ text: string; symbols: { name: string }[] }>("file", { path }),
    symbol: (path: string, name: string) => get<{ text: string }>("symbol", { path, name }),
    refs: (name: string) => get<{ hits: { path: string; symbol: string }[] }>("refs", { name }),
    /** Takes an issue; scripted agents leave it alone while the agent holds it. */
    hold: (issue: number) => call<{ number: number }>("POST", `${base}/hold`, { issue }, cookie),
    /** `issue` names the issue the change is for; `closes` says it finishes it. */
    submit: (plan: Plan & { issue?: number; closes?: boolean; wait?: "published" }) => call<Result>("POST", `${base}/submit`, { ...plan, life }, cookie),
  };
}
export type Session = ReturnType<typeof session>;

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function clone(url: string, header?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "swarm-"));
  execFileSync("git", [...(header ? ["-c", `http.extraHeader=${header}`] : []), "clone", "-q", url, dir], { stdio: "pipe" });
  return dir;
}

/** For a trunk mirrored to Artifacts: waits for the mirror to catch up, clones
 *  it with plain git, and reports whether it holds exactly the trunk's commits.
 *  Null when the trunk has no mirror. */
export async function checkMirror(trunk: string): Promise<boolean | null> {
  let info = await call<Info>("GET", `/api/trunks/${trunk}/info`);
  if (!info.mirror) return null;
  for (let i = 0; info.mirror!.pushed < info.tip.version; i++) {
    if (i > 120) throw new Error(`mirror stuck at v${info.mirror!.pushed} of v${info.tip.version}`);
    await sleep(500);
    info = await call<Info>("GET", `/api/trunks/${trunk}/info`);
  }
  const { remote, token } = await call<{ remote: string; token: string }>("POST", `/api/trunks/${trunk}/clone-token`);
  const dir = clone(remote, `Authorization: Bearer ${token}`);
  const head = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const same = head === info.tip.commit;
  const shown = remote.replace(/^https:\/\/[^.]+\./, "https://<account>.");
  console.log(`   Artifacts mirror: git clone ${shown}: HEAD ${head.slice(0, 7)}, ${same ? "the same commit as the trunk" : `but the trunk is at ${info.tip.commit.slice(0, 7)}`}`);
  return same;
}

/** Deletes trunks, with their Artifacts repos, unless KEEP is set. */
export async function cleanup(trunks: string[]) {
  if (process.env.KEEP) {
    console.log(`kept: ${trunks.join(", ")}`);
    return;
  }
  for (const trunk of trunks) await call("DELETE", `/api/trunks/${trunk}`);
}
