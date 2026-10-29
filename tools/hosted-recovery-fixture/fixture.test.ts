import test from "node:test";
import assert from "node:assert/strict";
import { recoveryObject } from "./objects";
import { control } from "./control";
import { repositoryRoute } from "./repository-control";
import {
  metadataRows,
  ownedSecret,
  assertVaultBindings,
} from "./vault-lifecycle.mjs";
import {
  fixturePlan,
  classes,
  assertFixtureBindings,
} from "../hosted-git-fixture/config.mjs";
import { verifyRetainedBytes } from "./probe.mjs";
import { createHash } from "node:crypto";
import { verifiedR2Reconcile } from "./retained.mjs";
import { waitForFixturePhase, recoveryFailureCode, readInFixturePhase } from "./phase.mjs";
import { readCheckpoint } from "./checkpoint";

const key = "a".repeat(64),
  point = "12345678-12345678-12345678-" + "b".repeat(32);
const env: any = {
  HOSTED_BACKEND_KEY: key,
  HOSTED_FIXTURE_EXPIRES: String(Date.now() + 600000),
  NANOHUB_RECOVERY_HOLD: "1",
};
const request = (body: any) =>
  new Request("https://fixture.example/__fixture/recovery", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
class Base {
  constructor(...args: any[]) {}
}
const Wrapped = recoveryObject(Base);

test("privileged object RPC denies missing, wrong and expired authority before touching storage", async () => {
  for (const [overrides, input] of [
    [{}, "b".repeat(64)],
    [{ HOSTED_BACKEND_KEY: undefined }, key],
    [{ HOSTED_FIXTURE_EXPIRES: "NaN" }, key],
    [{ HOSTED_FIXTURE_EXPIRES: "0" }, key],
  ] as any) {
    let calls = 0;
    const state = {
      storage: new Proxy(
        {},
        {
          get() {
            calls++;
            throw Error("Storage touched");
          },
        },
      ),
    };
    const object = new Wrapped(state, { ...env, ...overrides });
    await assert.rejects(
      () => object.fixtureRecoveryRead(input),
      /access denied/,
    );
    await assert.rejects(
      () => object.fixtureRecoveryLose(input),
      /access denied/,
    );
    await assert.rejects(
      () => object.fixtureRecoverySchedule(input, point),
      /access denied/,
    );
    assert.throws(() => object.fixtureRecoveryRestart(input), /access denied/);
    assert.equal(calls, 0);
  }
});
test("invalid markers/bookmarks fail before writes and native restart errors are not swallowed inside the object", async () => {
  let calls = 0;
  const object = new Wrapped(
    {
      storage: new Proxy(
        {},
        {
          get() {
            calls++;
            throw Error("Storage touched");
          },
        },
      ),
      abort() {
        throw Error("provider abort");
      },
    },
    env,
  );
  for (const value of [undefined, null, "", "production", "a".repeat(65)]) {
    await assert.rejects(
      () => object.fixtureRecoveryWrite(key, value as any),
      /Invalid fixture marker/,
    );
    await assert.rejects(
      () => object.fixtureRecoverySchedule(key, value as any),
      /Invalid recovery bookmark/,
    );
  }
  assert.equal(calls, 0);
  assert.throws(() => object.fixtureRecoveryRestart(key), /provider abort/);
});
test("bookmark API synchronizes before capture and returns provider undo point unchanged", async () => {
  const calls: string[] = [];
  const object = new Wrapped(
    {
      id: { toString: () => "owned-id" },
      storage: {
        async sync() {
          calls.push("sync");
        },
        async getCurrentBookmark() {
          calls.push("checkpoint");
          return point;
        },
        async onNextSessionRestoreBookmark(value: string) {
          calls.push(value);
          return point;
        },
      },
    },
    env,
  );
  assert.deepEqual(await object.fixtureRecoveryCheckpoint(key), {
    id: "owned-id",
    bookmark: point,
  });
  assert.deepEqual(await object.fixtureRecoverySchedule(key, point), {
    undoBookmark: point,
  });
  assert.deepEqual(calls, ["sync", "checkpoint", point]);
});
test("recovery plan is a separate generated resource family, holds requests and rejects absent or weakened deployed holds", () => {
  const identity = {
    root: "/fixture/source",
    accountId: "a".repeat(32),
    runId: "mabcdefgh-0123456789",
    deadline: 1900000000000,
  };
  const normal = fixturePlan(identity),
    plan = fixturePlan({ ...identity, purpose: "storage-recovery" });
  assert.notEqual(normal.apiName, plan.apiName);
  assert.equal(normal.api.vars.NANOHUB_RECOVERY_HOLD, undefined);
  assert.equal(plan.api.vars.NANOHUB_RECOVERY_HOLD, "1");
  assert.match(plan.api.main, /hosted-recovery-fixture\/app.ts$/);
  const bindings = [
    { name: "OBJECTS", type: "r2_bucket", bucket_name: plan.bucket },
    { name: "AUTH_DB", type: "d1", id: plan.databaseId },
    ...classes.map(([name, class_name]) => ({
      name,
      class_name,
      type: "durable_object_namespace",
    })),
  ];
  const metadata = (values: any[]) => ({
    resources: {
      bindings: values,
      script_runtime: { limits: { subrequests: 50000 } },
    },
  });
  for (const hold of [undefined, "0", "false", ""])
    assert.throws(
      () =>
        assertFixtureBindings(
          metadata([
            ...bindings,
            ...(hold === undefined
              ? []
              : [
                  {
                    name: "NANOHUB_RECOVERY_HOLD",
                    type: "plain_text",
                    text: hold,
                  },
                ]),
          ]),
          plan,
          "api",
        ),
      /hold/,
    );
  assertFixtureBindings(
    metadata([
      ...bindings,
      { name: "NANOHUB_RECOVERY_HOLD", type: "plain_text", text: "1" },
    ]),
    plan,
    "api",
  );
  assert.throws(() => fixturePlan({ ...identity, purpose: "production" }));
});
test("malformed, oversized, foreign and invalid control targets fail before resource lookup", async () => {
  let calls = 0;
  const guarded = new Proxy(env, {
    get(target, key) {
      if (key in target) return target[key];
      calls++;
      throw Error("Resource lookup");
    },
  });
  for (const input of [
    "{",
    "null",
    "[]",
    JSON.stringify({ binding: "PRODUCTION", op: "lose", name: "hub" }),
    JSON.stringify({ binding: "HUB", op: "lose", name: "../bad" }),
    JSON.stringify({ binding: "AUTH_DB", op: "write", value: "SQL" }),
    JSON.stringify({ binding: "OBJECTS", op: "write", base64: "AB==" }),
  ])
    assert.equal((await control(request(input), guarded)).status, 400);
  assert.equal(
    (await control(request("x".repeat(1500001)), guarded)).status,
    413,
  );
  assert.equal(calls, 0);
});
test("R2 fixture cannot select an arbitrary key and verifies full binary bytes", async () => {
  let stored: Uint8Array | undefined;
  const keys: string[] = [];
  const bucket = {
    async put(key: string, bytes: Uint8Array) {
      keys.push(key);
      stored = bytes;
    },
    async get(key: string) {
      keys.push(key);
      return stored ? { body: stored } : null;
    },
    async delete(key: string) {
      keys.push(key);
      stored = undefined;
    },
  };
  const bytes = Buffer.alloc(1048576);
  bytes[0] = 255;
  bytes[512] = 17;
  const response = await control(
    request({
      binding: "OBJECTS",
      op: "write",
      key: "production/overwrite",
      base64: bytes.toString("base64"),
    }),
    { ...env, OBJECTS: bucket },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  assert.equal(
    (
      await control(
        request({
          binding: "OBJECTS",
          op: "lose",
          key: "production/overwrite",
        }),
        { ...env, OBJECTS: bucket },
      )
    ).status,
    404,
  );
  assert.deepEqual([...new Set(keys)], ["fixture-recovery/retained.bin"]);
});
test("retained corruption and truncation are rejected against expectations held outside the backup", () => {
  const bytes = Buffer.from([0, 255, 17]),
    expected = {
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  assert.equal(verifyRetainedBytes(bytes, expected), bytes);
  assert.throws(
    () => verifyRetainedBytes(bytes.subarray(1), expected),
    /byte count/,
  );
  assert.throws(
    () => verifyRetainedBytes(Buffer.from([1, 255, 17]), expected),
    /checksum/,
  );
});

test("repository fixture cannot route private application calls without its dedicated configuration and recovery hold", async () => {
  let calls = 0;
  const app = {
    fetch: async () => {
      calls++;
      return new Response("application");
    },
  };
  const input = () =>
    new Request(
      "https://fixture.example/__fixture/app/api/trunks/test/branches",
    );
  for (const overrides of [
    {},
    { HOSTED_REPO_RECOVERY: "0" },
    { HOSTED_REPO_RECOVERY: "1", NANOHUB_RECOVERY_HOLD: "0" },
    { HOSTED_REPO_RECOVERY: "1", HOSTED_FIXTURE_EXPIRES: "0" },
  ])
    assert.equal(
      (await repositoryRoute(input(), { ...env, ...overrides }, {} as any, app))
        ?.status,
      404,
    );
  assert.equal(calls, 0);
  assert.equal(
    await repositoryRoute(
      new Request("https://fixture.example/api/trunks/test/branches"),
      env,
      {} as any,
      app,
    ),
    null,
  );
});

test("repository recovery plan isolates its resource family and pins the active private phase", () => {
  const plan = fixturePlan({
    root: "/fixture/source",
    accountId: "a".repeat(32),
    runId: "mabcdefgh-0123456789",
    deadline: 1900000000000,
    purpose: "repository-recovery",
  });
  assert.match(plan.apiName, /^nh-repo-recovery-/);
  assert.equal(plan.api.vars.HOSTED_REPO_RECOVERY, "1");
  assert.equal(plan.api.vars.NANOHUB_RECOVERY_HOLD, "1");
  const bindings = [
    { name: "OBJECTS", type: "r2_bucket", bucket_name: plan.bucket },
    { name: "AUTH_DB", type: "d1", id: plan.databaseId },
    ...classes.map(([name, class_name]) => ({
      name,
      class_name,
      type: "durable_object_namespace",
    })),
    { name: "NANOHUB_RECOVERY_HOLD", text: "1" },
    { name: "HOSTED_REPO_RECOVERY", text: "1" },
    { name: "HOSTED_REPO_PHASE", text: "seed" },
  ];
  const metadata = (values: any[]) => ({
    resources: {
      bindings: values,
      script_runtime: { limits: { subrequests: 50000 } },
    },
  });
  assertFixtureBindings(metadata(bindings), plan, "api");
  assert.throws(
    () =>
      assertFixtureBindings(
        metadata(
          bindings.map((b) =>
            b.name === "HOSTED_REPO_PHASE" ? { ...b, text: "verify" } : b,
          ),
        ),
        plan,
        "api",
      ),
    /phase/,
  );
  assert.throws(
    () =>
      assertFixtureBindings(
        metadata(bindings.filter((b) => b.name !== "HOSTED_REPO_RECOVERY")),
        plan,
        "api",
      ),
    /phase/,
  );
});
test("frozen and unknown phases close the operator application path; verification still runs real auth with the normal hold retained outside it", async () => {
  let calls = 0;
  const app = {
    fetch: async (request: Request, local: any) => {
      calls++;
      assert.equal(new URL(request.url).pathname, "/api/trunks/test/branches");
      assert.equal(request.headers.get("authorization"), "Bearer synthetic");
      assert.equal(local.NANOHUB_RECOVERY_HOLD, "0");
      return new Response("application");
    },
  };
  const input = () =>
    new Request(
      "https://fixture.example/__fixture/app/api/trunks/test/branches",
      { headers: { authorization: "Bearer synthetic" } },
    );
  const full = { ...env, HOSTED_REPO_RECOVERY: "1" };
  for (const phase of [undefined, "frozen", "", "unknown"])
    assert.equal(
      (
        await repositoryRoute(
          input(),
          { ...full, HOSTED_REPO_PHASE: phase },
          {} as any,
          app,
        )
      )?.status,
      503,
    );
  assert.equal(calls, 0);
  assert.equal(
    (
      await repositoryRoute(
        input(),
        { ...full, HOSTED_REPO_PHASE: "verify" },
        {} as any,
        app,
      )
    )?.status,
    200,
  );
  assert.equal(full.NANOHUB_RECOVERY_HOLD, "1");
});
test("private repository transport rejects WebSockets, non-application paths and provider auth flows", async () => {
  const full = {
    ...env,
    HOSTED_REPO_RECOVERY: "1",
    HOSTED_REPO_PHASE: "verify",
  };
  const app = {
    fetch: async () => {
      throw Error("unexpected application dispatch");
    },
  };
  for (const path of [
    "/api/auth/signin/codegraff",
    "/api/github/repos",
    "/__fixture/session",
    "/api/trunks/example/live",
    "/nh/latest.json",
  ])
    assert.equal(
      (
        await repositoryRoute(
          new Request("https://fixture.example/__fixture/app" + path),
          full,
          {} as any,
          app,
        )
      )?.status,
      400,
    );
  assert.equal(
    (
      await repositoryRoute(
        new Request(
          "https://fixture.example/__fixture/app/api/trunks/example",
          { headers: { Upgrade: "websocket" } },
        ),
        full,
        {} as any,
        app,
      )
    )?.status,
    400,
  );
});
test("repository session bootstrap only accepts fixed synthetic roles and remains unavailable while frozen", async () => {
  const full = {
    ...env,
    HOSTED_REPO_RECOVERY: "1",
    HOSTED_REPO_PHASE: "verify",
  };
  const app = {
    fetch: async () => {
      throw Error("unexpected application dispatch");
    },
  };
  const input = (role: string) =>
    new Request("https://fixture.example/__fixture/repository-session", {
      method: "POST",
      body: JSON.stringify({ role }),
    });
  for (const role of ["admin", "production-owner", "__proto__"])
    assert.equal(
      (await repositoryRoute(input(role), full, {} as any, app))?.status,
      400,
    );
  assert.equal(
    (
      await repositoryRoute(
        input("owner"),
        { ...full, HOSTED_REPO_PHASE: "frozen" },
        {} as any,
        app,
      )
    )?.status,
    503,
  );
});
test("real object constructor registers its binding and opaque ID behind the input gate only in repository mode", async () => {
  const rows: any[] = [];
  let pending: Promise<any> | undefined;
  const WrappedRegistry = recoveryObject(Base, "HUB");
  const state = {
    id: { toString: () => "a".repeat(64) },
    blockConcurrencyWhile(fn: () => Promise<any>) {
      pending = fn();
    },
  };
  new WrappedRegistry(state, {
    ...env,
    HOSTED_REPO_RECOVERY: "1",
    OBJECTS: {
      async put(key: string, value: string) {
        rows.push([key, JSON.parse(value)]);
      },
    },
  });
  await pending;
  assert.deepEqual(rows, [
    [
      "__fixture/inventory/HUB/" + "a".repeat(64),
      { binding: "HUB", id: "a".repeat(64) },
    ],
  ]);
  new WrappedRegistry(state, env);
  assert.equal(rows.length, 1);
});

test("provider metadata parsing requires explicit table headers and never interprets permission errors as absence", () => {
  const row =
    "│ Name │ ID │ Scopes │\n│ test-entry │ " + "a".repeat(32) + " │ workers │";
  assert.deepEqual(metadataRows({ code: 0, stdout: row, stderr: "" }), [
    { Name: "test-entry", ID: "a".repeat(32), Scopes: "workers" },
  ]);
  assert.deepEqual(
    metadataRows(
      { code: 1, stdout: "", stderr: "List request returned no secrets." },
      true,
    ),
    [],
  );
  for (const result of [
    { code: 1, stdout: "", stderr: "Authentication failed [code:10000]" },
    { code: 0, stdout: "an unrelated id " + "a".repeat(32), stderr: "" },
    {
      code: 1,
      stdout: "List request returned no secrets.",
      stderr: "unauthorized",
    },
  ])
    assert.throws(() => metadataRows(result, true));
});
test("cleanup refuses provider entries not requested by this run or whose ID changed", () => {
  const plan = { providerSecretName: "nh-vault-recovery-owned-value" },
    rows = [{ Name: plan.providerSecretName, ID: "a".repeat(32) }];
  assert.throws(() => ownedSecret(rows, plan, {}), /unowned/);
  assert.throws(
    () =>
      ownedSecret(rows, plan, {
        providerSecretRequested: true,
        providerSecretId: "b".repeat(32),
      }),
    /identity changed/,
  );
  assert.equal(
    ownedSecret(rows, plan, {
      providerSecretRequested: true,
      providerSecretId: "a".repeat(32),
    }),
    rows[0],
  );
  assert.equal(
    ownedSecret([{ Name: "other-user-entry", ID: "b".repeat(32) }], plan, {
      providerSecretRequested: true,
    }),
    undefined,
  );
});
test("vault recovery plan permits only its generated service, bucket and synthetic provider reference", () => {
  const plan = fixturePlan({
    root: "/fixture/source",
    accountId: "a".repeat(32),
    runId: "mabcdefgh-0123456789",
    deadline: 1900000000000,
    purpose: "vault-recovery",
    storeId: "b".repeat(32),
  });
  assert.equal(plan.api.services[0].service, plan.vaultName);
  assert.equal(plan.vault.workers_dev, false);
  assert.equal(plan.vault.preview_urls, false);
  assert.deepEqual(plan.vaultRetired.migrations[1].deleted_classes, ["Vault"]);
  const bindings = [
    { name: "OBJECTS", type: "r2_bucket", bucket_name: plan.bucket },
    { name: "VAULTS", class_name: "Vault", type: "durable_object_namespace" },
    {
      name: "FIXTURE_SECRET",
      type: "secrets_store_secret",
      store_id: plan.storeId,
      secret_name: plan.providerSecretName,
    },
    { name: "HOSTED_FIXTURE_EXPIRES", text: String(plan.deadline) },
    { name: "HOSTED_REPO_RECOVERY", text: "1" },
    { name: "HOSTED_BACKEND_KEY", type: "secret_text" },
    {
      name: "CLOUDFLARE_SECRET_SCOPES",
      text: plan.vault.vars.CLOUDFLARE_SECRET_SCOPES,
    },
  ];
  const metadata = (values: any[]) => ({
    resources: {
      bindings: values,
      script_runtime: { limits: { subrequests: 50000 } },
    },
  });
  assertVaultBindings(metadata(bindings), plan);
  for (const field of ["store_id", "secret_name"])
    assert.throws(() =>
      assertVaultBindings(
        metadata(
          bindings.map((b) =>
            b.name === "FIXTURE_SECRET" ? { ...b, [field]: "foreign" } : b,
          ),
        ),
        plan,
      ),
    );
  assert.throws(() =>
    assertVaultBindings(
      metadata([
        ...bindings,
        { name: "PRODUCTION", type: "service", service: "nanohub-vault" },
      ]),
      plan,
    ),
  );
});
test("suspending a cleanup alarm requires authority and returns its prior schedule without touching SQL", async () => {
  let alarm: number | null = 123;
  const object = new Wrapped(
    {
      storage: {
        async getAlarm() {
          return alarm;
        },
        async deleteAlarm() {
          alarm = null;
        },
      },
    },
    env,
  );
  await assert.rejects(
    () => object.fixtureRecoverySuspendAlarm("wrong"),
    /denied/,
  );
  assert.equal(alarm, 123);
  assert.deepEqual(await object.fixtureRecoverySuspendAlarm(key), {
    previousAlarm: 123,
  });
  assert.equal(alarm, null);
});

test("R2 rollback identifies newer packs only after every live object has a retained return copy", async () => {
  const original = Buffer.from("old pack"),
    newer = Buffer.from("new pack");
  const file = (key: string, bytes: Buffer) => ({
    key,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  const old = file("old.pack", original),
    added = file("new.pack", newer),
    data: any = { "old.pack": original, "new.pack": newer };
  assert.deepEqual(
    await verifiedR2Reconcile(
      [
        { key: old.key, size: old.bytes },
        { key: added.key, size: added.bytes },
      ],
      [old],
      [old, added],
      async (key: string) => data[key],
    ),
    ["new.pack"],
  );
  assert.deepEqual(
    await verifiedR2Reconcile(
      [{ key: old.key, size: old.bytes }],
      [old, added],
      [old, added],
      async (key: string) => data[key],
    ),
    [],
  );
});
test("R2 rollback rejects an unretained extra before the caller can delete any previously verified pack", async () => {
  const bytes = Buffer.from("known"),
    known = {
      key: "known.pack",
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  let deleted = 0;
  await assert.rejects(async () => {
    const keys = await verifiedR2Reconcile(
      [
        { key: "known.pack", size: bytes.length },
        { key: "unknown.pack", size: 1 },
      ],
      [],
      [known],
      async () => bytes,
    );
    deleted += keys.length;
  }, /no retained return copy/);
  assert.equal(deleted, 0);
});
test("R2 restore refuses to overwrite a desired key with live bytes not retained in any checkpoint", async () => {
  const bytes = Buffer.from("known"),
    known = {
      key: "same.pack",
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  await assert.rejects(
    () =>
      verifiedR2Reconcile(
        [{ key: "same.pack", size: 5 }],
        [known],
        [known],
        async () => Buffer.from("newer"),
      ),
    /no verified retained return copy/,
  );
});

test("private phase observations expose only held configuration/version without touching application state", async () => {
  const version = "11111111-1111-1111-1111-111111111111";
  let appCalls = 0;
  const app = { fetch: async () => { appCalls++; throw Error("Unexpected application access"); } };
  const input = () => new Request("https://fixture.example/__fixture/repository", {
    method: "POST", body: JSON.stringify({ op: "phase" }),
  });
  const full = { ...env, HOSTED_REPO_RECOVERY: "1", HOSTED_REPO_PHASE: "frozen",
    CF_VERSION_METADATA: { id: version },
    AUTH_DB: new Proxy({}, { get() { throw Error("Unexpected database access"); } }),
  };
  assert.deepEqual(await (await repositoryRoute(input(), full, {} as any, app))?.json(), {
    phase: "frozen", version, normalTrafficHeld: true,
  });
  for (const overrides of [{ NANOHUB_RECOVERY_HOLD: "0" }, { HOSTED_FIXTURE_EXPIRES: "0" }])
    assert.equal((await repositoryRoute(input(), { ...full, ...overrides }, {} as any, app))?.status, 404);
  assert.equal(appCalls, 0);
});

test("phase barrier waits for both data-plane phase and exact deployed version using read-only bounded observations", async () => {
  const version = "11111111-1111-1111-1111-111111111111", old = "22222222-2222-2222-2222-222222222222";
  const states = [{ phase: "frozen", version: old }, { phase: "verify", version: old },
    { phase: "frozen", version }, { phase: "verify", version }];
  const budgets: number[] = []; let time = 0;
  const observed = await waitForFixturePhase(async (budget: number) => {
    budgets.push(budget); return { ...states.shift(), normalTrafficHeld: true };
  }, { phase: "verify", version }, { now: () => time, sleep: async (ms: number) => { time += ms; } });
  assert.deepEqual(observed, { attempts: 4, phase: "verify", version });
  assert.ok(budgets.every((b, i) => b > 0 && b <= 90000 && (!i || b < budgets[i - 1])));
});

test("phase barrier refuses missing holds, malformed metadata, failed reads and deadline expiry without retrying application work", async () => {
  const version = "11111111-1111-1111-1111-111111111111", expected = { phase: "verify", version };
  for (const state of [{ phase: "verify", version, normalTrafficHeld: false },
    { phase: "unknown", version, normalTrafficHeld: true }, { phase: "verify", version: null, normalTrafficHeld: true }]) {
    let reads = 0;
    await assert.rejects(() => waitForFixturePhase(async () => { reads++; return state; }, expected), /Invalid fixture phase/);
    assert.equal(reads, 1);
  }
  let reads = 0;
  await assert.rejects(() => waitForFixturePhase(async () => { reads++; throw Error("Read transport failed"); }, expected), /Read transport failed/);
  assert.equal(reads, 1);
  let time = 0;
  await assert.rejects(() => waitForFixturePhase(async () => ({ phase: "frozen", version, normalTrafficHeld: true }), expected,
    { timeoutMs: 1500, now: () => time, sleep: async (ms: number) => { time += ms; } }), /did not reach/);
  time = 0;
  await assert.rejects(() => waitForFixturePhase(async () => { time = 2000; return { ...expected, normalTrafficHeld: true }; }, expected,
    { timeoutMs: 1500, now: () => time }), /exceeded its deadline/);
  for (const input of [{ ...expected, phase: "unknown" }, { ...expected, version: "not-a-version" }])
    await assert.rejects(() => waitForFixturePhase(async () => { throw Error("Unexpected request"); }, input), /Invalid expected/);
});

test("recovery error diagnostics retain only known fence codes and discard confidential, malformed or oversized response bodies", async () => {
  const confidential = "synthetic confidential application data";
  for (const code of ["fixture_frozen", "recovery_hold"])
    assert.equal(await recoveryFailureCode(Response.json({ code, error: confidential }, { status: 503 })), code);
  for (const response of [Response.json({ code: confidential, error: confidential }),
    Response.json(null), new Response(confidential), new Response("x".repeat(4097)),
    Response.json({ code: "fixture_frozen", padding: "x".repeat(4096) })])
    assert.equal(await recoveryFailureCode(response), null);
});

test("checkpoint reads recreate broken stubs and back off only for explicit retryable provider errors", async () => {
  let stubs = 0; const delays: number[] = [];
  const observed = await readCheckpoint(() => {
    const instance = ++stubs;
    return { fixtureRecoveryCheckpoint: async (provided: string) => {
      assert.equal(provided, key);
      if (instance < 3) throw Object.assign(Error("platform connection reset"), { retryable: true });
      return { id: "owned", bookmark: point };
    } };
  }, key, async ms => { delays.push(ms); });
  assert.deepEqual(observed, { id: "owned", bookmark: point, readAttempts: 3 });
  assert.equal(stubs, 3);
  assert.deepEqual(delays, [1000, 2000]);
});

test("checkpoint overload, authorization, unknown and malformed retry flags stop on the first attempt", async () => {
  for (const error of [Error("Fixture recovery access denied"), Error("unknown"),
    Object.assign(Error("overloaded"), { retryable: true, overloaded: true }),
    Object.assign(Error("malformed retry flag"), { retryable: "true" }),
    Object.assign(Error("malformed overload flag"), { retryable: true, overloaded: "false" })]) {
    let stubs = 0;
    await assert.rejects(() => readCheckpoint(() => {
      stubs++; return { fixtureRecoveryCheckpoint: async () => { throw error; } };
    }, key, async () => { throw Error("Unexpected retry"); }), value => value === error);
    assert.equal(stubs, 1);
  }
});

test("checkpoint retry exhaustion preserves the original failure and cannot invoke mutating RPC methods", async () => {
  const error = Object.assign(Error("platform remains unavailable"), { retryable: true });
  let stubs = 0, reads = 0;
  await assert.rejects(() => readCheckpoint(() => {
    stubs++;
    return new Proxy({ fixtureRecoveryCheckpoint: async () => { reads++; throw error; } }, {
      get(target, name) { assert.equal(name, "fixtureRecoveryCheckpoint"); return target.fixtureRecoveryCheckpoint; },
    });
  }, key, async () => {}), value => value === error);
  assert.equal(stubs, 3); assert.equal(reads, 3);
});

test("control endpoint retries checkpoint reads through fresh stubs but never replays a failed loss operation", async () => {
  let stubs = 0, losses = 0;
  const reset = Object.assign(Error("platform reset"), { retryable: true });
  const local: any = { ...env, SEQUENCER: {
    idFromName: (name: string) => name,
    get: () => {
      const instance = ++stubs;
      return {
        fixtureRecoveryCheckpoint: async () => {
          if (instance === 1) throw reset;
          return { id: "owned", bookmark: point };
        },
        fixtureRecoveryLose: async () => { losses++; throw reset; },
      };
    },
  } };
  assert.deepEqual(await (await control(request({ binding: "SEQUENCER", name: "test", op: "checkpoint" }), local)).json(), {
    id: "owned", bookmark: point, readAttempts: 2,
  });
  assert.equal(stubs, 2);
  await assert.rejects(() => control(request({ binding: "SEQUENCER", name: "test", op: "lose" }), local), value => value === reset);
  assert.equal(stubs, 3); assert.equal(losses, 1);
});

const readVersion = "11111111-1111-4111-8111-111111111111";
const readExpectation = { method: "GET", phase: "verify", version: readVersion };
const currentPhase = () => ({ phase: "verify", version: readVersion, normalTrafficHeld: true });
test("a real frozen private Git read is retried only after held phase/version observation and a saved proof", async () => {
  let clock = 0, calls = 0, observations = 0;
  const local: any = { ...env, HOSTED_REPO_RECOVERY: "1", HOSTED_REPO_PHASE: "frozen" };
  const proofs: any[] = [];
  const result = await readInFixturePhase(async () => {
    return (await repositoryRoute(new Request("https://fixture.example/__fixture/app/git/owner/repo.git/HEAD"), local, {} as any,
      { fetch: async () => { calls++; assert.equal(proofs.length, 1); return new Response("missing Git", { status: 404 }); } }))!;
  }, { ...readExpectation, status: 404 }, {
    now: () => clock, sleep: async ms => { clock += ms; },
    readPhase: async () => { observations++; local.HOSTED_REPO_PHASE = "verify"; return currentPhase(); },
    recordRetry: async proof => { proofs.push(proof); },
  });
  assert.equal(result.attempts, 2); assert.equal(calls, 1); assert.equal(observations, 1);
  assert.equal(proofs[0].refusal, "fixture_frozen");
  assert.equal(await result.response.text(), "missing Git");
});
test("phase-read helper rejects writes before dispatch and never retries a transport exception", async () => {
  let calls = 0;
  const options = { readPhase: async () => currentPhase(), recordRetry: async () => {}, sleep: async () => {} };
  for (const method of ["POST", "PUT", "PATCH", "DELETE"])
    await assert.rejects(() => readInFixturePhase(async () => { calls++; return new Response(); }, { ...readExpectation, method }, options), /Invalid fixture read/);
  assert.equal(calls, 0);
  const failure = Error("connection reset after unknown outcome");
  await assert.rejects(() => readInFixturePhase(async () => { calls++; throw failure; }, readExpectation, options), error => error === failure);
  assert.equal(calls, 1);
});
test("only a recognized 503 fence retries; auth, other errors, malformed and oversized bodies stop", async () => {
  for (const response of [Response.json({ code: "fixture_frozen" }, { status: 403 }),
    Response.json({ error: "private application error" }, { status: 503 }),
    new Response("not JSON", { status: 503 }), new Response("x".repeat(4097), { status: 503 }),
    new Response(null, { status: 503 }), new Response(null, { status: 401 })]) {
    let calls = 0, observations = 0;
    await readInFixturePhase(async () => { calls++; return response; }, readExpectation, {
      readPhase: async () => { observations++; return currentPhase(); },
      recordRetry: async () => { throw Error("Unexpected retry"); },
    });
    assert.equal(calls, 1); assert.equal(observations, 0);
  }
});
test("expected closed reads and rate-limit responses retain their bodies without phase retries", async () => {
  for (const [response, expected] of [[Response.json({ code: "fixture_frozen" }, { status: 503 }), { ...readExpectation, phase: "frozen", status: 503 }],
    [Response.json({ rate: true }, { status: 429 }), readExpectation]] as any) {
    const result = await readInFixturePhase(async () => response, expected, {
      readPhase: async () => { throw Error("No phase observation expected"); }, recordRetry: async () => { throw Error("No retry expected"); },
    });
    assert.deepEqual(await result.response.json(), response.status === 503 ? { code: "fixture_frozen" } : { rate: true });
  }
});
test("phase-read observation and receipt failures stop before a second application read", async () => {
  for (const failurePoint of ["hold", "observation", "receipt"]) {
    let calls = 0;
    await assert.rejects(() => readInFixturePhase(async () => { calls++; return Response.json({ code: "fixture_frozen" }, { status: 503 }); }, readExpectation, {
      readPhase: async () => {
        if (failurePoint === "observation") throw Error("observation failed");
        return { ...currentPhase(), normalTrafficHeld: failurePoint !== "hold" };
      }, recordRetry: async () => { throw Error("receipt failed"); },
    }));
    assert.equal(calls, 1);
  }
});
test("phase-read retries have a three-read limit and reject an observation past its deadline", async () => {
  let clock = 0, calls = 0, proofs = 0;
  const result = await readInFixturePhase(async () => { calls++; return Response.json({ code: "fixture_frozen" }, { status: 503 }); }, readExpectation, {
    readPhase: async () => currentPhase(), recordRetry: async () => { proofs++; }, now: () => clock, sleep: async ms => { clock += ms; },
  });
  assert.equal(calls, 3); assert.equal(proofs, 2); assert.equal(result.failureCode, "fixture_frozen");
  await assert.rejects(() => readInFixturePhase(async () => { clock += 2; return new Response("too late"); }, readExpectation, {
    timeoutMs: 1, now: () => clock, readPhase: async () => currentPhase(), recordRetry: async () => { throw Error("Unexpected proof"); },
  }), /deadline/);
});
