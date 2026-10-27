import test from "node:test";
import assert from "node:assert/strict";
import { vaultConfiguration } from "../../../tools/cloudflare-secret-bindings.mjs";
const reference = {
  binding: "STAGING_DEPLOY",
  storeId: "a".repeat(32),
  secretName: "repo-staging-deploy",
  repository: "repo-123",
  environment: "staging",
  name: "DEPLOY_TOKEN",
};
test("Cloudflare deployment binds each provider secret to exactly one repository/environment/name", () => {
  const c = vaultConfiguration([reference], {
    main: "src/index.ts",
    vars: { OTHER: "kept" },
  });
  assert.deepEqual(c.secrets_store_secrets, [
    {
      binding: reference.binding,
      store_id: reference.storeId,
      secret_name: reference.secretName,
    },
  ]);
  assert.deepEqual(JSON.parse(c.vars.CLOUDFLARE_SECRET_SCOPES), {
    STAGING_DEPLOY: {
      repository: "repo-123",
      environment: "staging",
      name: "DEPLOY_TOKEN",
    },
  });
  assert.equal(c.vars.OTHER, "kept");
  for (const bad of [
    { ...reference, value: "never-accepted" },
    { ...reference, binding: "VAULTS" },
    { ...reference, environment: "../production" },
  ])
    assert.throws(() => vaultConfiguration([bad], {}));
  assert.throws(
    () =>
      vaultConfiguration(
        [reference, { ...reference, binding: "OTHER", repository: "other" }],
        {},
      ),
    /Duplicate/,
  );
  assert.throws(
    () =>
      vaultConfiguration(
        [
          reference,
          { ...reference, binding: "OTHER", secretName: "different" },
        ],
        {},
      ),
    /Duplicate/,
  );
});
