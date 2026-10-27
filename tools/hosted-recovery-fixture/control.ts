/** Private disposable-fixture controls. Never imported by the production entrypoint. */
import type { recoveryObject } from "./objects";

const bindings = new Set([
  "SEQUENCER",
  "AGENT",
  "ROOM",
  "DRIVER",
  "HUB",
  "IMPORT_JOB",
  "ACCOUNT",
  "LANE",
  "PACKER",
]);
const objectKey = "fixture-recovery/retained.bin";
const marker = /^[a-f0-9]{64}$/;
const headers = { "Cache-Control": "private, no-store" };
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers });
type RecoveryStub = InstanceType<ReturnType<typeof recoveryObject>>;
export async function control(
  request: Request,
  env: Env & { HOSTED_BACKEND_KEY?: string; HOSTED_FIXTURE_EXPIRES?: string },
) {
  // Independently check configuration even though the outer ingress authenticates requests.
  if (
    !marker.test(env.HOSTED_BACKEND_KEY ?? "") ||
    !Number.isSafeInteger(Number(env.HOSTED_FIXTURE_EXPIRES)) ||
    Number(env.HOSTED_FIXTURE_EXPIRES) <= Date.now()
  )
    return json({ error: "Not found" }, 404);
  if (request.method !== "POST")
    return json({ error: "Method not allowed" }, 405);
  const reader = request.body?.getReader();
  let bytes = 0,
    text = "";
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  let body: any;
  try {
    if (reader)
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 1500000) {
          await reader.cancel();
          return json({ error: "Control body too large" }, 413);
        }
        text += decoder.decode(value, { stream: true });
      }
    body = JSON.parse(text + decoder.decode());
  } catch {
    return json({ error: "Invalid control body" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    return json({ error: "Invalid control body" }, 400);
  if (body.binding === "AUTH_DB") {
    if (!["write", "lose", "read"].includes(body.op))
      return json({ error: "Unknown fixture recovery operation" }, 400);
    if (
      body.op === "write" &&
      (typeof body.value !== "string" || !marker.test(body.value))
    )
      return json({ error: "Invalid fixture marker" }, 400);
    const database = env.AUTH_DB.withSession("first-primary");
    if (body.op === "write") {
      if (typeof body.value !== "string" || !marker.test(body.value))
        return json({ error: "Invalid fixture marker" }, 400);
      await database.batch([
        database.prepare(
          "CREATE TABLE IF NOT EXISTS fixture_recovery_marker (marker TEXT PRIMARY KEY, payload BLOB, note TEXT, large_integer INTEGER)",
        ),
        database.prepare("DELETE FROM fixture_recovery_marker"),
        database
          .prepare(
            "INSERT INTO fixture_recovery_marker VALUES (?, ?, ?, CAST('9223372036854775807' AS INTEGER))",
          )
          .bind(
            body.value,
            Uint8Array.of(0, 255, 17).buffer,
            body.value + "\0検証🚀",
          ),
      ]);
    } else if (body.op === "lose")
      await database
        .prepare("DROP TABLE IF EXISTS fixture_recovery_marker")
        .run();
    else if (body.op !== "read")
      return json({ error: "Unknown fixture recovery operation" }, 400);
    const exists = await database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='fixture_recovery_marker'",
      )
      .first();
    const rows = exists
      ? (
          await database
            .prepare(
              "SELECT marker, hex(payload) AS payload, hex(note) AS note, CAST(large_integer AS TEXT) AS large_integer FROM fixture_recovery_marker",
            )
            .all()
        ).results
      : [];
    return json({ rows, bookmark: database.getBookmark() });
  }
  if (body.binding === "OBJECTS") {
    if (body.op === "write") {
      if (
        typeof body.base64 !== "string" ||
        body.base64.length > 1398104 ||
        body.base64.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(body.base64)
      )
        return json({ error: "Invalid fixture bytes" }, 400);
      let decoded: string;
      try {
        decoded = atob(body.base64);
      } catch {
        return json({ error: "Invalid fixture bytes" }, 400);
      }
      if (btoa(decoded) !== body.base64)
        return json({ error: "Invalid fixture bytes" }, 400);
      const bytes = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
      if (bytes.length > 1048576)
        return json({ error: "Fixture bytes too large" }, 413);
      await env.OBJECTS.put(objectKey, bytes, {
        httpMetadata: { contentType: "application/octet-stream" },
      });
    } else if (body.op === "lose") await env.OBJECTS.delete(objectKey);
    else if (body.op !== "read")
      return json({ error: "Unknown fixture recovery operation" }, 400);
    const object = await env.OBJECTS.get(objectKey);
    return object
      ? new Response(object.body, {
          headers: { ...headers, "Content-Type": "application/octet-stream" },
        })
      : json({ error: "Fixture object missing" }, 404);
  }
  const byId =
    typeof body.id === "string" &&
    /^[a-f0-9]{64}$/.test(body.id) &&
    body.name === undefined;
  const byName =
    typeof body.name === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9:_.\/-]{0,200}$/.test(body.name) &&
    body.id === undefined;
  if (!bindings.has(body.binding) || (!byId && !byName))
    return json({ error: "Invalid fixture target" }, 400);
  const namespace = (env as unknown as Record<string, DurableObjectNamespace>)[
    body.binding
  ];
  const stub = namespace.get(
    byId ? namespace.idFromString(body.id) : namespace.idFromName(body.name),
  ) as unknown as RecoveryStub;
  const key = env.HOSTED_BACKEND_KEY!;
  switch (body.op) {
    case "write":
      if (typeof body.value !== "string" || !marker.test(body.value))
        return json({ error: "Invalid fixture marker" }, 400);
      return json(await stub.fixtureRecoveryWrite(key, body.value));
    case "read":
      return json(await stub.fixtureRecoveryRead(key));
    case "inspect":
      return json(await stub.fixtureRecoveryInspect(key));
    case "checkpoint":
      return json(await stub.fixtureRecoveryCheckpoint(key));
    case "lose":
      return json(await stub.fixtureRecoveryLose(key));
    case "lose-inspect":
      await stub.fixtureRecoveryLose(key);
      return json(await stub.fixtureRecoveryInspect(key));
    case "schedule":
      return json(await stub.fixtureRecoverySchedule(key, body.bookmark));
    // A caught exception only acknowledges the request; the controller must read and compare restored state.
    case "restart":
      try {
        await stub.fixtureRecoveryRestart(key);
      } catch {
        return json({ restartRequested: true });
      }
      throw Error("Provider restart did not abort");
    default:
      return json({ error: "Unknown fixture recovery operation" }, 400);
  }
}
