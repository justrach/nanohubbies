/** Operator-only routes for a disposable repository drill. Not production APIs. */
import {
  sessionCookie,
  settings,
  type User,
} from "../../packages/api/src/auth";

const headers = { "Cache-Control": "private, no-store" };
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers });
const roles = { owner: "recovery-owner", writer: "recovery-writer" } as const;
export const fixtureUser = (role: keyof typeof roles): User => ({
  id: "codegraff:" + roles[role],
  name: roles[role],
  email: roles[role] + "@example.invalid",
  provider: "codegraff",
});
type FixtureEnv = Env & {
  HOSTED_REPO_RECOVERY?: string;
  HOSTED_REPO_PHASE?: string;
  HOSTED_BACKEND_KEY?: string;
  HOSTED_FIXTURE_EXPIRES?: string;
  SESSION_SECRET?: string;
  NANOHUB_RECOVERY_HOLD?: string;
};
async function body(request: Request, limit: number) {
  const reader = request.body?.getReader(),
    decoder = new TextDecoder();
  let text = "",
    bytes = 0;
  if (reader)
    for (;;) {
      const value = await reader.read();
      if (value.done) break;
      bytes += value.value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value.value, { stream: true });
    }
  try {
    return JSON.parse(text + decoder.decode());
  } catch {
    return null;
  }
}
export async function repositoryRoute(
  request: Request,
  env: FixtureEnv,
  ctx: ExecutionContext,
  app: { fetch: Function },
): Promise<Response | null> {
  const url = new URL(request.url),
    path = url.pathname;
  if (
    !path.startsWith("/__fixture/app/") &&
    path !== "/__fixture/repository-session" &&
    path !== "/__fixture/repository"
  )
    return null;
  if (
    env.HOSTED_REPO_RECOVERY !== "1" ||
    env.NANOHUB_RECOVERY_HOLD !== "1" ||
    !/^[a-f0-9]{64}$/.test(env.HOSTED_BACKEND_KEY ?? "") ||
    !Number.isSafeInteger(Number(env.HOSTED_FIXTURE_EXPIRES)) ||
    Number(env.HOSTED_FIXTURE_EXPIRES) <= Date.now()
  )
    return json({ error: "Not found" }, 404);
  if (path.startsWith("/__fixture/app/")) {
    if (!["seed", "verify", "reconcile"].includes(env.HOSTED_REPO_PHASE ?? ""))
      return json({ code: "fixture_frozen" }, 503);
    url.pathname = path.slice("/__fixture/app".length);
    if (
      !/^\/(api|git)\//.test(url.pathname) ||
      /^\/api\/(auth|github)(\/|$)/.test(url.pathname) ||
      request.headers.has("upgrade") ||
      url.pathname.endsWith("/live")
    )
      return json({ error: "Unavailable in the recovery fixture" }, 400);
    // The private operator transport exercises actual application auth/logic.
    // Ordinary routes continue through the deployed hold with no exemption.
    return app.fetch(
      new Request(url, request),
      { ...env, NANOHUB_RECOVERY_HOLD: "0" },
      ctx,
    );
  }
  if (request.method !== "POST")
    return json({ error: "Method not allowed" }, 405);
  const input = await body(
    request,
    path.endsWith("-session") ? 512 : 6 * 1024 * 1024,
  );
  if (!input || typeof input !== "object" || Array.isArray(input))
    return json({ error: "Invalid fixture control body" }, 400);
  if (path.endsWith("-session")) {
    if (!["seed", "verify", "reconcile"].includes(env.HOSTED_REPO_PHASE ?? ""))
      return json({ code: "fixture_frozen" }, 503);
    if (
      !Object.hasOwn(roles, input.role) ||
      !/^[a-f0-9]{64}$/.test(env.SESSION_SECRET ?? "")
    )
      return json({ error: "Invalid fixture identity" }, 400);
    const role = input.role as keyof typeof roles,
      user = fixtureUser(role);
    // Fixed synthetic identities only; these are never real provider credentials.
    const database = env.AUTH_DB.withSession("first-primary");
    await database.batch([
      database.prepare(
        'CREATE TABLE IF NOT EXISTS "account" ("userId" TEXT PRIMARY KEY,"providerId" TEXT,"accountId" TEXT)',
      ),
      database
        .prepare('INSERT OR REPLACE INTO "account" VALUES (?,?,?)')
        .bind(roles[role], "codegraff", "synthetic-" + roles[role]),
    ]);
    await env.ACCOUNT.get(env.ACCOUNT.idFromName(user.id)).save({
      access: "synthetic-not-a-provider-token",
      refresh: null,
      expires: Date.now() + 86400000,
      scope: "",
    });
    return Response.json(
      { user },
      {
        headers: {
          ...headers,
          "Set-Cookie": await sessionCookie(user, settings(env, url), url),
        },
      },
    );
  }
  if (input.op === "objects-list") {
    if (
      input.cursor !== undefined &&
      (typeof input.cursor !== "string" || input.cursor.length > 4096)
    )
      return json({ error: "Invalid cursor" }, 400);
    const result = await env.OBJECTS.list({
      limit: 1000,
      ...(input.inventory ? { prefix: "__fixture/inventory/" } : {}),
      ...(input.cursor ? { cursor: input.cursor } : {}),
    });
    return json({
      objects: result.objects.map(({ key, size }) => ({ key, size })),
      truncated: result.truncated,
      ...(result.truncated ? { cursor: result.cursor } : {}),
    });
  }
  if (["object-get", "object-put", "object-delete"].includes(input.op)) {
    if (
      typeof input.key !== "string" ||
      !input.key ||
      new TextEncoder().encode(input.key).length > 1024
    )
      return json({ error: "Invalid fixture object key" }, 400);
    if (input.op === "object-delete") {
      await env.OBJECTS.delete(input.key);
      return json({ deleted: true });
    }
    if (input.op === "object-put") {
      if (
        typeof input.base64 !== "string" ||
        input.base64.length > 5592408 ||
        input.base64.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)
      )
        return json({ error: "Invalid fixture bytes" }, 400);
      let decoded: string;
      try {
        decoded = atob(input.base64);
      } catch {
        return json({ error: "Invalid fixture bytes" }, 400);
      }
      if (decoded.length > 4194304 || btoa(decoded) !== input.base64)
        return json({ error: "Invalid fixture bytes" }, 400);
      await env.OBJECTS.put(
        input.key,
        Uint8Array.from(decoded, (c) => c.charCodeAt(0)),
      );
      return json({ written: true });
    }
    const result = await env.OBJECTS.get(input.key);
    return result
      ? new Response(result.body, { headers })
      : json({ error: "Fixture object missing" }, 404);
  }
  if (input.op === "database-state" || input.op === "database-lose") {
    const database = env.AUTH_DB.withSession("first-primary");
    if (input.op === "database-lose")
      await database.batch([
        database.prepare("DROP TABLE IF EXISTS cli_credentials"),
        database.prepare('DROP TABLE IF EXISTS "account"'),
      ]);
    const tables = (
      await database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('account','cli_credentials') ORDER BY name",
        )
        .all<{ name: string }>()
    ).results.map((row) => row.name);
    const accounts = tables.includes("account")
      ? (
          await database
            .prepare('SELECT * FROM "account" ORDER BY "userId"')
            .all()
        ).results
      : [];
    const credentials = tables.includes("cli_credentials")
      ? (
          await database
            .prepare("SELECT * FROM cli_credentials ORDER BY id")
            .all()
        ).results
      : [];
    return json({ tables, accounts, credentials });
  }
  if (input.op === "account-proof" || input.op === "account-forget") {
    if (!Object.hasOwn(roles, input.role))
      return json({ error: "Invalid fixture identity" }, 400);
    const account = env.ACCOUNT.get(
      env.ACCOUNT.idFromName(fixtureUser(input.role).id),
    );
    if (input.op === "account-forget") {
      await account.forget();
      return json({ forgotten: true });
    }
    try {
      const value = await account.accessToken(url.origin);
      const digest = Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(value),
          ),
        ),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      return json({ sha256: digest });
    } catch {
      return json({ sha256: null });
    }
  }
  return json({ error: "Unknown fixture operation" }, 400);
}
