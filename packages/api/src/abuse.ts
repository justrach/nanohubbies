import type { Hub } from "./hub";

/** Public hosts are protected even before OAuth is available. Local probes can
 *  opt in without touching hosted data or trusting client-supplied identities. */
export interface AbuseLimits {
  total: number;
  owner: number;
  ip: number;
  creations: number;
  control: number;
  agent: number;
  bodyBytes: number;
  seedBytes: number;
}

export function abuseLimits(env: Env, url: URL): AbuseLimits | null {
  const vars = env as Env & Record<string, string | undefined>;
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (local && vars.ABUSE_PROTECTION !== "1") return null;
  const limit = (key: string, fallback: number) => {
    const n = Number(vars[key]);
    return Number.isSafeInteger(n) && n > 0 ? n : fallback;
  };
  return {
    total: limit("TRUNK_MAX_TOTAL", 100),
    owner: limit("TRUNK_MAX_PER_OWNER", 10),
    ip: limit("TRUNK_MAX_PER_IP", 3),
    creations: limit("TRUNK_CREATIONS_PER_HOUR", 3),
    control: limit("CONTROL_REQUESTS_PER_MINUTE", 60),
    agent: limit("AGENT_REQUESTS_PER_MINUTE", 6000),
    bodyBytes: limit("TRUNK_REQUEST_MAX_BYTES", 1024 * 1024),
    seedBytes: limit("TRUNK_SEED_MAX_BYTES", 8 * 1024 * 1024),
  };
}

/** Only Cloudflare's connecting address, never X-Forwarded-For, an agent name,
 *  a cookie, or a Basic-auth username. Missing addresses share a fail-closed
 *  bucket. Raw addresses are not written to Durable Object storage. */
export async function clientKey(request: Request): Promise<string> {
  const address = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(address));
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Separate budgets keep agent reads/writes from exhausting human controls.
 *  Immutable git downloads are deliberately not throttled: one clone can
 *  fetch thousands of objects. Admission runs before auth or request bodies. */
export async function throttle(request: Request, env: Env, url: URL): Promise<Response | null> {
  const limits = abuseLimits(env, url);
  if (!limits) return null;
  const agent = /^\/api\/trunks\/[^/]+\/agents(?:\/|$)/.test(url.pathname);
  const push = url.pathname.startsWith("/git/") && (url.pathname.endsWith("/git-receive-pack") || url.searchParams.get("service") === "git-receive-pack");
  const control = url.pathname.startsWith("/api/") && (
    !["GET", "HEAD"].includes(request.method) || /^\/api\/(auth|github)(?:\/|$)/.test(url.pathname) || url.pathname.endsWith("/live")
  );
  if (!agent && !push && !control) return null;
  const key = await clientKey(request);
  const guard = env.HUB.get(env.HUB.idFromName(`rate:${key}`));
  const result = await guard.takeRate(agent ? "agent" : "control", agent ? limits.agent : limits.control, 60_000);
  return result.ok ? null : limited("request rate limit reached", result.retryAfter);
}

export function limited(error: string, retryAfter: number): Response {
  return Response.json({ error }, { status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" } });
}

/** Bound parsing as well as the eventual seed: Content-Length alone is not
 *  enough for chunked requests or a caller that lies about its length. */
export async function creationBody<T>(request: Request, limit: number | null): Promise<T> {
  if (limit === null) return request.json<T>();
  if (Number(request.headers.get("Content-Length")) > limit) throw new SeedTooLarge("creation request is too large");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("a creation request needs a body");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new SeedTooLarge("creation request is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const data = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(data)) as T;
}

export class SeedTooLarge extends Error {}

export function checkSeed(files: { path: string; text: string }[], limits: AbuseLimits | null) {
  if (!Array.isArray(files) || !files.length) throw new Error("a trunk needs at least one file");
  let bytes = 0;
  const paths = new Set<string>();
  for (const file of files) {
    if (!file || typeof file.path !== "string" || !file.path || typeof file.text !== "string" || paths.has(file.path)) throw new Error("seed files need unique paths and text");
    paths.add(file.path);
    bytes += new TextEncoder().encode(file.path).byteLength + new TextEncoder().encode(file.text).byteLength;
    if (limits && (bytes > limits.seedBytes || files.length > 3000)) throw new SeedTooLarge("trunk seed is too large");
  }
}

export type AdmissionHub = DurableObjectStub<Hub>;
