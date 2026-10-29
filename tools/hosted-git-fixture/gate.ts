/** Separate control/purge service; holds no production bindings or credentials. */
interface GateEnv {
  HOSTED_FIXTURE_KEY?: string;
  HOSTED_BACKEND_KEY?: string;
  HOSTED_FIXTURE_EXPIRES?: string;
  HOSTED_PURGE_ONLY?: string;
  TARGET?: Fetcher;
  OBJECTS?: R2Bucket;
}
const reply = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export default {
  async fetch(request: Request, env: GateEnv) {
    if (
      !/^[a-f0-9]{64}$/.test(env.HOSTED_FIXTURE_KEY ?? "") ||
      request.headers.get("x-nanohub-hosted-fixture") !== env.HOSTED_FIXTURE_KEY
    )
      return reply({ error: "Not found" }, 404);
    const url = new URL(request.url);
    if (url.pathname === "/__fixture/purge-status" && request.method === "GET")
      return reply({ purgeOnly: env.HOSTED_PURGE_ONLY === "1",
        bucketConfigured: !!env.OBJECTS, targetConfigured: !!env.TARGET });
    // Cleanup remains possible after the API gate expires. This route returns
    // counts only and can address only this fixture's dedicated bucket binding.
    if (url.pathname === "/__fixture/purge" && request.method === "POST") {
      if (env.HOSTED_PURGE_ONLY !== "1" || env.TARGET)
        return reply({ error: "Close the API gate before purging", code: "fixture_purge_not_ready" }, 409);
      if (!env.OBJECTS)
        return reply({ error: "Fixture bucket is not configured", code: "fixture_bucket_unbound" }, 409);
      const page = await env.OBJECTS.list({ limit: 1000 });
      if (page.objects.length)
        await env.OBJECTS.delete(page.objects.map((object) => object.key));
      return reply({ deleted: page.objects.length, more: page.truncated });
    }
    const deadline = Number(env.HOSTED_FIXTURE_EXPIRES);
    if (
      env.HOSTED_PURGE_ONLY === "1" ||
      !Number.isSafeInteger(deadline) ||
      deadline <= Date.now() ||
      !env.TARGET ||
      !/^[a-f0-9]{64}$/.test(env.HOSTED_BACKEND_KEY ?? "")
    )
      return reply({ error: "Not found" }, 404);
    if (url.pathname === "/__fixture/health")
      return reply({ fixture: "private-hosted-git", expiresAt: deadline });
    const headers = new Headers(request.headers);
    headers.delete("x-nanohub-hosted-fixture");
    headers.set("x-nanohub-hosted-backend", env.HOSTED_BACKEND_KEY!);
    return env.TARGET.fetch(new Request(request, { headers }));
  },
};
