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
  await mkdir(join(assetDirectory, "nh/releases/0.0.1"), { recursive: true });
  await mkdir(join(assetDirectory, "_next/static"), { recursive: true });
  await writeFile(join(assetDirectory, "nh/latest.json"), '{"synthetic":true}\n');
  await writeFile(join(assetDirectory, "nh/install.mjs"), '// Synthetic installer\n');
  await writeFile(join(assetDirectory, "nh/releases/0.0.1/nh.mjs"), '// Synthetic CLI module\n');
  await writeFile(join(assetDirectory, "nh/releases/0.0.1/SHA256SUMS"), 'Synthetic checksum fixture\n');
  await writeFile(join(assetDirectory, "_next/static/app.js"), "// Synthetic public fixture asset\n");
  await writeFile(join(assetDirectory, "_next/static/app.css"), "body{color:#123456}\n");
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
            if(${JSON.stringify(path)}==='next')return new Response('<!doctype html><title>Synthetic dynamic SSR</title>',{headers:{'Content-Type':'text/html'}});
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
  const expected = [
    { path: "/", text: "<!doctype html><title>Synthetic static page</title>", type: /text\/html/ },
    { path: "/nh/latest.json", text: '{"synthetic":true}\n', type: /application\/json/ },
    { path: "/nh/install.mjs", text: '// Synthetic installer\n', type: /javascript/ },
    { path: "/nh/releases/0.0.1/nh.mjs", text: '// Synthetic CLI module\n', type: /javascript/ },
    { path: "/nh/releases/0.0.1/SHA256SUMS", text: 'Synthetic checksum fixture\n', type: null },
    { path: "/_next/static/app.js", text: "// Synthetic public fixture asset\n", type: /javascript/ },
    { path: "/_next/static/app.css", text: "body{color:#123456}\n", type: /text\/css/ },
    { path: "/api/agent-help", text: "synthetic API delegate", type: /text\/plain/ },
    { path: "/dynamic", text: "<!doctype html><title>Synthetic dynamic SSR</title>", type: /text\/html/ },
  ];
  const paths = expected.map(item => item.path);
  for (const { path, text, type } of expected) {
    const response = await send(path);
    const body = await response.text();
    assert.equal(response.status, 200, path + ": " + (response.ok ? "" : body.slice(0, 1200)));
    assert.equal(body, text, path + " must return the intended resource bytes, not an HTML fallback");
    if (type) assert.match(response.headers.get("content-type")!, type, path + " has the correct MIME type");
    else assert.equal(response.headers.get("content-type"), null, path + " preserves the asset binding's extensionless MIME metadata");
  }
  stage = "missing download delivery";
  const missingDownloads = ["/nh/releases/999.0.0/nh.mjs", "/nh/releases/999.0.0/SHA256SUMS", "/nh/releases/0.0.1/nh.mjs/", "/nh/releases/999.0.0/nh.mjs?download=1"];
  for (const path of missingDownloads) {
    for (const method of ["GET", "HEAD"]) {
      const response = await send(path, method);
      assert.equal(response.status, 404, method + " " + path);
      assert.match(response.headers.get("cache-control")!, /private, no-store/);
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      const body = await response.text();
      assert.ok(!body.includes("Synthetic dynamic SSR"), "missing CLI assets never reach Next");
      if (method === "HEAD") assert.equal(body, "");
    }
  }
  const post = await send("/nh/latest.json", "POST");
  assert.equal(post.status, 405); assert.equal(post.headers.get("allow"), "GET, HEAD");
  for (const { path } of expected.filter(item => item.path.startsWith("/nh/"))) {
    const head = await send(path, "HEAD");
    assert.equal(head.status, 200); assert.equal(await head.text(), "");
    assert.equal(head.headers.get("cache-control"), "public, max-age=0, must-revalidate");
  }
  paths.push(...missingDownloads);
  for (const path of ["/nh/project", "/nh/releases", "/nh/project/tree/main", "/cli/authorize"]) {
    const response = await send(path);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "<!doctype html><title>Synthetic dynamic SSR</title>");
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
  console.log("PASS: actual web entrypoint and Miniflare asset router use canonical Worker-first configuration; exact static/CLI bytes and MIME metadata, missing CLI downloads return private 404 without HTML fallback, unsupported methods return 405, held and malformed configuration returns private 503, HEAD is bodyless, explicit local release restores delivery");
} catch (error) {
  console.error("Asset recovery hold failed at:", stage);
  throw error;
} finally {
  await mf?.dispose();
  await rm(directory, { recursive: true, force: true });
}
