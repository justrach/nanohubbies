import { privateFixtureJson } from "./purge.mjs";

/** A newly created private gate can precede routing/secret propagation. Poll
 * only GET health; never treat a 404 as absence or admit work without identity. */
export async function waitForFixtureHealth(read, expected, {
  recordObservation, now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), timeoutMs = 90000,
} = {}) {
  if (!Number.isSafeInteger(expected?.expiresAt) || expected.expiresAt <= now() ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000 ||
      typeof read !== "function" || typeof recordObservation !== "function")
    throw Error("Invalid fixture health contract");
  const deadline = Math.min(now() + timeoutMs, expected.expiresAt);
  for (let attempt = 1; ; attempt++) {
    if (now() >= deadline) throw Error("Private fixture did not become ready before its deadline");
    const response = await read(deadline - now());
    if (now() >= deadline) throw Error("Private fixture health observation exceeded its deadline");
    if (response.status === 200) {
      const value = await privateFixtureJson(response);
      if (!value || Array.isArray(value) || Object.keys(value).sort().join(",") !== "expiresAt,fixture" ||
          value.fixture !== "private-hosted-git" || value.expiresAt !== expected.expiresAt)
        throw Error("Private fixture health identity mismatch");
      if (now() >= deadline) throw Error("Private fixture health observation exceeded its deadline");
      await recordObservation({ attempt, status: 200, identityVerified: true });
      return { ...value, attempts: attempt };
    }
    await response.body?.cancel();
    if (response.status !== 404) throw Error("Private fixture health was not admitted");
    await recordObservation({ attempt, status: 404, identityVerified: false });
    if (now() >= deadline) throw Error("Private fixture did not become ready before its deadline");
    await sleep(Math.min(1000, deadline - now()));
  }
}
