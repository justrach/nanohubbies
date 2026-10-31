import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { build } from "esbuild";
import { recoveryHoldResponse } from "../src/recovery.ts";

const directory = await mkdtemp(join(tmpdir(), "nanohub-hold-unit-"));
after(() => rm(directory, { recursive: true, force: true }));
const paths = ["/", "/dashboard", "/t/private/branches", "/owner/private", "/cli/authorize", "/nh/latest.json", "/nh/releases/0.4.9/nh.mjs", "/_next/static/app.js", "/api/auth/callback/codegraff", "/api/agent-help", "/api/trunks/private/live", "/api/trunks/private/agents/builder/mcp", "/api/cli/trunks/private/protection", "/api/cli/trunks/private/secrets", "/api/cli/trunks/private/secrets/grants", "/api/trunks/private/ci/claim", "/api/trunks/private/secrets/read", "/git/owner/private.git/git-receive-pack", "/git/private.git/info/refs"];

test("only omitted or explicit 0 operator configuration opens traffic; hold is private, retryable and bodyless for HEAD", async () => {
  for (const value of [undefined, "0"])
    assert.equal(recoveryHoldResponse(new Request("https://host.invalid/"), { NANOHUB_RECOVERY_HOLD: value }), null);
  for (const value of ["1", "", "false", "off", " 0", "0 ", "false\n", false, null, 0, {}]) {
    for (const method of ["GET", "POST", "HEAD", "OPTIONS"]) {
      const request = new Request("https://host.invalid/?NANOHUB_RECOVERY_HOLD=0", { method, headers: { "X-Nanohub-Recovery": "off", Authorization: "Bearer synthetic" } });
      const response = recoveryHoldResponse(request, { NANOHUB_RECOVERY_HOLD: value });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("retry-after"), "60");
      assert.match(response.headers.get("cache-control"), /private, no-store/);
      assert.equal(response.headers.get("x-nanohub-recovery"), "hold");
      assert.equal(response.headers.get("set-cookie"), null);
      if (method === "HEAD") assert.equal(await response.text(), "");
      else assert.equal((await response.json()).code, "recovery_hold");
    }
  }
});

test("the actual API handler holds every route before authentication, throttle or a resource binding is accessed", async () => {
  const file = join(directory, "api.mjs");
  await build({ entryPoints: [fileURLToPath(new URL("../src/index.ts", import.meta.url))], bundle: true, platform: "node", format: "esm", outfile: file, plugins: [{ name: "cloudflare-types", setup(plugin) {
    plugin.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: "workers", namespace: "fixture" }));
    plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export class DurableObject {} export class RpcTarget {}", loader: "js" }));
  } }] });
  const { default: api } = await import(pathToFileURL(file).href);
  const env = new Proxy({}, { get(_target, name) {
    if (name === "NANOHUB_RECOVERY_HOLD") return "1";
    throw Error("Held request accessed " + String(name));
  } });
  for (const path of paths) {
    const response = await api.fetch(new Request("https://host.invalid" + path), env);
    assert.equal(response.status, 503, path);
    assert.equal((await response.json()).code, "recovery_hold");
  }
});

