import test from "node:test";
import assert from "node:assert/strict";
import { recoveryObject } from "./objects";
import { control } from "./control";
import {
  fixturePlan,
  classes,
  assertFixtureBindings,
} from "../hosted-git-fixture/config.mjs";
import { verifyRetainedBytes } from "./probe.mjs";
import { createHash } from "node:crypto";

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
