const phases = new Set(["seed", "frozen", "verify", "reconcile"]);
const versionId = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

/** Deployment metadata is not a data-plane observation. Poll only the private,
 * read-only phase endpoint, and never retry an application or storage write. */
export async function waitForFixturePhase(
  read,
  expected,
  { now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), timeoutMs = 90000 } = {},
) {
  if (!phases.has(expected.phase) || !versionId.test(expected.version) ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000)
    throw Error("Invalid expected fixture phase/version");
  const deadline = now() + timeoutMs;
  let attempts = 0;
  for (;;) {
    if (now() >= deadline)
      throw Error("Fixture phase did not reach the expected deployed version; keep recovery closed");
    const observed = await read(Math.max(1, deadline - now()));
    attempts++;
    if (now() > deadline)
      throw Error("Fixture phase observation exceeded its deadline; keep recovery closed");
    if (
      observed?.normalTrafficHeld !== true ||
      !phases.has(observed.phase) ||
      !versionId.test(observed.version ?? "")
    )
      throw Error("Invalid fixture phase observation; keep recovery closed");
    if (observed.phase === expected.phase && observed.version === expected.version)
      return { attempts, phase: observed.phase, version: observed.version };
    if (now() >= deadline)
      throw Error("Fixture phase did not reach the expected deployed version; keep recovery closed");
    await sleep(Math.min(1000, Math.max(0, deadline - now())));
  }
}

/** Error bodies can contain application data. Return only known fence codes,
 * with bounded reads; never return arbitrary messages, headers or body text. */
export async function recoveryFailureCode(response) {
  const allowed = new Set(["fixture_frozen", "recovery_hold"]);
  const reader = response.body?.getReader();
  if (!reader) return null;
  let bytes = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 4096) return null;
      chunks.push(value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
    const code = JSON.parse(new TextDecoder().decode(body))?.code;
    return allowed.has(code) ? code : null;
  } catch {
    return null;
  } finally {
    await reader.cancel().catch(() => {});
  }
}
