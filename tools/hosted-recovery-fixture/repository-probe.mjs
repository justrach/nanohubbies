import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile, chmod, symlink } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { classes } from "../hosted-git-fixture/config.mjs";
import { gitProxy } from "../hosted-git-fixture/proxy.mjs";
import { verifyRetainedBytes } from "./probe.mjs";

const exec = promisify(execFile),
  hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const bookmark = /^[a-f0-9]{8}-[a-f0-9]{8}-[a-f0-9]{8}-[a-f0-9]{32}$/;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function runRepositoryRecoveryProbe({
  call,
  wrangler,
  config,
  plan,
  record,
  persist,
  directory,
  setPhase,
  origin,
  controlKey,
}) {
  assert.equal(plan.purpose, "repository-recovery");
  const trunk = "hosted-recovery",
    base = "/api/trunks/" + trunk,
    archived = "/api/trunks/hosted-archived";
  const result = (record.repositoryRecovery = {
    startedAt: new Date().toISOString(),
    scope:
      "Isolated hosted repository; in-place DO/D1 recovery and independently retained R2; normal traffic held",
    checkpoints: [],
    heldChecks: 0,
    phase: "seed",
  });
  const stage = async (phase) => {
    result.phase = phase;
    await persist();
    console.log(JSON.stringify({ runId: plan.runId, phase }));
  };
  const cookies = {},
    proxies = new Map();
  let mcp;
  const credentials = {};
  const savePrivate = () =>
    writeFile(
      join(directory, "repository-private-grants.json"),
      JSON.stringify({ cookies, credentials }, null, 2),
      { mode: 0o600 },
    );
  async function request(
    path,
    { method = "GET", body, principal = "owner", expected } = {},
  ) {
    const headers = {
      "x-nanohub-hosted-fixture": controlKey,
      Origin: origin,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(typeof principal === "string"
        ? { Cookie: cookies[principal] }
        : (principal ?? {})),
    };
    for (let retry = 0; ; retry++) {
      const response = await fetch(origin + "/__fixture/app" + path, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error",
        signal: AbortSignal.timeout(120000),
      });
      if (response.status === 429 && retry < 2) {
        const seconds = Number(response.headers.get("retry-after"));
        await response.body?.cancel();
        assert.ok(seconds > 0 && seconds <= 60);
        await wait(seconds * 1000);
        continue;
      }
      assert.ok(
        expected === undefined ? response.ok : response.status === expected,
        `Repository fixture HTTP ${response.status}: ${path}`,
      );
      return response;
    }
  }
  const api = async (method, path, body, principal = "owner", expected) =>
    (await request(path, { method, body, principal, expected })).json();
  const control = async (body) =>
    await call("/__fixture/repository", { method: "POST", body });
  const jsonControl = async (body) => (await control(body)).json();
  const object = async (target, op, more = {}) =>
    (
      await call("/__fixture/recovery", {
        method: "POST",
        body: { ...target, op, ...more },
      })
    ).json();
  const bearer = (value) => ({ authorization: "Bearer " + value.token });
  const basic = (value) => ({
    authorization:
      "Basic " + Buffer.from("git:" + value.token).toString("base64"),
  });
  const held = async () => {
    for (const [path, method] of [
      [base + "/branches", "GET"],
      ["/git/recovery-owner/project.git/HEAD", "GET"],
      ["/nh/latest.json", "GET"],
      ["/nh/latest.json", "HEAD"],
    ]) {
      const response = await call(path, { method, expectedStatus: 503 });
      assert.equal(response.headers.get("x-nanohub-recovery"), "hold");
      assert.match(response.headers.get("cache-control"), /private.*no-store/);
      if (method === "HEAD") assert.equal(await response.text(), "");
      else assert.equal((await response.json()).code, "recovery_hold");
      result.heldChecks++;
    }
  };
  const env = {
    PATH: process.env.PATH,
    HOME: directory,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    NANOHUB_API_TOKEN: "",
  };
  const source = join(directory, "source");
  await mkdir(source, { mode: 0o700 });
  const git = async (dir, ...args) =>
    (
      await exec(
        "git",
        [
          "-C",
          dir,
          "-c",
          "user.name=Hosted recovery fixture",
          "-c",
          "user.email=fixture@example.invalid",
          ...args,
        ],
        { env, maxBuffer: 8 << 20, timeout: 120000 },
      )
    ).stdout.trim();
  async function transport(credential, ...args) {
    if (!proxies.has(credential.token))
      proxies.set(
        credential.token,
        await gitProxy({
          origin,
          authorization: basic(credential).authorization,
          control: controlKey,
          repositoryPath: "/git/recovery-owner/project.git",
          upstreamPrefix: "/__fixture/app",
        }),
      );
    const remote =
      proxies.get(credential.token).origin + "/git/recovery-owner/project.git";
    const command = args.map((value) => (value === "$REMOTE" ? remote : value));
    return exec("git", ["-C", source, ...command], {
      env: {
        ...env,
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "http.extraHeader",
        GIT_CONFIG_VALUE_0: "Authorization: " + basic(credential).authorization,
      },
      maxBuffer: 8 << 20,
      timeout: 120000,
    });
  }
  const closeProxies = async () => {
    for (const proxy of proxies.values()) await proxy.close();
    proxies.clear();
  };
  const objects = async (inventory) => {
    const all = [];
    let cursor;
    do {
      const page = await jsonControl({
        op: "objects-list",
        inventory,
        ...(cursor ? { cursor } : {}),
      });
      assert.ok(Array.isArray(page.objects));
      all.push(...page.objects);
      assert.ok(all.length <= 500, "Bounded isolated inventory");
      if (page.truncated) {
        assert.ok(page.cursor && page.cursor !== cursor);
        cursor = page.cursor;
      } else cursor = undefined;
    } while (cursor);
    assert.equal(new Set(all.map((x) => x.key)).size, all.length);
    return all.sort((a, b) => a.key.localeCompare(b.key));
  };
  const inventory = async () => {
    const entries = [];
    for (const item of await objects(true)) {
      const response = await control({ op: "object-get", key: item.key });
      const entry = await response.json();
      assert.ok(classes.some(([binding]) => binding === entry.binding));
      assert.match(entry.id, /^[a-f0-9]{64}$/);
      assert.equal(
        item.key,
        "__fixture/inventory/" + entry.binding + "/" + entry.id,
      );
      entries.push(entry);
    }
    return entries.sort((a, b) =>
      (a.binding + a.id).localeCompare(b.binding + b.id),
    );
  };
  const d1Point = async () => {
    const point = JSON.parse(
      (
        await wrangler(
          ["d1", "time-travel", "info", plan.database, "--json"],
          config,
        )
      ).stdout,
    ).bookmark;
    assert.match(point, bookmark);
    return point;
  };
  const snapshot = async (label) => {
    await closeProxies();
    await setPhase("frozen");
    await held();
    await request(base + "/branches", { expected: 503 });
    const entries = await inventory();
    assert.equal(new Set(entries.map((x) => x.binding)).size, 9);
    const points = [];
    for (const entry of entries) {
      const state = await object(entry, "inspect");
      assert.equal(state.alarm, null, "No pending alarm at checkpoint");
      assert.equal(state.webSockets, 0, "No open socket at checkpoint");
      assert.equal(state.pending, 0, "No unpublished objects at checkpoint");
      assert.ok(
        state.importPhase === null ||
          ["complete", "failed"].includes(state.importPhase),
        "No active import at checkpoint",
      );
      const point = await object(entry, "checkpoint");
      assert.equal(point.id, entry.id);
      points.push({ ...entry, bookmark: point.bookmark });
    }
    const database = await jsonControl({ op: "database-state" }),
      d1Bookmark = await d1Point();
    const files = [],
      retained = join(directory, label, "objects");
    await mkdir(retained, { recursive: true, mode: 0o700 });
    for (const item of await objects(false)) {
      assert.ok(
        item.size <= 4194304,
        "Fixture pack must fit the bounded retained-byte control",
      );
      const bytes = Buffer.from(
        await (
          await control({ op: "object-get", key: item.key })
        ).arrayBuffer(),
      );
      assert.equal(bytes.length, item.size);
      const file = hash(Buffer.from(item.key)) + ".bin";
      await writeFile(join(retained, file), bytes, { mode: 0o600 });
      files.push({ ...item, sha256: hash(bytes), bytes: bytes.length, file });
    }
    assert.deepEqual(
      await inventory(),
      entries,
      "Inventory stays stable while frozen",
    );
    const captured = { label, points, d1Bookmark, database, files, retained };
    await writeFile(
      join(directory, label + ".json"),
      JSON.stringify(captured, null, 2),
      { mode: 0o600 },
    );
    result.checkpoints.push({
      label,
      durableObjects: points.length,
      classes: 9,
      r2Objects: files.length,
      r2Bytes: files.reduce((n, x) => n + x.bytes, 0),
    });
    await persist();
    return captured;
  };
  const validate = async (snapshot) => {
    assert.equal(
      new Set(snapshot.points.map((x) => x.binding + "/" + x.id)).size,
      snapshot.points.length,
    );
    for (const point of snapshot.points) assert.match(point.bookmark, bookmark);
    assert.match(snapshot.d1Bookmark, bookmark);
    for (const file of snapshot.files)
      verifyRetainedBytes(
        await readFile(join(snapshot.retained, file.file)),
        file,
      );
  };
  const restore = async (snapshot, lose = false) => {
    await validate(snapshot);
    await closeProxies();
    await setPhase("frozen");
    await held();
    if (lose) {
      result.lossStartedAt = new Date().toISOString();
      await persist();
      for (const point of snapshot.points) {
        const lost = await object(point, "lose-inspect");
        assert.equal(lost.alarm, null);
        assert.equal(lost.webSockets, 0);
        assert.deepEqual(lost.tables, []);
      }
      assert.deepEqual(await jsonControl({ op: "database-lose" }), {
        tables: [],
        accounts: [],
        credentials: [],
      });
      for (const entry of await objects(false))
        await jsonControl({ op: "object-delete", key: entry.key });
      assert.deepEqual(await objects(false), []);
      await setPhase("verify");
      await api("GET", base + "/branches", undefined, "owner", 400);
      await request("/git/recovery-owner/project.git/HEAD", {
        principal: basic(credentials.git),
        expected: 404,
      });
      result.physicalApplicationLossObserved = true;
      await persist();
      await setPhase("frozen");
    }
    // Validate every retained object before the first write; restore bytes before
    // restarting real constructors that may read their publication state.
    await validate(snapshot);
    for (const file of snapshot.files)
      await jsonControl({
        op: "object-put",
        key: file.key,
        base64: (await readFile(join(snapshot.retained, file.file))).toString(
          "base64",
        ),
      });
    const d1 = JSON.parse(
      (
        await wrangler(
          [
            "d1",
            "time-travel",
            "restore",
            plan.database,
            "--bookmark",
            snapshot.d1Bookmark,
            "--json",
          ],
          config,
        )
      ).stdout,
    );
    assert.equal(d1.bookmark, snapshot.d1Bookmark);
    assert.match(d1.previous_bookmark, bookmark);
    for (const point of snapshot.points) {
      const scheduled = await object(point, "schedule", {
        bookmark: point.bookmark,
      });
      assert.match(scheduled.undoBookmark, bookmark);
      await object(point, "restart");
    }
    await held();
    await setPhase("verify");
    assert.deepEqual(
      await jsonControl({ op: "database-state" }),
      snapshot.database,
    );
    assert.deepEqual(
      await inventory(),
      snapshot.points.map(({ binding, id }) => ({ binding, id })),
    );
    assert.deepEqual(
      await objects(false),
      snapshot.files.map(({ key, size }) => ({ key, size })),
    );
    for (const file of snapshot.files)
      verifyRetainedBytes(
        Buffer.from(
          await (
            await control({ op: "object-get", key: file.key })
          ).arrayBuffer(),
        ),
        file,
      );
  };
  try {
    await stage("repository-seed");
    await held();
    for (const role of ["owner", "writer"]) {
      const session = await call("/__fixture/repository-session", {
        method: "POST",
        body: { role },
      });
      cookies[role] = session.headers.get("set-cookie")?.split(";")[0];
      assert.ok(cookies[role]);
    }
    await savePrivate();
    await api("POST", base, { mode: "git" });
    await api("POST", archived, { mode: "git" });
    const archive = await api("GET", archived + "/archive");
    await api("POST", archived + "/archive", {
      archived: true,
      revision: archive.revision,
      confirmation: archive.confirmation,
    });
    const archivedBefore = await api("GET", archived + "/archive");
    await api("POST", "/api/namespaces", { name: "recovery-owner" });
    await api("POST", "/api/repository-addresses/" + trunk, {
      namespace: "recovery-owner",
      name: "project",
    });
    const invitation = await api("POST", base + "/collaborators", {
      userId: "codegraff:recovery-writer",
      role: "writer",
    });
    await api(
      "POST",
      "/api/invitations/accept",
      { trunk, token: invitation.token },
      "writer",
    );
    credentials.git = await api("POST", base + "/git-tokens", {
      label: "Hosted recovery fixture",
    });
    credentials.cli = await api("POST", base + "/cli-credentials", {
      label: "Hosted recovery fixture",
      scopes: ["read", "contents:read"],
      days: 1,
    });
    credentials.runner = await api("POST", base + "/ci/runners", {
      name: "hosted-recovery",
    });
    await api("POST", base + "/agents", {
      handle: "builder",
      type: "Any MCP client",
    });
    credentials.agent = await api("POST", base + "/agents/builder/token", {});
    await savePrivate();
    await git(source, "init", "-b", "main");
    const binary = Buffer.alloc(1048593);
    for (let i = 0; i < binary.length; i++)
      binary[i] = (i * 37 + (i >> 8)) & 255;
    await writeFile(join(source, "README.md"), "Base\n");
    await writeFile(join(source, "asset.bin"), binary);
    await writeFile(
      join(source, "run.sh"),
      '#!/bin/sh\nprintf "recovered\\n"\n',
    );
    await chmod(join(source, "run.sh"), 0o755);
    await symlink("README.md", join(source, "readme-link"));
    await git(source, "add", ".");
    await git(source, "commit", "-m", "Recovery base");
    const anchor = await git(source, "rev-parse", "HEAD");
    await git(source, "tag", "-a", "v1.0.0", "-m", "Annotated recovery tag");
    const branch = "検証/restore-🚀";
    await git(source, "checkout", "-b", branch);
    await writeFile(join(source, "README.md"), "Candidate\nReview this hunk\n");
    await git(source, "commit", "-am", "Recovery candidate");
    const commit = await git(source, "rev-parse", "HEAD");
    await transport(
      credentials.git,
      "push",
      "$REMOTE",
      "main",
      "refs/tags/v1.0.0",
      "HEAD:refs/heads/" + branch,
    );
    const policy = {
      branch: "main",
      pullRequest: true,
      approvals: 1,
      checks: [],
      beforeOpen: [],
      preventForce: true,
      preventDelete: true,
      requireConversationResolution: true,
      successOnlyChecks: true,
    };
    await api("PUT", base + "/protection", policy);
    await api("PUT", base + "/protection", {
      ...policy,
      branch: "locked/*",
      locked: true,
    });
    await api("POST", base + "/rulesets", {
      name: "Retain release tags",
      target: "tag",
      enforcement: "active",
      conditions: { ref_name: { include: ["~ALL"], exclude: [] } },
      rules: [{ type: "deletion" }, { type: "non_fast_forward" }],
      bypass_actors: [],
    });
    await api("POST", base + "/pulls", {
      title: "Recovery review",
      head: branch,
    });
    await api(
      "POST",
      base + "/pulls/1/reviews",
      {
        commit,
        anchor,
        verdict: "APPROVE",
        body: "Independent review retained",
      },
      "writer",
    );
    await api(
      "POST",
      base + "/pulls/1/comments",
      {
        id: "hosted-recovery-hunk",
        commit,
        anchor,
        path: "README.md",
        side: "RIGHT",
        startLine: 2,
        line: 2,
        body: "Keep this thread unresolved",
      },
      "writer",
    );
    await api("POST", base + "/issues", {
      title: "Hosted recovery issue",
      body: "Room metadata must survive",
    });
    mcp = new Client({ name: "Hosted recovery fixture", version: "1" });
    await mcp.connect(
      new StreamableHTTPClientTransport(
        new URL(origin + "/__fixture/app" + base + "/agents/builder/mcp"),
        {
          requestInit: {
            headers: {
              "x-nanohub-hosted-fixture": controlKey,
              ...bearer(credentials.agent),
            },
          },
        },
      ),
    );
    const sessionId = randomUUID();
    assert.ok(
      !(
        await mcp.callTool({
          name: "nanohub_start_work",
          arguments: { sessionId, title: "Retained agent attribution" },
        })
      ).isError,
    );
    await mcp.close();
    mcp = undefined;
    await api(
      "GET",
      "/api/cli/trunks/" + trunk + "/branches",
      undefined,
      bearer(credentials.cli),
    );
    // Instantiate unused real classes too. Constructor registrations include all
    // application instances reached by internal RPC, rather than a guessed list.
    const present = new Set((await inventory()).map((x) => x.binding));
    for (const [binding] of classes)
      if (!present.has(binding))
        await object(
          { binding, name: "unused-" + binding.toLowerCase() },
          "inspect",
        );
    const old = await snapshot("before-revocations");
    await stage("revoke-current-authority");
    await setPhase("reconcile");
    const ledger = {
      repository: trunk,
      owner: "codegraff:recovery-owner",
      removedCollaborator: "codegraff:recovery-writer",
      git: credentials.git.id,
      agent: credentials.agent.id,
      cli: credentials.cli.id,
      runner: credentials.runner.id,
      providerAccounts: ["owner", "writer"],
    };
    await writeFile(
      join(directory, "latest-authority.json"),
      JSON.stringify(ledger, null, 2),
      { mode: 0o600 },
    );
    const revoke = async (ledger) => {
      assert.equal(ledger.repository, trunk);
      assert.equal(ledger.owner, "codegraff:recovery-owner");
      await api("DELETE", "/api/tokens/" + ledger.git);
      await api("DELETE", "/api/tokens/" + ledger.agent);
      await api("DELETE", "/api/cli/credentials/" + ledger.cli);
      await api("DELETE", base + "/ci/" + ledger.runner);
      await api("PATCH", base + "/collaborators", {
        userId: ledger.removedCollaborator,
        role: null,
      });
      for (const role of ledger.providerAccounts)
        await jsonControl({ op: "account-forget", role });
    };
    const denied = async () => {
      await request(base + "/branches", { principal: "writer", expected: 404 });
      for (const credential of [credentials.git, credentials.agent])
        await request("/git/" + trunk + ".git/HEAD", {
          principal: basic(credential),
          expected: 401,
        });
      await request("/api/cli/trunks/" + trunk + "/branches", {
        principal: bearer(credentials.cli),
        expected: 401,
      });
      await request(base + "/ci/claim", {
        method: "POST",
        body: {},
        principal: bearer(credentials.runner),
        expected: 403,
      });
      await request(base + "/agents/builder/mcp", {
        method: "POST",
        body: {},
        principal: bearer(credentials.agent),
        expected: 401,
      });
      for (const role of ["owner", "writer"])
        assert.deepEqual(await jsonControl({ op: "account-proof", role }), {
          sha256: null,
        });
    };
    await revoke(ledger);
    await denied();
    const paths = [
      "/repository",
      "/branches",
      "/default-branch",
      "/protection",
      "/rulesets",
      "/repository/audit",
      "/issues",
      "/contributions",
      "/ci/runners",
    ];
    const metadata = await Promise.all(
        paths.map((path) => api("GET", base + path)),
      ),
      pull = await api("GET", base + "/pulls/1");
    assert.equal(pull.reviews.length, 1);
    assert.equal(pull.discussion.comments.length, 1);
    assert.equal(pull.discussion.comments[0].resolved, false);
    assert.equal(pull.reviewGate.approvals, 0);
    assert.equal(
      metadata[paths.indexOf("/contributions")].events[0].sessionId,
      sessionId,
    );
    const current = await snapshot("after-revocations");
    await stage("reject-corrupt-repository-backup");
    const retained = current.files.find((x) => x.bytes > 0),
      file = join(current.retained, retained.file),
      original = await readFile(file);
    const corrupt = Buffer.from(original);
    corrupt[0] ^= 255;
    await writeFile(file, corrupt, { mode: 0o600 });
    await assert.rejects(validate(current), /checksum/);
    assert.equal(result.lossStartedAt, undefined);
    await writeFile(file, original, { mode: 0o600 });
    result.corruptionRejectedBeforeLoss = true;
    await persist();
    await stage("complete-application-loss-and-restore");
    await restore(current, true);
    await denied();
    assert.deepEqual(
      await Promise.all(paths.map((path) => api("GET", base + path))),
      metadata,
    );
    const recoveredPull = await api("GET", base + "/pulls/1");
    for (const key of [
      "pull",
      "reviews",
      "discussion",
      "effectivePolicies",
      "reviewGate",
    ])
      assert.deepEqual(recoveredPull[key], pull[key]);
    assert.deepEqual(await api("GET", archived + "/archive"), archivedBefore);
    await request(archived + "/issues", {
      method: "POST",
      body: {
        title: "Must remain locked",
        body: "Recovery cannot reopen an archive",
      },
      expected: 403,
    });
    await request(base + "/branches", { principal: null, expected: 404 });
    result.exactMetadataReviewsAndArchive = true;
    const fresh = await api("POST", base + "/git-tokens", {
      label: "Post-recovery verification",
    });
    const clone = join(directory, "restored-clone");
    await transport(fresh, "clone", "--mirror", "$REMOTE", clone);
    await git(clone, "fsck", "--strict");
    for (const args of [
      ["for-each-ref", "--format=%(refname) %(objectname)"],
      ["rev-list", "--objects", "--all"],
      ["ls-tree", "-r", anchor],
    ])
      assert.equal(await git(clone, ...args), await git(source, ...args));
    const restoredBinary = await exec(
      "git",
      ["-C", clone, "show", anchor + ":asset.bin"],
      { env, encoding: "buffer", maxBuffer: 2 << 20 },
    );
    assert.deepEqual(restoredBinary.stdout, binary);
    await assert.rejects(
      transport(fresh, "push", "$REMOTE", "HEAD:refs/heads/main"),
      /reviewed pull request/,
    );
    await assert.rejects(
      transport(fresh, "push", "$REMOTE", "HEAD:refs/heads/locked/recovery"),
      /locked/i,
    );
    await assert.rejects(
      transport(fresh, "push", "$REMOTE", ":refs/tags/v1.0.0"),
      /delet/i,
    );
    await request(base + "/pulls/1/merge", {
      method: "POST",
      body: { commit, anchor },
      expected: 400,
    });
    await api("DELETE", "/api/tokens/" + fresh.id);
    result.exactGitGraphBinaryModesTags = true;
    result.protectedPushLockTagDeletionAndMergeDenied = true;
    result.currentCheckpointRevocationsRetained = true;
    await persist();
    await stage("older-checkpoint-authority-hazard");
    await restore(old);
    await api("GET", base + "/branches", undefined, "writer");
    await request("/git/" + trunk + ".git/HEAD", {
      principal: basic(credentials.git),
    });
    await api(
      "GET",
      "/api/cli/trunks/" + trunk + "/branches",
      undefined,
      bearer(credentials.cli),
    );
    await api("POST", base + "/ci/claim", {}, bearer(credentials.runner));
    for (const role of ["owner", "writer"])
      assert.match(
        (await jsonControl({ op: "account-proof", role })).sha256,
        /^[a-f0-9]{64}$/,
      );
    mcp = new Client({
      name: "Isolated rollback authority probe",
      version: "1",
    });
    await mcp.connect(
      new StreamableHTTPClientTransport(
        new URL(origin + "/__fixture/app" + base + "/agents/builder/mcp"),
        {
          requestInit: {
            headers: {
              "x-nanohub-hosted-fixture": controlKey,
              ...bearer(credentials.agent),
            },
          },
        },
      ),
    );
    assert.equal((await mcp.listTools()).tools.length, 5);
    await mcp.close();
    mcp = undefined;
    result.olderCheckpointResurrectsAuthority = true;
    await held();
    await persist();
    await stage("reconcile-independent-current-authority");
    await setPhase("reconcile");
    const latest = JSON.parse(
      await readFile(join(directory, "latest-authority.json"), "utf8"),
    );
    assert.deepEqual(latest, ledger);
    await revoke(latest);
    await denied();
    await closeProxies();
    await setPhase("frozen");
    for (const entry of await inventory()) await object(entry, "restart");
    await setPhase("verify");
    await denied();
    const finalPull = await api("GET", base + "/pulls/1");
    assert.equal(finalPull.reviewGate.approvals, 0);
    assert.equal(finalPull.reviews.length, 1);
    assert.equal(finalPull.discussion.comments[0].resolved, false);
    assert.deepEqual(
      (await api("GET", base + "/repository")).refs,
      metadata[0].refs,
    );
    await setPhase("frozen");
    await held();
    await request(base + "/branches", { expected: 503 });
    result.latestAuthorityReconciledAndDeniedAfterRestart = true;
    result.normalTrafficNeverReopened = true;
    result.finishedAt = new Date().toISOString();
    result.passed = true;
    await persist();
  } finally {
    if (mcp) await mcp.close().catch(() => {});
    await closeProxies();
  }
}
