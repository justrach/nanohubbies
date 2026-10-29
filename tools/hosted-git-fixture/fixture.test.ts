import test from "node:test";
import assert from "node:assert/strict";
import gate from "./gate";
import { hostedApp } from "./backend";
import { currentUser, settings } from "../../packages/api/src/auth";
import {
  fixturePlan,
  purgeConfiguration,
  assertFixtureBindings,
  classes,
} from "./config.mjs";
import { cleanupFixture } from "./cleanup.mjs";
import { readMeasurement } from "./measurement";
import { purgeFixturePage } from "./purge.mjs";

test("fixture read telemetry reports numbers only and preserves binding method receivers", async () => {
  const observations: number[][] = [],
    bucket: any = {
      value: 42,
      async get() {
        assert.equal(this, bucket);
        return { body: "fixture" };
      },
      async list() {
        assert.equal(this, bucket);
        return this.value;
      },
    };
  const measured = readMeasurement(bucket, (...values) =>
    observations.push(values),
  );
  assert.deepEqual(await measured.bucket.get("private/object-name"), {
    body: "fixture",
  });
  assert.equal(await measured.bucket.list(), 42);
  measured.finish();
  assert.equal(observations[0][0], 1);
  assert.equal(observations[0][3], 1);
  assert.ok(observations.flat().every(Number.isFinite));
});

const key = "a".repeat(64),
  backend = "b".repeat(64),
  secret = "c".repeat(64);
const env: any = {
  HOSTED_FIXTURE_KEY: key,
  HOSTED_BACKEND_KEY: backend,
  SESSION_SECRET: secret,
  HOSTED_FIXTURE_EXPIRES: String(Date.now() + 60000),
};
const request = (path: string, authorized = true, method = "GET") =>
  new Request("https://fixture.example" + path, {
    method,
    headers: authorized ? { "x-nanohub-hosted-fixture": key } : undefined,
  });

