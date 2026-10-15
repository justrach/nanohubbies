/** Test-only entrypoint. It is never referenced by either Wrangler config. */
import api from "../../src/index";
import { sessionCookie, settings, type User } from "../../src/auth";
export * from "../../src/index";

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname === "/fixture/session") {
      const {
        localId,
        subject,
        name = "Same display name",
      } = await request.json<{
        localId: string;
        subject: string;
        name?: string;
      }>();
      await env.AUTH_DB.prepare(
        'CREATE TABLE IF NOT EXISTS "account" ("userId" TEXT PRIMARY KEY, "providerId" TEXT, "accountId" TEXT)',
      ).run();
      await env.AUTH_DB.prepare(
        'INSERT OR REPLACE INTO "account" ("userId", "providerId", "accountId") VALUES (?, ?, ?)',
      )
        .bind(localId, "codegraff", subject)
        .run();
      const user: User = {
        id: `codegraff:${localId}`,
        name,
        email: `${subject}@example.invalid`,
        provider: "codegraff",
      };
      await env.ACCOUNT.get(env.ACCOUNT.idFromName(user.id)).save({
        access: `fixture-${subject}`,
        refresh: null,
        expires: Date.now() + 3600000,
        scope: "openid rooms:read",
      });
      return Response.json(
        { user },
        {
          headers: {
            "Set-Cookie": await sessionCookie(user, settings(env, url), url),
          },
        },
      );
    }
    if (url.pathname === "/fixture/proof")
      return Response.json(
        await env.HUB.get(env.HUB.idFromName("hub")).teamProof(
          "private-team",
          url.searchParams.get("principal")!,
        ),
      );
    return api.fetch(request, env);
  },
};
