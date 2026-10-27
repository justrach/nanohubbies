import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { classes } from "../hosted-git-fixture/config.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const bookmark = /^[a-f0-9]{8}-[a-f0-9]{8}-[a-f0-9]{8}-[a-f0-9]{32}$/;
const rows = (value) => [
  {
    marker: value,
    payload: "00FF11",
    note: Buffer.from(value + "\0検証🚀")
      .toString("hex")
      .toUpperCase(),
    large_integer: "9223372036854775807",
  },
];
export function verifyRetainedBytes(bytes, expected) {
  assert.equal(bytes.length, expected.bytes, "Retained byte count mismatch");
  assert.equal(hash(bytes), expected.sha256, "Retained checksum mismatch");
  return bytes;
}
export async function runNativeRecoveryProbe({
  call,
  wrangler,
  config,
  plan,
  record,
  persist,
  directory,
}) {
  assert.equal(plan.purpose, "storage-recovery");
  assert.match(
    plan.database,
    /^nh-recovery-live-[a-z0-9]{8,12}-[a-f0-9]{10}-auth$/,
  );
  const started = Date.now();
  const probe = (record.nativeRecovery = {
    startedAt: new Date().toISOString(),
    scope:
      "Provider primitives on isolated real application classes; not full repository or namespace-loss recovery",
    objects: [],
    heldChecks: 0,
  });
  const control = async (body) =>
    call("/__fixture/recovery", { method: "POST", body });
  const operation = async (body) => (await control(body)).json();
  const held = async () => {
    for (const [path, method] of [
      ["/api/agent-help", "GET"],
      ["/git/fixture/repo.git/info/refs?service=git-upload-pack", "GET"],
      ["/nh/latest.json", "GET"],
      ["/nh/latest.json", "HEAD"],
    ]) {
      const response = await call(path, { method, expectedStatus: 503 });
      assert.equal(response.headers.get("x-nanohub-recovery"), "hold");
      assert.match(response.headers.get("cache-control"), /private.*no-store/);
      assert.equal(response.headers.get("retry-after"), "60");
      if (method === "HEAD") assert.equal(await response.text(), "");
      else assert.equal((await response.json()).code, "recovery_hold");
      probe.heldChecks++;
    }
    await persist();
  };
  await held();
  for (const [binding] of classes) {
    console.log(
      JSON.stringify({
        runId: plan.runId,
        phase: "native-object-recovery",
        binding,
      }),
    );
    const target = {
      binding,
      name: "native-recovery-" + binding.toLowerCase(),
    };
    const op = (op, more = {}) => operation({ ...target, op, ...more });
    const a = randomBytes(32).toString("hex"),
      b = randomBytes(32).toString("hex");
    const before = await op("write", { value: a });
    assert.deepEqual(before.sql, rows(a));
    assert.deepEqual(before.kv, { value: a, bytes: [0, 255, 17] });
    assert.equal(before.alarm, null);
    const pointA = await op("checkpoint");
    assert.match(pointA.bookmark, bookmark);
    assert.equal(pointA.id, before.id);
    const newer = await op("write", { value: b });
    assert.deepEqual(newer.sql, rows(b));
    assert.deepEqual(newer.kv, { value: b, bytes: [0, 255, 17] });
    assert.equal(newer.alarm, null);
    const pointB = await op("checkpoint");
    assert.match(pointB.bookmark, bookmark);
    assert.notEqual(pointA.bookmark, pointB.bookmark);
    const item = {
      binding,
      id: before.id,
      pointA: pointA.bookmark,
      pointB: pointB.bookmark,
      checkpointA: before,
      checkpointB: newer,
    };
    probe.objects.push(item);
    await persist();
    const lost = await op("lose");
    assert.deepEqual(lost, { id: before.id, sql: [], kv: null, alarm: null });
    item.lossObserved = true;
    await persist();
    const scheduled = await op("schedule", { bookmark: pointA.bookmark });
    assert.match(scheduled.undoBookmark, bookmark);
    item.undoBookmark = scheduled.undoBookmark;
    await persist();
    await op("restart");
    assert.deepEqual(await op("read"), before);
    item.restoredA = true;
    await persist();
    await op("schedule", { bookmark: scheduled.undoBookmark });
    await op("restart");
    assert.deepEqual(await op("read"), lost);
    item.undoRestoredLoss = true;
    await persist();
    await op("schedule", { bookmark: pointB.bookmark });
    await op("restart");
    assert.deepEqual(await op("read"), newer);
    item.returnedToB = true;
    await persist();
    await held();
  }
  console.log(
    JSON.stringify({ runId: plan.runId, phase: "native-d1-recovery" }),
  );
  const dbOp = (op, more = {}) =>
    operation({ binding: "AUTH_DB", op, ...more });
  const point = async () => {
    const result = JSON.parse(
      (
        await wrangler(
          ["d1", "time-travel", "info", plan.database, "--json"],
          config,
        )
      ).stdout,
    );
    assert.match(result.bookmark, bookmark);
    return result.bookmark;
  };
  const restore = async (value) => {
    assert.match(value, bookmark);
    const result = JSON.parse(
      (
        await wrangler(
          [
            "d1",
            "time-travel",
            "restore",
            plan.database,
            "--bookmark",
            value,
            "--json",
          ],
          config,
        )
      ).stdout,
    );
    assert.equal(result.bookmark, value);
    assert.match(result.previous_bookmark, bookmark);
    return result.previous_bookmark;
  };
  const a = randomBytes(32).toString("hex"),
    b = randomBytes(32).toString("hex");
  const before = await dbOp("write", { value: a });
  assert.deepEqual(before.rows, rows(a));
  const pointA = await point();
  const newer = await dbOp("write", { value: b });
  assert.deepEqual(newer.rows, rows(b));
  const pointB = await point();
  assert.notEqual(pointA, pointB);
  probe.database = { pointA, pointB, rowsA: before.rows, rowsB: newer.rows };
  await persist();
  assert.deepEqual((await dbOp("lose")).rows, []);
  probe.database.lossObserved = true;
  await persist();
  const undo = await restore(pointA);
  probe.database.undoBookmark = undo;
  await persist();
  assert.deepEqual((await dbOp("read")).rows, before.rows);
  probe.database.restoredA = true;
  await persist();
  await restore(undo);
  assert.deepEqual((await dbOp("read")).rows, []);
  probe.database.undoRestoredLoss = true;
  await persist();
  await restore(pointB);
  assert.deepEqual((await dbOp("read")).rows, newer.rows);
  probe.database.returnedToB = true;
  await persist();
  await held();
  console.log(
    JSON.stringify({ runId: plan.runId, phase: "retained-r2-recovery" }),
  );
  const original = randomBytes(1048576),
    newerBytes = randomBytes(1048576);
  const expected = { bytes: original.length, sha256: hash(original) };
  const retained = join(directory, "retained-r2.bin");
  await writeFile(retained, original, { mode: 0o600 });
  probe.bucket = {
    ...expected,
    backupLocation: "retained-r2.bin",
    scope:
      "Independent private controller file, not a long-term hosted backup service",
  };
  await persist();
  const write = async (bytes) => {
    const response = await control({
      binding: "OBJECTS",
      op: "write",
      base64: bytes.toString("base64"),
    });
    assert.equal(hash(Buffer.from(await response.arrayBuffer())), hash(bytes));
  };
  const read = async () =>
    Buffer.from(
      await (await control({ binding: "OBJECTS", op: "read" })).arrayBuffer(),
    );
  await write(original);
  await write(newerBytes);
  const damaged = Buffer.from(original);
  damaged[0] ^= 255;
  await writeFile(retained, damaged, { mode: 0o600 });
  assert.throws(() => verifyRetainedBytes(damaged, expected), /checksum/);
  // Use the actual retained file, and reject it before issuing any restore request.
  await assert.rejects(
    async () => verifyRetainedBytes(await readFile(retained), expected),
    /checksum/,
  );
  assert.equal(hash(await read()), hash(newerBytes));
  probe.bucket.corruptionRejectedBeforeWrite = true;
  await persist();
  await writeFile(retained, original, { mode: 0o600 });
  const missing = await call("/__fixture/recovery", {
    method: "POST",
    body: { binding: "OBJECTS", op: "lose" },
    expectedStatus: 404,
  });
  await missing.arrayBuffer();
  assert.equal(
    (
      await call("/__fixture/recovery", {
        method: "POST",
        body: { binding: "OBJECTS", op: "read" },
        expectedStatus: 404,
      })
    ).status,
    404,
  );
  probe.bucket.lossObserved = true;
  await persist();
  await write(verifyRetainedBytes(await readFile(retained), expected));
  assert.deepEqual(await read(), original);
  probe.bucket.restoredExactBytes = true;
  await persist();
  await write(newerBytes);
  assert.deepEqual(await read(), newerBytes);
  probe.bucket.returnedToB = true;
  await held();
  probe.completedAt = new Date().toISOString();
  probe.elapsedMs = Date.now() - started;
  probe.passed = true;
  // No public reopening: holds, unknown current authority and full DR acceptance remain separate.
  probe.normalTrafficRemainedHeld = true;
  await persist();
}
