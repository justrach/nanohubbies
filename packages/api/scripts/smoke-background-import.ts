import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const dir = await mkdtemp(join(tmpdir(), "nanohub-background-import-"));
const files = Array.from({ length: 64 }, (_, i) => ({
  path: `src/file-${i}.txt`,
  text: `file ${i}\n` + "source\n".repeat(28000),
}));
const archive = gzipSync(
  Buffer.concat([
    ...files.flatMap((file) => {
      const h = Buffer.alloc(512);
      h.write(`repo-main/${file.path}`);
      h.write("0000644\0", 100);
      h.write(
        Buffer.byteLength(file.text).toString(8).padStart(11, "0") + "\0",
        124,
      );
      h.write("0", 156);
      h.fill(32, 148, 156);
      h.write(
        h
          .reduce((a, b) => a + b, 0)
          .toString(8)
          .padStart(6, "0") + "\0 ",
        148,
      );
      const b = Buffer.from(file.text);
      return [h, b, Buffer.alloc((512 - (b.length % 512)) % 512)];
    }),
    Buffer.alloc(1024),
  ]),
);
const output = await build({
  entryPoints: [new URL("./import-job/worker.ts", import.meta.url).pathname],
  bundle: true,
  platform: "neutral",
  format: "esm",
  conditions: ["workerd", "worker", "browser"],
  external: ["cloudflare:workers", "node:*"],
  write: false,
});
let holdCopy = true,
  holdContext = true,
  downloads = 0;
