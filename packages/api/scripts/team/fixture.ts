import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

export const ROOM = "room_" + "a".repeat(24);
export const OTHER = "room_" + "b".repeat(24);
/** `bindings` add to (or override) the Worker's test bindings. */
export async function teamFixture(bindings: Record<string, string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "nanohub-team-"));
  const members = new Map<string, "owner" | "member">([
    ["101", "owner"],
    ["202", "member"],
  ]);
  const provider = {
    down: false,
    wrongSubject: false,
    wrongAudience: false,
    expired: false,
    calls: 0,
  };
  let issuer = "";
  const server = createServer(async (req, res) => {
    provider.calls++;
    if (provider.down) {
      res.writeHead(503).end();
      return;
    }
    const subject = /^Bearer fixture-(\d+)$/.exec(
      req.headers.authorization ?? "",
    )?.[1];
    if (!subject) {
      res.writeHead(401).end();
      return;
    }
    let ids: string[] | null = null;
    if (req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      ids = JSON.parse(body).roomIds;
    }
    const rooms =
      members.has(subject) && (!ids || ids.includes(ROOM))
        ? [{ id: ROOM, name: "Shared engineering", role: members.get(subject) }]
        : [];
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        issuer,
        subject: provider.wrongSubject ? "999" : subject,
        audience: provider.wrongAudience ? "another-app" : "nanohub-test",
        checkedAt: Date.now() - (provider.expired ? 60000 : 0),
        rooms,
        nextCursor: null,
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  issuer = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const output = await build({
    entryPoints: [new URL("./worker.ts", import.meta.url).pathname],
    bundle: true,
    platform: "neutral",
    format: "esm",
    conditions: ["workerd", "worker", "browser"],
    external: ["cloudflare:workers", "node:*"],
    write: false,
  });
  const config = convertV4MiniflareOptions({
    name: "team-test",
    modules: true,
    script: output.outputFiles[0].text,
    compatibilityDate: "2026-09-01",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: Object.fromEntries(
      [
        "Sequencer",
        "Agent",
        "Lane",
        "Packer",
        "Room",
        "Driver",
        "Hub",
        "Account",
      ].map((className) => [
        className.toUpperCase(),
        { className, useSQLite: true },
      ]),
    ),
    outboundService: async (request: Request) => {
      if (new URL(request.url).origin !== issuer)
        return new Response("unexpected test egress", { status: 503 });
      return fetch(request.url, {
        method: request.method,
        headers: Object.fromEntries(request.headers),
        body: request.method === "POST" ? await request.text() : undefined,
      });
    },
    r2Buckets: ["OBJECTS"],
    d1Databases: ["AUTH_DB"],
    bindings: {
      SESSION_SECRET: "isolated-team-test",
      DEV_LOGIN: "1",
      OIDC_ISSUER: issuer,
      OIDC_CLIENT_ID: "nanohub-test",
      ...bindings,
    },
  });
  let mf = new Miniflare({
    ...config,
    resourcePersistencePath: join(dir, "state"),
  });
  let origin = (await mf.ready).origin;
  async function request(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    return fetch(origin + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  async function json(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const r = await request(method, path, body, headers);
    const value = (await r.json()) as any;
    assert.ok(r.ok, `${r.status} ${path}: ${JSON.stringify(value)}`);
    return value;
  }
  async function login(localId: string, subject: string) {
    const r = await request("POST", "/fixture/session", { localId, subject });
    assert.equal(r.status, 200);
    return {
      cookie: r.headers
        .getSetCookie()
        .map((v) => v.split(";")[0])
        .join("; "),
    };
  }
  return {
    dir,
    members,
    provider,
    request,
    json,
    login,
    get mf() {
      return mf;
    },
    get origin() {
      return origin;
    },
    async restart() {
      await mf.dispose();
      mf = new Miniflare({
        ...config,
        resourcePersistencePath: join(dir, "state"),
      });
      origin = (await mf.ready).origin;
    },
    async close() {
      await mf.dispose();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await rm(dir, { recursive: true, force: true });
    },
  };
}