test("the actual web router holds before Next, assets, legacy and API delegation; normal routing remains available", async () => {
  globalThis.__recoveryRoutingCalls = [];
  const file = join(directory, "web.mjs");
  const classes = ["Account", "Agent", "Driver", "Hub", "ImportJob", "Lane", "Packer", "Room", "Sequencer"].map(name => `export class ${name} {}`).join("\n");
  await build({ entryPoints: [fileURLToPath(new URL("../../../apps/web/worker.ts", import.meta.url))], bundle: true, platform: "node", format: "esm", outfile: file, plugins: [{ name: "routing-delegates", setup(plugin) {
    plugin.onResolve({ filter: /^@swarm\/api$/ }, () => ({ path: "api", namespace: "routing" }));
    plugin.onResolve({ filter: /^\.\/\.open-next\/worker\.js$/ }, () => ({ path: "next", namespace: "routing" }));
    plugin.onLoad({ filter: /.*/, namespace: "routing" }, ({ path }) => ({ loader: "js", contents: classes + `
      export default { async fetch(request,env) {
        globalThis.__recoveryRoutingCalls.push(${JSON.stringify(path)});
        return new Response(${JSON.stringify(path)}, {status:new URL(request.url).pathname==='/missing'?404:200});
      }};
    ` }));
  } }] });
  const { default: web } = await import(pathToFileURL(file).href);
  const env = { NANOHUB_RECOVERY_HOLD: "1", LEGACY_PATHS: "/", LEGACY: { fetch() { globalThis.__recoveryRoutingCalls.push("legacy"); return new Response("legacy"); } }, ASSETS: { fetch(request) {
    const path = new URL(request.url).pathname;
    globalThis.__recoveryRoutingCalls.push("assets:" + path);
    if (path === "/nh/latest.json") return Response.json({ synthetic: true });
    if (path === "/_next/static/app.css") return new Response("body{color:red}", { headers: { "Content-Type": "text/css" } });
    if (path === "/asset-error") return new Response("Asset service unavailable", { status: 503 });
    return new Response("not found", { status: 404 });
  } } };
  for (const path of [...paths, "/missing"]) {
    const response = await web.fetch(new Request("https://host.invalid" + path), env, {});
    assert.equal(response.status, 503, path);
  }
  assert.deepEqual(globalThis.__recoveryRoutingCalls, []);
  env.NANOHUB_RECOVERY_HOLD = "0";
  assert.equal(await (await web.fetch(new Request("https://host.invalid/api/agent-help"), env, {})).text(), "api");
  env.LEGACY_PATHS = "/legacy";
  assert.equal(await (await web.fetch(new Request("https://host.invalid/legacy"), env, {})).text(), "legacy");
  assert.equal(await (await web.fetch(new Request("https://host.invalid/missing"), env, {})).text(), "legacy");
  const manifest = await web.fetch(new Request("https://host.invalid/nh/latest.json"), env, {});
  assert.deepEqual(await manifest.json(), { synthetic: true });
  assert.equal(manifest.headers.get("cache-control"), "public, max-age=0, must-revalidate");
  assert.equal(manifest.headers.get("x-content-type-options"), "nosniff");
  const css = await web.fetch(new Request("https://host.invalid/_next/static/app.css"), env, {});
  assert.equal(await css.text(), "body{color:red}"); assert.equal(css.headers.get("content-type"), "text/css");
  assert.equal(await (await web.fetch(new Request("https://host.invalid/git/private.git/HEAD"), env, {})).text(), "api");
  assert.equal((await web.fetch(new Request("https://host.invalid/asset-error"), env, {})).status, 503);
  assert.deepEqual(globalThis.__recoveryRoutingCalls, ["api", "assets:/legacy", "legacy", "assets:/missing", "next", "legacy", "assets:/nh/latest.json", "assets:/_next/static/app.css", "api", "assets:/asset-error"]);
  // Next deliberately answers unknown paths with 200. Neither that renderer
  // nor a legacy Worker may manufacture a successful CLI download.
  globalThis.__recoveryRoutingCalls = [];
  env.LEGACY_PATHS = "/";
  const missingDownloads = ["/nh/releases/999.0.0/nh.mjs", "/nh/releases/999.0.0/SHA256SUMS", "/nh/install.mjs", "/nh/releases/999.0.0/nh.mjs/", "/nh/releases/999.0.0/nh.mjs?download=1"];
  for (const path of missingDownloads) {
    for (const method of ["GET", "HEAD"]) {
      const response = await web.fetch(new Request("https://host.invalid" + path, { method }), env, {});
      assert.equal(response.status, 404, method + " " + path);
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.match(response.headers.get("cache-control"), /private, no-store/);
      if (method === "HEAD") assert.equal(await response.text(), "");
    }
  }
  assert.deepEqual(globalThis.__recoveryRoutingCalls, missingDownloads.flatMap(path => ["assets:" + new URL(path,"https://host.invalid").pathname, "assets:" + new URL(path,"https://host.invalid").pathname]));
  globalThis.__recoveryRoutingCalls = [];
  for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
    const response = await web.fetch(new Request("https://host.invalid/nh/releases/999.0.0/nh.mjs", { method }), env, {});
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET, HEAD");
  }
  const unavailable = await web.fetch(new Request("https://host.invalid/nh/latest.json", { method: "HEAD" }), { NANOHUB_RECOVERY_HOLD: "0", LEGACY: env.LEGACY, LEGACY_PATHS: "/" }, {});
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get("retry-after"), "60");
  assert.match(unavailable.headers.get("cache-control"), /private, no-store/);
  assert.equal(await unavailable.text(), "");
  assert.deepEqual(globalThis.__recoveryRoutingCalls, []);
  const upstreamError = await web.fetch(new Request("https://host.invalid/nh/releases/999.0.0/SHA256SUMS?service-error=1"), { ...env, ASSETS: { fetch() { return new Response("Asset service unavailable", { status: 503 }); } } }, {});
  assert.equal(upstreamError.status, 503);
  assert.equal(await upstreamError.text(), "Asset service unavailable");
  assert.match(upstreamError.headers.get("cache-control"), /private, no-store/);
  assert.deepEqual(globalThis.__recoveryRoutingCalls, []);
  env.LEGACY_PATHS = "";
  for (const path of ["/nh/project", "/nh/releases", "/nh/project/tree/main", "/cli/authorize"]) {
    const response = await web.fetch(new Request("https://host.invalid" + path), env, {});
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "next", path + " must remain an application route");
  }
  assert.deepEqual(globalThis.__recoveryRoutingCalls, ["/nh/project", "/nh/releases", "/nh/project/tree/main", "/cli/authorize"].flatMap(path => ["assets:" + path, "next"]));
  delete globalThis.__recoveryRoutingCalls;
});
