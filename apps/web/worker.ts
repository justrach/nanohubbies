// The whole app as one Worker: API and git routes go to @swarm/api, every
// other path to the Next.js app that `opennextjs-cloudflare build` produced.
// @ts-ignore: .open-next/worker.js exists only after that build.
import next from "./.open-next/worker.js";
import api from "@swarm/api";

export { Account, Agent, Driver, Hub, ImportJob, Lane, Packer, Room, Sequencer } from "@swarm/api";

interface NextHandler {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
}

/** A deployment that takes over a domain from another Worker can keep that
 *  Worker answering what this app does not: LEGACY is a service binding to
 *  it, and LEGACY_PATHS lists its paths, comma-separated ("/x" is that page
 *  and what is under it, "/x/" what is under it). Pages this app does not
 *  have are asked of it too, on reads. LEGACY_ORIGIN, when set, is the origin
 *  those requests carry, for a Worker that answers only its own hostname. */
interface Legacy {
  LEGACY?: Fetcher;
  LEGACY_PATHS?: string;
  LEGACY_ORIGIN?: string;
}

// Server components call the API in-process through this (src/server/api.ts):
// the Next.js build is a separate bundle, so a module both import would be two
// copies, and globalThis is the one place they share.
(globalThis as { __swarmApi?: typeof api }).__swarmApi = api;

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/") || pathname.startsWith("/git/")) return api.fetch(request, env, ctx);
    const { LEGACY: legacy, LEGACY_PATHS: paths = "", LEGACY_ORIGIN: origin } = env as Env & Legacy;
    const toLegacy = () => {
      if (!origin) return legacy!.fetch(request);
      const url = new URL(request.url);
      return legacy!.fetch(new Request(`${origin}${url.pathname}${url.search}`, request));
    };
    if (legacy && paths.split(",").some((p) => p && (p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`)))) {
      return toLegacy();
    }
    const res = await (next as NextHandler).fetch(request, env, ctx);
    if (legacy && res.status === 404 && (request.method === "GET" || request.method === "HEAD")) return toLegacy();
    if (pathname.startsWith("/t/") || pathname === "/dashboard" || pathname === "/") {
      const headers = new Headers(res.headers);
      headers.set("Cache-Control", "private, no-store");
      headers.set("Vary", "Cookie, Authorization");
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }
    return res;
  },
} satisfies ExportedHandler<Env>;
