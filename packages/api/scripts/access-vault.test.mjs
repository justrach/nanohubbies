import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";
const output = await build({
  entryPoints: [
    new URL("../src/collaborators/store.ts", import.meta.url).pathname,
    new URL("../../vault/src/provider.ts", import.meta.url).pathname,
  ],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  outdir: "/virtual",
});
const [{ Collaborators, hashToken }, { bindingFor, references, scopeKey }] =
  await Promise.all(
    output.outputFiles.map(
      (o) =>
        import(
          "data:text/javascript;base64," +
            Buffer.from(o.text).toString("base64")
        ),
    ),
  );
test("Cloudflare references are scoped to repository, environment and name without reading values", async () => {
  let reads = 0;
  const scope = { repository: "repo", environment: "staging", actor: "owner" };
  const binding = {
    async get() {
      reads++;
      return "synthetic";
    },
  };
  const env = {
    CLOUDFLARE_SECRET_SCOPES: JSON.stringify({
      SECRET_1: {
        repository: "repo",
        environment: "staging",
        name: "DEPLOY_TOKEN",
      },
    }),
    SECRET_1: binding,
  };
  assert.deepEqual(references(env, scope), [
    { binding: "SECRET_1", name: "DEPLOY_TOKEN" },
  ]);
  assert.equal(bindingFor(env, scope, "DEPLOY_TOKEN", "SECRET_1"), binding);
  assert.equal(reads, 0);
  assert.equal(
    await bindingFor(env, scope, "DEPLOY_TOKEN", "SECRET_1").get(),
    "synthetic",
  );
  for (const wrong of [
    { ...scope, repository: "other" },
    { ...scope, environment: "production" },
  ])
    assert.throws(
      () => bindingFor(env, wrong, "DEPLOY_TOKEN", "SECRET_1"),
      /unavailable/,
    );
  assert.throws(
    () => bindingFor(env, scope, "OTHER", "SECRET_1"),
    /unavailable/,
  );
  assert.throws(
    () => bindingFor(env, scope, "DEPLOY_TOKEN", "MISSING"),
    /unavailable/,
  );
  assert.throws(() => scopeKey({ ...scope, repository: "../other" }), /scope/);
});
function fixture() {
  const db = new DatabaseSync(":memory:");
  const sql = {
    exec(q, ...args) {
      const rows = db.prepare(q).all(...args);
      return { toArray: () => rows };
    },
  };
  sql.exec("CREATE TABLE team_bindings(trunk TEXT PRIMARY KEY,body TEXT)");
  sql.exec(
    "INSERT INTO team_bindings VALUES(?,?)",
    "repo",
    JSON.stringify({ kind: "owner", boundBy: "codegraff:owner" }),
  );
  return { db, sql, store: new Collaborators(sql) };
}
test("invites require the exact identity, expire, cannot replay, and never grant access before acceptance", async () => {
  const f = fixture();
  try {
    const token = "nhi_synthetic",
      hash = await hashToken(token);
    const i = f.store.invite(
      "repo",
      "codegraff:owner",
      "codegraff:bob",
      "writer",
      hash,
    );
    assert.equal(f.store.role("repo", "codegraff:bob"), null);
    assert.equal(
      JSON.stringify(
        f.sql.exec("SELECT * FROM repo_invitations").toArray(),
      ).includes(token),
      false,
    );
    assert.throws(
      () => f.store.accept("repo", "codegraff:eve", hash),
      /unavailable/,
    );
    f.sql.exec("UPDATE repo_invitations SET expires=0 WHERE id=?", i.id);
    assert.throws(
      () => f.store.accept("repo", "codegraff:bob", hash),
      /unavailable/,
    );
    const j = f.store.invite(
      "repo",
      "codegraff:owner",
      "codegraff:bob",
      "writer",
      hash,
    );
    f.store.accept("repo", "codegraff:bob", hash);
    assert.equal(f.store.role("repo", "codegraff:bob"), "writer");
    assert.throws(
      () => f.store.accept("repo", "codegraff:bob", hash),
      /unavailable/,
    );
    assert.throws(
      () => f.store.change("repo", "codegraff:owner", "codegraff:owner", null),
      /owner/,
    );
    assert.equal(f.store.list("repo").members.length, 2);
  } finally {
    f.db.close();
  }
});
test("demoted admins cannot redeem outstanding invitations or promote themselves; team boundaries stay authoritative", () => {
  const f = fixture();
  try {
    f.store.invite(
      "repo",
      "codegraff:owner",
      "codegraff:admin",
      "admin",
      "adminhash",
    );
    f.store.accept("repo", "codegraff:admin", "adminhash");
    f.store.invite(
      "repo",
      "codegraff:admin",
      "codegraff:bob",
      "writer",
      "bobhash",
    );
    assert.throws(
      () =>
        f.store.change("repo", "codegraff:admin", "codegraff:admin", "owner"),
      /owner/,
    );
    assert.throws(
      () =>
        f.store.invite(
          "repo",
          "codegraff:admin",
          "codegraff:eve",
          "admin",
          "evehash",
        ),
      /owner/,
    );
    f.store.change("repo", "codegraff:owner", "codegraff:admin", "reader");
    assert.throws(
      () => f.store.accept("repo", "codegraff:bob", "bobhash"),
      /unavailable/,
    );
    f.sql.exec(
      "UPDATE team_bindings SET body=?",
      JSON.stringify({ kind: "team", boundBy: "codegraff:owner" }),
    );
    assert.throws(
      () => f.store.role("repo", "codegraff:admin"),
      /independently/,
    );
  } finally {
    f.db.close();
  }
});