test("private gate refuses missing, incorrect, expired and malformed authority before dispatch", async () => {
  let calls = 0;
  const target = {
    fetch: async () => {
      calls++;
      return new Response("delegated");
    },
  };
  for (const [input, overrides] of [
    [request("/api", false), {}],
    [request("/api"), { HOSTED_FIXTURE_KEY: "wrong" }],
    [request("/api"), { HOSTED_FIXTURE_EXPIRES: "NaN" }],
    [request("/api"), { HOSTED_FIXTURE_EXPIRES: "0" }],
    [request("/api"), { HOSTED_BACKEND_KEY: "" }],
  ] as any) {
    const response = await gate.fetch(input, {
      ...env,
      TARGET: target,
      ...overrides,
    });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  assert.equal(calls, 0);
});
test("gate preserves ordinary Git auth/body but removes the front control key", async () => {
  const input = new Request(
    "https://fixture.example/git/owner/repo.git/git-receive-pack",
    {
      method: "POST",
      body: "pack bytes",
      headers: {
        "x-nanohub-hosted-fixture": key,
        Authorization: "Basic synthetic",
      },
    },
  );
  let seen: any;
  const response = await gate.fetch(input, {
    ...env,
    TARGET: {
      fetch: async (value: Request) => {
        seen = { headers: value.headers, body: await value.text() };
        return new Response("accepted");
      },
    },
  } as any);
  assert.equal(await response.text(), "accepted");
  assert.equal(seen.headers.get("authorization"), "Basic synthetic");
  assert.equal(seen.headers.get("x-nanohub-hosted-fixture"), null);
  assert.equal(seen.headers.get("x-nanohub-hosted-backend"), backend);
  assert.equal(seen.body, "pack bytes");
});
test("purge requires closed API and control authority, works after expiry, returns no keys", async () => {
  let listed = 0,
    deleted: any;
  const OBJECTS = {
    list: async (options: any) => {
      assert.equal(options.limit, 1000);
      listed++;
      return { objects: [{ key: "private/path" }], truncated: true };
    },
    delete: async (keys: any) => {
      deleted = keys;
    },
  };
  assert.equal(
    (
      await gate.fetch(request("/__fixture/purge", false, "POST"), {
        ...env,
        OBJECTS,
        HOSTED_PURGE_ONLY: "1",
      } as any)
    ).status,
    404,
  );
  assert.equal(
    (
      await gate.fetch(request("/__fixture/purge", true, "POST"), {
        ...env,
        OBJECTS,
      } as any)
    ).status,
    409,
  );
  assert.equal(listed, 0);
  const closed = {
    ...env,
    OBJECTS,
    HOSTED_FIXTURE_EXPIRES: "0",
    HOSTED_PURGE_ONLY: "1",
  };
  assert.equal((await gate.fetch(request("/api"), closed as any)).status, 404);
  assert.deepEqual(
    await (
      await gate.fetch(request("/__fixture/purge", true, "POST"), closed as any)
    ).json(),
    { deleted: 1, more: true },
  );
  assert.deepEqual(deleted, ["private/path"]);
});
test("purge status is authenticated, read-only and available after expiry; a service binding blocks deletion", async () => {
  let lists = 0;
  const OBJECTS = { list: async () => { lists++; return { objects: [], truncated: false }; } };
  const local: any = { ...env, HOSTED_FIXTURE_EXPIRES: "0", OBJECTS, HOSTED_PURGE_ONLY: "1", TARGET: {} };
  assert.equal((await gate.fetch(request("/__fixture/purge-status", false), local)).status, 404);
  assert.deepEqual(await (await gate.fetch(request("/__fixture/purge-status"), local)).json(), {
    purgeOnly: true, bucketConfigured: true, targetConfigured: true,
  });
  const refused = await gate.fetch(request("/__fixture/purge", true, "POST"), local);
  assert.equal(refused.status, 409); assert.equal((await refused.json()).code, "fixture_purge_not_ready");
  const missing = await gate.fetch(request("/__fixture/purge", true, "POST"), { ...local, TARGET: undefined, OBJECTS: undefined });
  assert.equal((await missing.json()).code, "fixture_bucket_unbound"); assert.equal(lists, 0);
});
test("purge waits for the real gate and retries only a proven pre-deletion refusal", async () => {
  let clock = 0, posts = 0, deletes = 0;
  const proofs: any[] = [];
  const OBJECTS = { list: async () => ({ objects: [{ key: "owned" }], truncated: false }), delete: async () => { deletes++; } };
  const closed: any = { ...env, HOSTED_PURGE_ONLY: "1", OBJECTS };
  let ready = false;
  const result = await purgeFixturePage({
    now: () => clock, sleep: async ms => { clock += ms; ready = true; },
    readStatus: async () => gate.fetch(request("/__fixture/purge-status"), ready ? closed : { ...closed, HOSTED_PURGE_ONLY: "0", TARGET: {} }),
    purge: async () => {
      posts++; assert.equal(proofs.at(-1).state, "closed-gate-observed");
      return gate.fetch(request("/__fixture/purge", true, "POST"), posts === 1 ? { ...closed, HOSTED_PURGE_ONLY: "0" } : closed);
    }, recordObservation: async proof => { proofs.push(proof); },
  });
  assert.deepEqual(result, { deleted: 1, more: false }); assert.equal(posts, 2); assert.equal(deletes, 1);
  assert.ok(proofs.some(proof => proof.state === "waiting-for-closed-gate"));
  assert.equal(proofs.filter(proof => proof.state === "refused-before-deletion").length, 1);
});
const purgeJson = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
const readyPurge = () => purgeJson({ purgeOnly: true, bucketConfigured: true, targetConfigured: false });
test("lost purge acknowledgement after deletion is never replayed", async () => {
  let posts = 0, deletions = 0;
  const lost = Error("reply lost after deletion");
  await assert.rejects(() => purgeFixturePage({ readStatus: async () => readyPurge(), recordObservation: async () => {},
    purge: async () => { posts++; deletions++; throw lost; },
  }), error => error === lost);
  assert.equal(posts, 1); assert.equal(deletions, 1);
});
test("unbound buckets, denied status reads and failed receipts prevent purge writes", async () => {
  for (const response of [purgeJson({ purgeOnly: true, bucketConfigured: false, targetConfigured: false }),
    purgeJson({}, 401), purgeJson({}, 403), purgeJson({}, 404), purgeJson({ purgeOnly: "yes" })]) {
    let posts = 0;
    await assert.rejects(() => purgeFixturePage({ readStatus: async () => response, purge: async () => { posts++; return purgeJson({ deleted: 0, more: false }); }, recordObservation: async () => {} }));
    assert.equal(posts, 0);
  }
  let posts = 0;
  await assert.rejects(() => purgeFixturePage({ readStatus: async () => readyPurge(), purge: async () => { posts++; return purgeJson({ deleted: 0, more: false }); }, recordObservation: async () => { throw Error("receipt unavailable"); } }), /receipt unavailable/);
  assert.equal(posts, 0);
});
test("unknown purge failures and invalid acknowledgements stop after one write", async () => {
  for (const response of [purgeJson({ code: "fixture_bucket_unbound" }, 409), purgeJson({ code: "fixture_purge_not_ready" }, 503),
    purgeJson({ deleted: 1001, more: false }), new Response("x".repeat(4097), { headers: { "Cache-Control": "private, no-store" } }),
    Response.json({ deleted: 0, more: false }), new Response("private-fixture-body", { headers: { "Cache-Control": "private, no-store" } })]) {
    let posts = 0;
    await assert.rejects(() => purgeFixturePage({ readStatus: async () => readyPurge(), purge: async () => { posts++; return response; }, recordObservation: async () => {} }), error => !error.message.includes("private-fixture-body"));
    assert.equal(posts, 1);
  }
});
test("purge readiness and explicit refusal retries are bounded", async () => {
  let clock = 0, posts = 0;
  await assert.rejects(() => purgeFixturePage({ timeoutMs: 2000, now: () => clock, sleep: async ms => { clock += ms; },
    readStatus: async () => purgeJson({ purgeOnly: false, bucketConfigured: false, targetConfigured: true }),
    purge: async () => { posts++; return purgeJson({ deleted: 0, more: false }); }, recordObservation: async () => {},
  }), /deadline/); assert.equal(posts, 0);
  await assert.rejects(() => purgeFixturePage({ now: () => clock, sleep: async ms => { clock += ms; }, readStatus: async () => readyPurge(),
    purge: async () => { posts++; return purgeJson({ code: "fixture_purge_not_ready" }, 409); }, recordObservation: async () => {},
  }), /not acknowledged/); assert.equal(posts, 3);
});
test("backend independently fences direct access and strips both controls before the actual app", async () => {
  let calls = 0;
  const app = hostedApp({
    fetch: async (input) => {
      calls++;
      assert.equal(input.headers.get("x-nanohub-hosted-backend"), null);
      assert.equal(input.headers.get("x-nanohub-hosted-fixture"), null);
      return new Response(await input.text());
    },
  });
  assert.equal((await app.fetch(request("/api"), env, {} as any)).status, 404);
  const input = new Request("https://fixture.example/api", {
    method: "POST",
    body: "body",
    headers: {
      "x-nanohub-hosted-backend": backend,
      "x-nanohub-hosted-fixture": key,
    },
  });
  assert.equal(
    (
      await app.fetch(
        input.clone(),
        { ...env, HOSTED_FIXTURE_EXPIRES: "0" },
        {} as any,
      )
    ).status,
    404,
  );
  assert.equal(calls, 0);
  assert.equal(await (await app.fetch(input, env, {} as any)).text(), "body");
  assert.equal(calls, 1);
});
test("bootstrap creates only a fixed synthetic user and a real verifiable private session", async () => {
  const app = hostedApp({
    fetch: async () => {
      throw Error("unexpected delegation");
    },
  });
  const input = new Request("https://fixture.example/__fixture/session", {
    method: "POST",
    body: JSON.stringify({ id: "arbitrary-admin" }),
    headers: { "x-nanohub-hosted-backend": backend },
  });
  const response = await app.fetch(input, env, {} as any),
    cookie = response.headers.get("set-cookie")!;
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const user = await currentUser(
    new Request(input.url, { headers: { cookie: cookie.split(";")[0] } }),
    settings(env, new URL(input.url)),
  );
  assert.equal(user?.id, "dev:hosted-git-fixture");
  assert.equal(
    await currentUser(
      new Request(input.url, { headers: { cookie: cookie.split(";")[0] } }),
      settings({ ...env, SESSION_SECRET: "different" }, new URL(input.url)),
    ),
    null,
  );
  const unconfigured = new Request(input.url, {
    method: "POST",
    headers: { "x-nanohub-hosted-backend": backend },
  });
  assert.equal(
    (
      await app.fetch(
        unconfigured,
        { ...env, SESSION_SECRET: undefined },
        {} as any,
      )
    ).status,
    503,
  );
});

const identity = {
  root: "/fixture/source",
  accountId: "a".repeat(32),
  runId: "mabcdefgh-0123456789",
  deadline: 1900000000000,
  databaseId: "12345678-1234-1234-1234-123456789abc",
};
test("generated configuration cannot reuse arbitrary resource names and retirement drops bindings/exports", () => {
  const p = fixturePlan(identity);
  assert.match(p.apiName, /^nh-git-live-/);
  assert.equal(p.api.workers_dev, false);
  assert.equal(p.api.limits.subrequests, 50000);
  assert.equal(purgeConfiguration(p).services, undefined);
  assert.equal(purgeConfiguration(p).vars.HOSTED_PURGE_ONLY, "1");
  assert.deepEqual(
    p.retired.migrations[1].deleted_classes,
    classes.map(([, name]) => name),
  );
  assert.deepEqual(p.retired.durable_objects.bindings, []);
  assert.equal(p.retired.r2_buckets, undefined);
  assert.equal(p.retired.d1_databases, undefined);
  for (const bad of [
    { runId: "production" },
    { databaseId: "-".repeat(36) },
    { accountId: "wrong" },
    { deadline: NaN },
  ])
    assert.throws(() => fixturePlan({ ...identity, ...bad }));
});
test("a cleanup fence detaches an already deleted bucket while retaining the same owned gate and closed routing", async () => {
  const plan = fixturePlan(identity),
    closed = purgeConfiguration(plan, { bucketPresent: false });
  assert.equal(closed.name, plan.gateName);
  assert.equal(closed.services, undefined);
  assert.equal(closed.r2_buckets, undefined);
  assert.equal(closed.vars.HOSTED_PURGE_ONLY, "1");
  assert.equal(purgeConfiguration(plan).r2_buckets[0].bucket_name, plan.bucket);
  assert.throws(
    () => purgeConfiguration(plan, { bucketPresent: "false" as any }),
    /observation/,
  );
  const response = await gate.fetch(request("/__fixture/purge", true, "POST"), {
    ...env,
    HOSTED_PURGE_ONLY: "1",
  } as any);
  assert.equal(response.status, 409);
  assert.equal(((await response.json()) as any).deleted, undefined);
});
test("hosted metadata rejects foreign buckets, databases, classes, service bindings and unexpected secrets", () => {
  const p = fixturePlan(identity),
    bindings = [
      { name: "OBJECTS", type: "r2_bucket", bucket_name: p.bucket },
      { name: "AUTH_DB", type: "d1", id: p.databaseId },
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
  assertFixtureBindings(metadata(bindings), p, "api");
  for (const values of [
    [...bindings, { name: "VAULT", type: "service", service: "production" }],
    [...bindings, { name: "PROD_KEY", type: "secret_text" }],
    bindings.map((b) =>
      b.name === "OBJECTS" ? { ...b, bucket_name: "production" } : b,
    ),
    bindings.map((b) =>
      b.name === "AUTH_DB" ? { ...b, id: "production" } : b,
    ),
    bindings.map((b) =>
      b.name === "HUB" ? { ...b, script_name: "production" } : b,
    ),
  ])
    assert.throws(() => assertFixtureBindings(metadata(values), p, "api"));
  assertFixtureBindings(
    metadata([
      { name: "OBJECTS", type: "r2_bucket", bucket_name: p.bucket },
      { name: "TARGET", type: "service", service: p.apiName },
    ]),
    p,
    "gate",
  );
});

function lifecycle(
  initial: Record<string, boolean> = {
    api: true,
    gate: true,
    bucket: true,
    database: true,
  },
  fail = "",
) {
  const state = { ...initial },
    events: string[] = [],
    record: any = {
      apiVersion: initial.api ? "version" : undefined,
      cleanupNeeded: true,
    };
  const action = async (name: string, change = () => {}) => {
    events.push(name);
    if (fail === name) throw Error("injected failure");
    change();
  };
  const ops = {
    persist: async () => {},
    exists: async (kind: string) => {
      await action("observe:" + kind);
      return state[kind] ?? false;
    },
    closeGate: () =>
      action("fence", () => {
        state.gate = true;
      }),
    retire: () => action("retire"),
    purge: () => action("purge"),
    delete: (kind: string) =>
      action("delete:" + kind, () => {
        state[kind] = false;
      }),
    removeKeys: () => action("remove-keys"),
  };
  return { state, events, record, ops };
}
test("cleanup fences, retires namespaces, deletes app, purges then confirms data deletion before removing keys", async () => {
  const f = lifecycle();
  await cleanupFixture(f.record, f.ops);
  assert.equal(f.record.cleanupNeeded, false);
  assert.deepEqual(f.state, {
    api: false,
    gate: false,
    bucket: false,
    database: false,
  });
  assert.deepEqual(
    f.events.filter((e) => !e.startsWith("observe:")),
    [
      "fence",
      "retire",
      "delete:api",
      "purge",
      "delete:bucket",
      "delete:database",
      "delete:gate",
      "remove-keys",
    ],
  );
});
for (const failure of [
  "observe:api",
  "fence",
  "retire",
  "delete:api",
  "purge",
  "delete:bucket",
  "delete:database",
  "delete:gate",
])
  test("cleanup retains recovery keys and stops on " + failure, async () => {
    const f = lifecycle(undefined, failure);
    await cleanupFixture(f.record, f.ops);
    assert.equal(f.record.cleanupNeeded, true);
    assert.ok(!f.events.includes("remove-keys"));
    if (["fence", "retire"].includes(failure))
      assert.ok(!f.events.includes("delete:api"));
    if (failure === "purge") assert.ok(!f.events.includes("delete:bucket"));
    // The same receipt resumes from authoritative state after a transient failure.
    const resumed = lifecycle(f.state);
    Object.assign(resumed.record, f.record);
    await cleanupFixture(resumed.record, resumed.ops);
    assert.equal(resumed.record.cleanupNeeded, false);
  });
test("unknown create outcome cleans up observed resources even without requested flags", async () => {
  const f = lifecycle({
    api: false,
    gate: false,
    bucket: true,
    database: true,
  });
  await cleanupFixture(f.record, f.ops);
  assert.equal(f.record.cleanupNeeded, false);
  assert.ok(f.events.includes("fence"));
  assert.ok(f.events.includes("purge"));
  assert.ok(!f.events.includes("retire"));
});
test("missing deployed Worker without namespace retirement proof cannot be declared cleaned", async () => {
  const f = lifecycle({ api: false, gate: true, bucket: true, database: true });
  f.record.apiVersion = "previously-deployed";
  await cleanupFixture(f.record, f.ops);
  assert.equal(f.record.cleanupNeeded, true);
  assert.ok(!f.events.includes("purge"));
  assert.ok(!f.events.includes("remove-keys"));
});

test("optional vault cleanup runs after the application stops and before any shared bucket purge", async () => {
  const f = lifecycle({
    api: true,
    gate: true,
    bucket: true,
    database: true,
    vault: true,
    providerSecret: true,
  });
  const ops: any = f.ops;
  ops.extraKinds = ["vault", "providerSecret"];
  ops.cleanupVault = async () => {
    f.events.push("retire-vault-and-delete-owned-secret");
    f.state.vault = false;
    f.state.providerSecret = false;
  };
  await cleanupFixture(f.record, ops);
  assert.equal(f.record.cleanupNeeded, false);
  assert.ok(
    f.events.indexOf("delete:api") <
      f.events.indexOf("retire-vault-and-delete-owned-secret"),
  );
  assert.ok(
    f.events.indexOf("retire-vault-and-delete-owned-secret") <
      f.events.indexOf("purge"),
  );
});
test("vault cleanup or observation failure retains keys and prevents bucket deletion", async () => {
  for (const failure of ["observe:vault", "vault-cleanup"]) {
    const f = lifecycle(
      {
        api: true,
        gate: true,
        bucket: true,
        database: true,
        vault: true,
        providerSecret: true,
      },
      failure,
    );
    const ops: any = f.ops;
    ops.extraKinds = ["vault", "providerSecret"];
    ops.cleanupVault = async () => {
      throw Error("Injected vault cleanup failure");
    };
    await cleanupFixture(f.record, ops);
    assert.equal(f.record.cleanupNeeded, true);
    assert.equal(f.state.bucket, true);
    assert.ok(!f.events.includes("remove-keys"));
    assert.ok(!f.events.includes("purge"));
  }
});
test("resuming after bucket deletion passes actual absence to fencing and still removes database and gate", async () => {
  const f = lifecycle({
    api: false,
    gate: true,
    bucket: false,
    database: true,
  });
  let observed: any;
  f.ops.closeGate = async (value: any) => {
    observed = value;
    f.events.push("fence");
  };
  await cleanupFixture(f.record, f.ops);
  assert.equal(observed.bucket, false);
  assert.equal(f.record.cleanupNeeded, false);
  assert.ok(!f.events.includes("purge"));
  assert.ok(f.events.includes("delete:database"));
  assert.ok(f.events.includes("delete:gate"));
});