const config = convertV4MiniflareOptions({
  name: "import-test",
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
      "ImportJob",
    ].map((className) => [
      className === "ImportJob" ? "IMPORT_JOB" : className.toUpperCase(),
      { className, useSQLite: true },
    ]),
  ),
  r2Buckets: ["OBJECTS"],
  d1Databases: ["AUTH_DB"],
  bindings: { SESSION_SECRET: "fixture-import-secret", DEV_LOGIN: "1" },
  outboundService: async (request: Request) => {
    const url = new URL(request.url);
    if (url.hostname === "github.com" && url.pathname.endsWith(".tar.gz")) {
      downloads++;
      if (url.pathname.includes("missing"))
        return new Response("missing", { status: 404 });
      if (holdCopy)
        return new Response("temporarily unavailable", { status: 503 });
      return new Response(archive, {
        headers: { "Content-Type": "application/gzip" },
      });
    }
    if (url.hostname === "api.github.com") {
      while (holdContext) await new Promise((r) => setTimeout(r, 50));
      if (
        url.pathname.endsWith("/issues") &&
        url.searchParams.get("state") === "open"
      )
        return Response.json([
          {
            number: 1,
            title: "Upstream collision",
            body: "upstream",
            state: "open",
            labels: [],
            user: null,
            created_at: new Date().toISOString(),
            comments: 0,
            html_url: "https://github.com/fixture/repo/issues/1",
          },
        ]);
      return Response.json(
        url.pathname.endsWith("/repo")
          ? {
              full_name: "fixture/repo",
              default_branch: "main",
              html_url: "https://github.com/fixture/repo",
              stargazers_count: 1,
              description: "Imported context",
              license: null,
            }
          : [],
      );
    }
    return new Response("unexpected egress", { status: 503 });
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
  cookie?: string,
) {
  return fetch(origin + path, {
    method,
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function json(
  method: string,
  path: string,
  body?: unknown,
  cookie?: string,
) {
  const r = await request(method, path, body, cookie);
  const v = (await r.json()) as any;
  assert.ok(r.ok, `${r.status}: ${JSON.stringify(v)}`);
  return v;
}
const base = "/api/trunks/background";
try {
  const cookie = (await request("GET", "/fixture/session")).headers
    .get("set-cookie")!
    .split(";")[0];
  const bob = (await request("GET", "/fixture/session?id=bob")).headers
    .get("set-cookie")!
    .split(";")[0];
  const started = Date.now();
  const queued = await request(
    "POST",
    base + "/import",
    { repo: "fixture/repo", background: true },
    cookie,
  );
  assert.equal(queued.status, 202, await queued.text());
  assert.ok(Date.now() - started < 2000, "enqueue must not wait for archive");
  await mf.dispose();
  mf = new Miniflare({
    ...config,
    resourcePersistencePath: join(dir, "state"),
  });
  origin = (await mf.ready).origin;
  assert.equal((await json("GET", "/api/trunks", undefined, cookie)).length, 1);
  assert.equal(
    (await request("GET", base + "/import", undefined, bob)).status,
    404,
  );
  assert.equal((await request("GET", base + "/import")).status, 404);
  assert.equal(
    (await request("GET", base + "/info", undefined, cookie)).status,
    409,
  );
  assert.equal((await request("DELETE", base, undefined, cookie)).status, 409);
  await json(
    "POST",
    base + "/agents",
    { handle: "first-agent", type: "Codex" },
    cookie,
  );
  const issued = await json(
    "POST",
    base + "/agents/first-agent/token",
    {},
    cookie,
  );
  await json(
    "POST",
    base + "/issues",
    { title: "Local task during copy", body: "Keep this conversation" },
    cookie,
  );
  const startup = await json("GET", base+"/bootstrap", undefined, cookie);
  assert.equal(startup.info, null);
  assert.equal(startup.job.ready, false);
  assert.equal(startup.session.user.id, "alice");
  assert.equal(startup.tokens.length, 1);
  assert.equal((await request("GET",base+"/bootstrap",undefined,bob)).status,404);
  holdCopy = false;
  const deadline = Date.now() + 90000;
  let status: any;
  while (Date.now() < deadline) {
    status = (await json("GET", base + "/import", undefined, cookie)).job;
    assert.notEqual(status.phase, "failed", JSON.stringify(status));
    if (status.ready) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  assert.equal(status.ready, true, JSON.stringify(status));
  assert.equal(status.phase, "context");
  assert.equal(status.files, 64);
  assert.ok(status.bytes > 8 * 1024 * 1024);
  const remote = `${origin.replace("://", `://first-agent:${issued.token}@`)}/git/background.git`;
  await exec("git", ["clone", remote, join(dir, "clone")]);
  await exec("git", ["fsck", "--full"], { cwd: join(dir, "clone") });
  for (const file of files)
    assert.equal(
      await readFile(join(dir, "clone", file.path), "utf8"),
      file.text,
    );
  holdContext = false;
  while (Date.now() < deadline) {
    status = (await json("GET", base + "/import", undefined, cookie)).job;
    if (status.phase === "complete") break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(status.phase, "complete", JSON.stringify(status));
  assert.ok(
    status.notes.some((note: string) =>
      note.includes("local issue was preserved"),
    ),
  );
  const issues = await json("GET", base + "/issues", undefined, cookie);
  assert.ok(JSON.stringify(issues).includes("Local task during copy"));
  assert.equal((await json("GET", base, undefined, cookie)).version, 1);
  assert.equal(
    (
      await request(
        "POST",
        base + "/import",
        { repo: "fixture/repo", background: true },
        cookie,
      )
    ).ok,
    false,
  );
  const missing = "/api/trunks/missing";
  await json(
    "POST",
    missing + "/import",
    { repo: "fixture/missing", background: true },
    cookie,
  );
  for (let i = 0; i < 100; i++) {
    const job = (await json("GET", missing + "/import", undefined, cookie)).job;
    if (job.phase === "failed") break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(
    (await json("GET", missing + "/import", undefined, cookie)).job.phase,
    "failed",
  );
  assert.equal(
    (await request("POST", missing + "/import/retry", {}, bob)).status,
    404,
  );
  const retry = await json("POST", missing + "/import/retry", {}, cookie);
  assert.notEqual(retry.job.phase, "failed");
  console.log(
    `PASS: durable restart, private progress, live setup/tasks, ${status.bytes} source bytes, lost batch reply replay, valid git clone, preserved local tasks (${downloads} downloads)`,
  );
} finally {
  holdContext = false;
  await mf.dispose();
  await rm(dir, { recursive: true, force: true });
}
