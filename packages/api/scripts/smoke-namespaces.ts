import { migrate } from "../../../tools/migrate-repository.mjs";
import { runOnce } from "../../../tools/ci-runner.mjs";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { teamFixture } from "./team/fixture.ts";
const f = await teamFixture({}, { vault: true }),
  exec = promisify(execFile);
try {
  const alice = await f.login("owner", "101"),
    bob = await f.login("bob", "202");
  await f.json("POST", "/api/namespaces", { name: "alice" }, alice);
  await f.json("POST", "/api/namespaces", { name: "bob" }, bob);
  assert.equal(
    (await f.request("POST", "/api/namespaces", { name: "alice" }, bob)).status,
    400,
  );
  assert.equal(
    (await f.request("POST", "/api/repos/alice/repo", {}, bob)).status,
    400,
  );
  const a = await f.json("POST", "/api/repos/alice/repo", {}, alice),
    b = await f.json("POST", "/api/repos/bob/repo", {}, bob);
  assert.notEqual(a.id, b.id);
  assert.equal(a.fullName, "alice/repo");
  assert.equal(a.cloneUrl, `${f.origin}/git/alice/repo.git`);
  assert.deepEqual((await f.json("GET","/api/repos/alice/repo/repository/audit",undefined,alice)).events,[]);
  assert.equal((await f.request("GET","/api/repos/alice/repo/repository/audit",undefined,bob)).status,404);
  assert.equal(
    (await f.request("GET", "/api/repos/alice/repo", undefined, bob)).status,
    404,
  );
  assert.equal(
    (await f.request("GET", "/git/alice/repo.git/info/refs")).status,
    401,
  );
  const base = "/api/repos/alice/repo";
  await f.json(
    "POST",
    base + "/agents",
    { handle: "migration", type: "test" },
    alice,
  );
  const credential = await f.json(
    "POST",
    base + "/agents/migration/token",
    {},
    alice,
  );
  const auth = {
    authorization: `Basic ${btoa(`migration:${credential.token}`)}`,
  };
  const source = join(f.dir, "source");
  await mkdir(source);
  const git = async (...args: string[]) =>
    (
      await exec(
        "git",
        [
          "-C",
          source,
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.invalid",
          ...args,
        ],
        {
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: "0",
            GIT_CONFIG_COUNT: "1",
            GIT_CONFIG_KEY_0: "http.extraHeader",
            GIT_CONFIG_VALUE_0: auth.authorization
              ? `Authorization: ${auth.authorization}`
              : "",
          },
        },
      )
    ).stdout.trim();
  await git("init", "-b", "main");
  await writeFile(join(source, "file.bin"), Buffer.from([0, 255, 3]));
  await mkdir(join(source, ".github/workflows"), { recursive: true });
  await writeFile(
    join(source, ".github/workflows/check.yml"),
    "on: push\njobs:\n  test:\n    runs-on: codegraff\n    steps:\n      - run: echo synthetic-check\n",
  );
  await git("add", ".");
  await git("commit", "-m", "Initial");
  await git("remote", "add", "nanohub", a.cloneUrl);
  await git("push", "nanohub", "main");
  const head = await git("rev-parse", "HEAD");
  assert.ok(
    (await f.json("GET", base + "/repository", undefined, alice)).runs.some(
      (r) => r.branch === "main" && r.head === head,
    ),
  );
  const cloudflare = await f.provisionSecret(a.id, "staging", "DEPLOY_TOKEN", "synthetic");
  await f.json(
    "PUT",
    base + "/secrets",
    { name: "DEPLOY_TOKEN", binding: cloudflare.binding },
    alice,
  );
  const grant = await f.json(
    "POST",
    base + "/secrets",
    { names: ["DEPLOY_TOKEN"], ttlSeconds: 900 },
    alice,
  );
  const renamed = await f.json(
    "POST",
    base + "/address",
    { name: "renamed.git-data" },
    alice,
  );
  assert.equal(renamed.id, a.id);
  for (const path of [base, "/api/repos/alice/renamed.git-data"]) {
    assert.equal((await f.json("GET", path, undefined, alice)).id, a.id);
    assert.equal(
      (await f.json("GET", path + "/repository", undefined, alice)).refs[0]
        .commit,
      head,
    );
  }
  assert.equal(
    (
      await f.json(
        "POST",
        "/api/repos/alice/renamed.git-data/secrets/read",
        {},
        { authorization: `Bearer ${grant.token}` },
      )
    ).values.DEPLOY_TOKEN,
    "synthetic",
  );
  await git("fetch", "nanohub");
  await git("remote", "set-url", "nanohub", renamed.cloneUrl);
  await git("fetch", "nanohub");
  assert.equal(
    (await f.request("POST", base, {}, alice)).status,
    400,
    "Old addresses cannot be reused",
  );
  const runner = await f.json(
    "POST",
    base + "/ci/runners",
    { name: "codegraff-actions" },
    alice,
  );
  const claim = await f.json(
    "POST",
    base + "/ci/claim",
    {},
    { authorization: `Bearer ${runner.token}` },
  );
  assert.equal(claim.cloneUrl, renamed.cloneUrl);
  assert.equal(claim.run.head, head);
  assert.equal(
    (
      await f.request("GET", `/git/bob/repo.git/info/refs`, undefined, {
        authorization: `Bearer ${claim.run.readToken}`,
      })
    ).status,
    401,
    "Read lease cannot cross repositories",
  );
  const ciAuth = { authorization: `Bearer ${runner.token}` };
  await f.json(
    "POST",
    base + "/ci/logs/" + claim.run.id,
    {
      attempt: claim.run.attempt,
      name: "check-test.log",
      content: "synthetic job output",
    },
    ciAuth,
  );
  const logPath = `/api/repos/alice/renamed.git-data/action-logs/${claim.run.id}/${claim.run.attempt}/check-test.log`;
  assert.equal((await f.request("GET", logPath, undefined, alice)).status, 200);
  assert.equal((await f.request("GET", logPath, undefined, bob)).status, 404);
  assert.equal(
    (
      await f.request(
        "POST",
        base + "/ci/logs/" + claim.run.id,
        { attempt: claim.run.attempt + 1, name: "forged.log", content: "no" },
        ciAuth,
      )
    ).status,
    403,
  );
  await f.json(
    "POST",
    base + "/ci/runs/" + claim.run.id,
    { attempt: claim.run.attempt, results: [], staging: null },
    { authorization: `Bearer ${runner.token}` },
  );
  await f.json("POST", base + "/ci/retry", { runId: claim.run.id }, alice);
  const retry = (await f.json("GET", base + "/repository", undefined, alice))
    .runs[0];
  assert.equal(retry.state, "queued");
  assert.equal(retry.deploymentApprovedBy, null);
  const nativeFetch = globalThis.fetch,
    previousKey = process.env.CODEGRAFF_API_KEY;
  const uploads: Buffer[] = [];
  const deletedSandboxes=new Set<string>();
  let sandboxes = 0,
    destroyed = 0;
  globalThis.fetch = async (input: any, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://gateway.codegraff.com/v1/")) {
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer synthetic-codegraff-fixture-key",
      );
      const route = new URL(url).pathname,
        body = init?.body ? JSON.parse(String(init.body)) : null;
      let result: any = {};
      if (route === "/v1/sandboxes") {
        sandboxes++;
        result = { id: "fixture-sandbox-" + sandboxes };
      } else if (init?.method === "DELETE") {
        destroyed++;
        deletedSandboxes.add(route);
        return new Response(null, { status: 204 });
      } else if (route.endsWith("/upload"))
        uploads.push(Buffer.from(body.contentBase64, "base64"));
      else if (route.endsWith("/exec"))
        result = {
          exitCode: 0,
          result: body.command.startsWith("docker inspect")
            ? JSON.stringify({ Running: false, ExitCode: 0 })
            : body.command.startsWith("docker logs")
              ? "synthetic Codegraff fixture output"
              : "",
        };
      else result = { state: deletedSandboxes.has(route)?"destroyed":"started" };
      return Response.json(result);
    }
    assert.ok(
      url.startsWith(f.origin),
      "Direct Actions cannot use a GitHub transport mirror",
    );
    return nativeFetch(input, init);
  };
  process.env.CODEGRAFF_API_KEY = "synthetic-codegraff-fixture-key";
  try {
    const completed = await runOnce(
      {
        origin: f.origin,
        repository: "alice/renamed.git-data",
        backend: "codegraff",
        image: "registry.invalid/fixture@sha256:" + "a".repeat(64),
        artifacts: join(f.dir, "controller"),
      },
      runner.token,
    );
    assert.equal(completed.state, "complete");
    assert.equal(completed.results[0].name, "check/test");
    assert.equal(completed.results[0].state, "success");
    assert.equal(completed.results[0].execution.provider, "codegraff");
    assert.equal(sandboxes, 1);
    assert.equal(destroyed, 1);
    for (const file of uploads)
      for (const token of [
        runner.token,
        credential.token,
        "synthetic-codegraff-fixture-key",
      ])
        assert.equal(file.includes(Buffer.from(token)), false);
    const logs = await f.request(
      "GET",
      new URL(completed.results[0].log).pathname,
      undefined,
      alice,
    );
    assert.equal(await logs.text(), "synthetic Codegraff fixture output");
    assert.equal(
      (
        await f.request(
          "GET",
          new URL(completed.results[0].log).pathname,
          undefined,
          bob,
        )
      ).status,
      404,
    );
  } finally {
    globalThis.fetch = nativeFetch;
    if (previousKey === undefined) delete process.env.CODEGRAFF_API_KEY;
    else process.env.CODEGRAFF_API_KEY = previousKey;
  }
  // Multiple processes/registrations race on the same repository queue.
  // This exercises the actual HTTP and Durable Object serialization boundary.
  const poolRunners=await Promise.all(Array.from({length:8},(_,i)=>f.json("POST",base+"/ci/runners",{name:`pool-${i}`},alice)));
  await Promise.all(Array.from({length:32},(_,i)=>f.json("POST",base+"/branches",{name:`pool/${i}`,from:"main"},alice)));
  const poolClaims=await Promise.all(Array.from({length:32},(_,i)=>f.json("POST",base+"/ci/claim",{},{authorization:`Bearer ${poolRunners[i%8].token}`})));
  assert.equal(new Set(poolClaims.map(c=>c.run.id)).size,32,"parallel workers must receive distinct leases");
  const registry=await f.json("GET",base+"/ci/runners",undefined,alice);
  assert.equal((await f.request("GET",base+"/ci/runners",undefined,bob)).status,404,"outsiders cannot discover runner registrations");
  assert.equal(registry.registrations.find(r=>r.id===poolRunners[0].id).active,4);
  assert.ok(registry.registrations.every(r=>!('hash' in r)&&!('token' in r)),"registration metadata never exposes credentials");
  assert.equal((await f.json("POST",base+"/ci/claim",{},ciAuth)).run,null,"no queue entry is leased twice");
  // Revoking a registration releases all its current jobs immediately.
  const revoked=poolRunners[0];
  await f.json("DELETE",base+"/ci/"+revoked.id,undefined,alice);
  assert.equal((await f.request("GET",new URL(renamed.cloneUrl+"/HEAD").pathname,undefined,{authorization:`Bearer ${poolClaims[0].run.readToken}`})).status,401);
  const reassigned=await Promise.all(Array.from({length:4},()=>f.json("POST",base+"/ci/claim",{},ciAuth)));
  assert.deepEqual(new Set(reassigned.map(c=>c.run.id)),new Set(poolClaims.filter((_,i)=>i%8===0).map(c=>c.run.id)));
  assert.ok(reassigned.every(c=>c.run.attempt===2));
  const stale=poolClaims[0].run;
  assert.equal((await f.request("POST",base+"/ci/runs/"+stale.id,{attempt:stale.attempt,results:[],staging:null},{authorization:`Bearer ${revoked.token}`})).status,403);
  await Promise.all(poolClaims.flatMap((c,i)=>i%8===0?[]:[f.json("POST",base+"/ci/runs/"+c.run.id,{attempt:c.run.attempt,results:[],staging:null},{authorization:`Bearer ${poolRunners[i%8].token}`})]));
  await Promise.all(reassigned.map(c=>f.json("POST",base+"/ci/runs/"+c.run.id,{attempt:c.run.attempt,results:[],staging:null},ciAuth)));
  await f.json("POST", "/api/trunks/legacy-private", { mode: "git" }, alice);
  const adopted = await f.json(
    "POST",
    "/api/repository-addresses/legacy-private",
    { namespace: "alice", name: "adopted" },
    alice,
  );
  assert.equal(adopted.id, "legacy-private");
  const destination = await f.json(
    "POST",
    "/api/repos/alice/migrated",
    {},
    alice,
  );
  await f.json(
    "POST",
    "/api/repos/alice/migrated/agents",
    { handle: "migration", type: "test" },
    alice,
  );
  const migrationCredential = await f.json(
    "POST",
    "/api/repos/alice/migrated/agents/migration/token",
    {},
    alice,
  );
  await migrate(
    source,
    destination.cloneUrl,
    "migration",
    migrationCredential.token,
  );
  assert.equal(
    (
      await f.json(
        "GET",
        "/api/repos/alice/migrated/repository",
        undefined,
        alice,
      )
    ).refs[0].commit,
    head,
  );
  await f.restart();
  assert.equal((await f.json("GET", base, undefined, alice)).id, a.id);
  console.log(
    "PASS: independent owner/repo namespaces, real Git push/fetch, stable rename aliases, ACL/lease isolation, secrets continuity, existing repo adoption, Actions retry and restart persistence",
  );
} finally {
  await f.close();
}
