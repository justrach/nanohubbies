// Isolated real Worker/SQLite/D1/R2 integration. No hosted or user's trunk data.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

export const exec = promisify(execFile);
const here = dirname(new URL(import.meta.url).pathname);
export const dir = await mkdtemp(join(tmpdir(), "swarm-room-"));
export const base = "/api/trunks/room-test";
const bundled = await build({
  entryPoints: [join(here, "../../src/index.ts")],
  bundle: true,
  platform: "neutral",
  format: "esm",
  conditions: ["workerd", "worker", "browser"],
  external: ["cloudflare:workers", "node:*"],
  write: false,
});
export let mf: Miniflare;
export let origin: string;
export async function boot() {
  mf = new Miniflare({
    ...convertV4MiniflareOptions({
      name: "room-test",
      modules: true,
      script: bundled.outputFiles[0].text,
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
      r2Buckets: ["OBJECTS"],
      d1Databases: ["AUTH_DB"],
      bindings: { SESSION_SECRET: "isolated-room-test", DEV_LOGIN: "1" },
    }),
    resourcePersistencePath: join(dir, "storage"),
    isolatedResourcePersistencePath: join(dir, "isolated"),
  });
  origin = (await mf.ready).origin;
}
export async function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const response = await fetch(origin + path, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as any };
}
export async function ok(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const response = await call(method, path, body, headers);
  assert.ok(
    response.status >= 200 && response.status < 300,
    `${path}: ${JSON.stringify(response)}`,
  );
  return response.body;
}
export async function login(name: string) {
  const response = await fetch(origin + "/api/auth/dev", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  assert.equal(response.status, 200);
  return {
    cookie: response.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  };
}
export const credentials = (name: string, token: string) => ({
  authorization: `Basic ${btoa(`${name}:${token}`)}`,
});
