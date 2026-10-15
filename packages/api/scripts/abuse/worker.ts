// Test-only outbound fixtures and RPC probes. Never a deployment entry point.
import { DurableObject } from "cloudflare:workers";
import worker from "../../src/index";
import { Admission } from "../../src/hub/admission";
export { Account, Agent, Driver, Hub, Lane, Packer, Room, Sequencer } from "../../src/index";

let downloads = 0;
// No test request may reach a hosted service. A tiny tarball represents one
// imported public repository; context fixtures exercise the ordinary importer.
globalThis.fetch = async (input) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname === "github.com" && url.pathname === "/fixture/repo/archive/HEAD.tar.gz") {
    downloads++;
    const tar = new Uint8Array(2048);
    const put = (at: number, text: string) => tar.set(new TextEncoder().encode(text), at);
    put(0, "fixture-abc/base.txt");
    put(124, "00000000005\0");
    put(156, "0");
    // The importer verifies each header's checksum: summed with its own field as spaces.
    tar.fill(32, 148, 156);
    put(148, tar.subarray(0, 512).reduce((sum, b) => sum + b, 0).toString(8).padStart(6, "0") + "\0 ");
    put(512, "base\n");
    return new Response(new Blob([tar]).stream().pipeThrough(new CompressionStream("gzip")));
  }
  if (url.hostname === "api.github.com" && url.pathname.startsWith("/repos/fixture/repo")) {
    if (url.pathname === "/repos/fixture/repo") return Response.json({ full_name: "fixture/repo", html_url: "https://github.com/fixture/repo", description: null, stargazers_count: 0, license: null, default_branch: "main" });
    return Response.json([]);
  }
  throw new Error("outbound network disabled in abuse regression");
};

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname === "/__test/downloads") return Response.json({ downloads });
    if (url.pathname === "/__test/legacy") {
      const legacy = (env as Env & { LEGACY_HUB: DurableObjectNamespace<LegacyHub> }).LEGACY_HUB;
      return Response.json(await legacy.get(legacy.idFromName("legacy")).probe());
    }
    if (url.pathname === "/__test/rate") {
      const hub = env.HUB.get(env.HUB.idFromName("rate:expiry-test"));
      return Response.json(await hub.takeRate("control", 1, 100));
    }
    if (url.pathname === "/__test/reserve") {
      const hub = env.HUB.get(env.HUB.idFromName("hub"));
      const { name, limits } = await request.json<any>();
      return Response.json(await hub.reserve(name, null, "reserved-test", limits));
    }
    if (url.pathname === "/__test/release") {
      const { name, ticket } = await request.json<any>();
      await env.HUB.get(env.HUB.idFromName("hub")).release(name, ticket);
      return Response.json({ ok: true });
    }
    return worker.fetch(request, env);
  },
};

// Exercise additive migration from the old Hub schema without fabricating
// hosted state or relying on an already-migrated constructor.
export class LegacyHub extends DurableObject<Env> {
  probe() {
    const sql = this.ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS trunks (name TEXT PRIMARY KEY, created INTEGER NOT NULL, source TEXT NOT NULL, owner TEXT)");
    sql.exec("INSERT INTO trunks (name, created, source, owner) VALUES ('legacy', 1, 'files', 'owner')");
    new Admission(this.ctx.storage, sql);
    return sql.exec("SELECT name, created, source, owner FROM trunks").toArray();
  }
}
