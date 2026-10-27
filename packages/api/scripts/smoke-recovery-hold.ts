/** Real local asset routing using the web entrypoint and synthetic Next/API delegates. */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { unstable_readConfig } from "wrangler";

const directory = await mkdtemp(join(tmpdir(), "nanohub-held-assets-"));
let mf: Miniflare | undefined;
let stage = "configuration";
let port: number | undefined;
try {
  const configuration = resolve(import.meta.dirname, "../../../apps/web/wrangler.jsonc");
  const assets = unstable_readConfig({ config: configuration }).assets!;
  assert.equal(assets.run_worker_first, true);
  assert.equal(unstable_readConfig({ config: configuration, env: "artifacts" }).assets!.run_worker_first, true);
  const assetDirectory = join(directory, "assets");
  await mkdir(join(assetDirectory, "nh"), { recursive: true });
  await mkdir(join(assetDirectory, "_next/static"), { recursive: true });
  await writeFile(join(assetDirectory, "nh/latest.json"), '{"synthetic":true}\n');
  await writeFile(join(assetDirectory, "_next/static/app.js"), "// Synthetic public fixture asset\n");
  await writeFile(join(assetDirectory, "index.html"), "<!doctype html><title>Synthetic static page</title>");
  const output = await build({
    entryPoints: [resolve(import.meta.dirname, "../../../apps/web/worker.ts")], bundle: true,
    platform: "neutral", format: "esm", write: false,
    plugins: [{ name: "synthetic-renderer", setup(plugin) {
      plugin.onResolve({ filter: /^@swarm\/api$/ }, () => ({ path: "api", namespace: "delegate" }));
      plugin.onResolve({ filter: /^\.\/\.open-next\/worker\.js$/ }, () => ({ path: "next", namespace: "delegate" }));
      plugin.onLoad({ filter: /.*/, namespace: "delegate" }, ({ path }) => ({ loader: "js", contents:
        ["Account", "Agent", "Driver", "Hub", "ImportJob", "Lane", "Packer", "Room", "Sequencer"].map(name => `export class ${name} {}`).join("\n") + `
          export default {fetch(request,env) {
            if(${JSON.stringify(path)}==='next')return env.ASSETS.fetch(request);
            return new Response('synthetic API delegate');
          }};
        `,
      }));
    } }],
  });
  const config = (hold: string) => convertV4MiniflareOptions({
    port, name: "recovery-assets-test", modules: true, script: output.outputFiles[0].text,
    compatibilityDate: "2026-09-01", bindings: { NANOHUB_RECOVERY_HOLD: hold },
    assets: { directory: assetDirectory, binding: "ASSETS", run_worker_first: assets.run_worker_first, routerConfig: { has_user_worker: true } },
  });
  mf = new Miniflare(config("0"));
  let origin = (await mf.ready).origin;
  port = Number(new URL(origin).port);
  stage = "normal delivery";
  const send = (path: string, method = "GET") => mf!.dispatchFetch(origin + path, { method });
  const paths = ["/", "/nh/latest.json", "/_next/static/app.js", "/api/agent-help"];
  for (const path of paths) {
    const response = await send(path);
    const body = await response.text();
    assert.equal(response.status, 200, path + ": " + (response.ok ? "" : body.slice(0, 1200)));
  }
  for (const value of ["1", "false", ""]) {
    stage = "held delivery " + JSON.stringify(value);
    await mf.setOptions(config(value)); origin = (await mf.ready).origin;
    for (const path of paths) {
      const response = await send(path);
      assert.equal(response.status, 503, `${value}: ${path}`);
      assert.equal((await response.json() as { code: string }).code, "recovery_hold");
      const head = await send(path, "HEAD");
      assert.equal(head.status, 503); assert.equal(await head.text(), "");
    }
  }
  await mf.setOptions(config("0")); origin = (await mf.ready).origin;
  assert.equal((await send("/nh/latest.json")).status, 200);
  console.log("PASS: actual web entrypoint and Miniflare asset router use canonical Worker-first configuration; static HTML/Next asset/CLI manifest/API are available normally, all return private 503 for held and malformed configuration, HEAD is bodyless, explicit local release restores delivery");
} catch (error) {
  console.error("Asset recovery hold failed at:", stage);
  throw error;
} finally {
  await mf?.dispose();
  await rm(directory, { recursive: true, force: true });
}
