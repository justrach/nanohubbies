import { sessionCookie, settings, devUser } from "../../packages/api/src/auth";
import { readMeasurement } from "./measurement";
type FixtureEnv = Env & {
  HOSTED_BACKEND_KEY?: string;
  HOSTED_FIXTURE_EXPIRES?: string;
  SESSION_SECRET?: string;
};
export function hostedApp(app: {
  fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response>;
}) {
  return {
    async fetch(request: Request, env: FixtureEnv, ctx: ExecutionContext) {
      const deadline = Number(env.HOSTED_FIXTURE_EXPIRES);
      if (
        !/^[a-f0-9]{64}$/.test(env.HOSTED_BACKEND_KEY ?? "") ||
        request.headers.get("x-nanohub-hosted-backend") !==
          env.HOSTED_BACKEND_KEY ||
        !Number.isSafeInteger(deadline) ||
        deadline <= Date.now()
      )
        return new Response("Not found", {
          status: 404,
          headers: { "Cache-Control": "private, no-store" },
        });
      const clean = new Request(request),
        url = new URL(clean.url);
      clean.headers.delete("x-nanohub-hosted-backend");
      clean.headers.delete("x-nanohub-hosted-fixture");
      if (url.pathname === "/__fixture/session" && request.method === "POST") {
        if (!/^[a-f0-9]{64}$/.test(env.SESSION_SECRET ?? ""))
          return new Response("Fixture not ready", {
            status: 503,
            headers: { "Cache-Control": "private, no-store" },
          });
        const user = devUser("hosted-git-fixture");
        return Response.json(
          { user },
          {
            headers: {
              "Set-Cookie": await sessionCookie(user, settings(env, url), url),
              "Cache-Control": "private, no-store",
            },
          },
        );
      }
      if (
        url.pathname.startsWith("/git/") &&
        url.pathname.endsWith(".git/git-receive-pack")
      ) {
        const measured = readMeasurement(env.OBJECTS, (...values) =>
          console.log("nanohub-fixture-git-reads", ...values),
        );
        try {
          return await app.fetch(
            clean,
            { ...env, OBJECTS: measured.bucket },
            ctx,
          );
        } finally {
          measured.finish();
        }
      }
      return app.fetch(clean, env, ctx);
    },
  };
}
