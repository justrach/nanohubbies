import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const fixture = { attempts: [] };
globalThis.__authDashboardFixture = fixture;
const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL("../src/index.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "node",
  plugins: [{
    name: "auth-provider-fixture",
    setup(plugin) {
      plugin.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: "workers", namespace: "fixture" }));
      plugin.onResolve({ filter: /^\.\/better-auth$/ }, () => ({ path: "auth", namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
        loader: "js",
        contents: path === "workers" ? "export class DurableObject {}" : `
          export const codegraffReady = () => true;
          export const sessionUser = async () => null;
          export async function codegraffAuth() {
            return {api: {async signInSocial(options) {
              globalThis.__authDashboardFixture.attempts.push(options.body);
              const url = new URL("https://provider.example/oauth/authorize");
              for (const [key, value] of Object.entries(options.body.additionalParams ?? {})) url.searchParams.set(key, value);
              return Response.json({url: url.href}, {headers: {"Set-Cookie": "oauth-state=fixture; HttpOnly; SameSite=Lax"}});
            }}};
          }
        `,
      }));
    },
  }],
});
const { default: api } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
const env = { SESSION_SECRET: "offline-test", HUB: { idFromName: (id) => id, get: () => ({}) } };

test("both sign-in entry points send new, returning and failed sign-ins to dashboard", async () => {
  for (const provider of ["codegraff", "github"]) {
    for (const legacyReturn of ["", "/start", "/t/example/room", "https://example.invalid"]) {
      const request = new Request(`http://localhost/api/auth/signin/${provider}?return=${encodeURIComponent(legacyReturn)}`);
      const response = await api.fetch(request, env);
      assert.equal(response.status, 302);
      assert.match(response.headers.get("set-cookie"), /oauth-state=fixture/);
      const attempt = fixture.attempts.at(-1);
      assert.equal(attempt.provider, "codegraff", "both choices use the same account identity");
      assert.equal(attempt.callbackURL, "/dashboard");
      assert.equal(attempt.newUserCallbackURL, "/dashboard");
      assert.equal(attempt.errorCallbackURL, "/dashboard");
      const destination = new URL(response.headers.get("location"));
      assert.equal(destination.searchParams.get("login_provider"), provider === "github" ? "github" : null);
    }
  }
});
