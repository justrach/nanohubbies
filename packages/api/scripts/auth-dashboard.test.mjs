import assert from "node:assert/strict";
import { test, after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
// Node dependencies may resolve native helpers relative to import.meta.url.
const fixtureDir=await mkdtemp(join(tmpdir(),"nanohub-auth-test-"));
after(()=>rm(fixtureDir,{recursive:true,force:true}));
const fixtureModule=join(fixtureDir,"api.mjs");await writeFile(fixtureModule,outputFiles[0].text);
const { default: api } = await import(pathToFileURL(fixtureModule).href);
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

test("only a normalized CLI code selects the fixed CLI consent return path", async()=>{
  for(const code of ["abcd-efgh","ABCDEFGH","//evil.invalid","https://evil.invalid/?code=ABCD-EFGH","ABCD-EFGH&return=//evil.invalid","ABCD-EFGH\r\nX-Test: bad"]){
    const response=await api.fetch(new Request(`http://localhost/api/auth/signin/codegraff?cli_code=${encodeURIComponent(code)}&return=https://evil.invalid`),env);
    assert.equal(response.status,302);const expected=/^(abcd-efgh|ABCDEFGH)$/.test(code)?"/cli/authorize?code=ABCD-EFGH":"/dashboard",attempt=fixture.attempts.at(-1);
    assert.equal(attempt.callbackURL,expected);assert.equal(attempt.newUserCallbackURL,expected);assert.equal(attempt.errorCallbackURL,expected);
  }
});
