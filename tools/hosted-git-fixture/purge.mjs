/** Private fixture cleanup only. No retry after an unknown deletion outcome. */
async function boundedJson(response) {
  const caching = (response.headers.get("cache-control") ?? "").toLowerCase().split(",").map(value => value.trim());
  if (!caching.includes("private") || !caching.includes("no-store") || caching.includes("public"))
    throw Error("Invalid fixture purge response caching");
  const reader = response.body?.getReader();
  if (!reader) throw Error("Missing fixture purge response");
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > 4096) throw Error("Oversized fixture purge response");
      chunks.push(part.value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const part of chunks) { body.set(part, offset); offset += part.length; }
    try { return JSON.parse(new TextDecoder().decode(body)); }
    catch { throw Error("Invalid fixture purge JSON"); }
  } finally { await reader.cancel().catch(() => {}); }
}

export async function purgeFixturePage({ readStatus, purge, recordObservation,
  now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs = 90000 }) {
  if (![readStatus, purge, recordObservation].every(value => typeof value === "function") ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000)
    throw Error("Invalid fixture purge observation contract");
  const deadline = now() + timeoutMs;
  const remaining = () => {
    const value = deadline - now();
    if (value <= 0) throw Error("Fixture purge readiness deadline exceeded");
    return value;
  };
  let observations = 0, attempts = 0;
  for (;;) {
    const response = await readStatus(remaining());
    remaining();
    if (response.status !== 200) throw Error("Fixture purge status unavailable");
    const status = await boundedJson(response);
    if (!status || Array.isArray(status) || Object.keys(status).sort().join(",") !==
        "bucketConfigured,purgeOnly,targetConfigured" ||
        !Object.values(status).every(value => typeof value === "boolean"))
      throw Error("Invalid fixture purge status");
    observations++;
    if (!status.purgeOnly || status.targetConfigured) {
      await recordObservation({ state: "waiting-for-closed-gate", observations });
      await sleep(Math.min(1000, remaining()));
      continue;
    }
    if (!status.bucketConfigured) throw Error("Fixture purge bucket is not bound");
    await recordObservation({ state: "closed-gate-observed", observations,
      purgeAttempt: attempts + 1 });
    const result = await purge(remaining());
    remaining();
    const value = await boundedJson(result);
    attempts++;
    if (result.status === 200) {
      if (!value || Array.isArray(value) || Object.keys(value).sort().join(",") !== "deleted,more" ||
          !Number.isInteger(value.deleted) || value.deleted < 0 || value.deleted > 1000 ||
          typeof value.more !== "boolean") throw Error("Invalid fixture purge acknowledgement");
      return value;
    }
    if (result.status !== 409 || value?.code !== "fixture_purge_not_ready" || attempts >= 3)
      throw Error("Fixture purge was not acknowledged; inspect owned resources");
    await recordObservation({ state: "refused-before-deletion", observations,
      refusedAttempt: attempts, refusal: "fixture_purge_not_ready" });
    await sleep(Math.min(1000, remaining()));
  }
}
