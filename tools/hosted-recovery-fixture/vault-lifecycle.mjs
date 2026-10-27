import assert from "node:assert/strict";
export const syntheticValue = (plan, revision) =>
  `synthetic-nanohub-recovery-${plan.runId}-${revision}`;

/** Wrangler's pinned CLI has no JSON list option for Secrets Store. Parse only
 * its explicit table headers, never an arbitrary UUID elsewhere in output. */
export function metadataRows(result, emptyAllowed = false) {
  if (result.code) {
    if (
      emptyAllowed &&
      /List request returned no secrets\./.test(
        result.stdout + result.stderr,
      ) &&
      !/10000|authentication|unauthorized/i.test(result.stdout + result.stderr)
    )
      return [];
    throw Error("Secrets Store metadata observation failed");
  }
  let columns;
  const rows = [];
  for (const line of result.stdout.replace(/\x1b\[[0-9;]*m/g, "").split("\n")) {
    if (!line.startsWith("│")) continue;
    const cells = line
      .split("│")
      .slice(1, -1)
      .map((x) => x.trim());
    if (cells.includes("Name") && cells.includes("ID")) {
      columns = cells;
      continue;
    }
    if (!columns) continue;
    if (cells.every((x) => !x)) continue;
    assert.equal(
      cells.length,
      columns.length,
      "Unexpected metadata table width",
    );
    const row = Object.fromEntries(columns.map((name, i) => [name, cells[i]]));
    assert.match(row.ID, /^[a-f0-9]{32}$/);
    assert.ok(row.Name);
    rows.push(row);
  }
  assert.ok(columns, "Secrets Store metadata table missing");
  assert.equal(new Set(rows.map((row) => row.ID)).size, rows.length);
  return rows;
}
export async function listProviderSecrets(plan, wrangler, config) {
  const rows = [];
  for (let page = 1; page <= 100; page++) {
    const result = await wrangler(
      [
        "secrets-store",
        "secret",
        "list",
        plan.storeId,
        "--remote",
        "--page",
        String(page),
        "--per-page",
        "100",
      ],
      config,
      { allowFailure: true },
    );
    const items = metadataRows(result, true);
    rows.push(...items);
    if (items.length < 100) {
      assert.equal(new Set(rows.map((x) => x.ID)).size, rows.length);
      return rows;
    }
  }
  throw Error("Secrets Store metadata pagination limit reached");
}
export function ownedSecret(rows, plan, record) {
  const matches = rows.filter((x) => x.Name === plan.providerSecretName);
  assert.ok(matches.length <= 1);
  const entry = matches[0];
  if (entry) {
    assert.equal(
      record.providerSecretRequested,
      true,
      "Refuse an unowned provider secret",
    );
    if (record.providerSecretId)
      assert.equal(
        entry.ID,
        record.providerSecretId,
        "Provider secret identity changed",
      );
  }
  return entry;
}
export function assertVaultBindings(metadata, plan) {
  const bindings = metadata.resources.bindings;
  const allowed = new Set([
    "VAULTS",
    "OBJECTS",
    "CF_VERSION_METADATA",
    "HOSTED_FIXTURE_EXPIRES",
    "HOSTED_REPO_RECOVERY",
    "HOSTED_BACKEND_KEY",
    "CLOUDFLARE_SECRET_SCOPES",
    "FIXTURE_SECRET",
  ]);
  assert.ok(Array.isArray(bindings));
  assert.equal(new Set(bindings.map((x) => x.name)).size, bindings.length);
  assert.ok(
    bindings.every((x) => allowed.has(x.name)),
    "Unexpected vault binding",
  );
  assert.equal(
    bindings.find((x) => x.name === "OBJECTS")?.bucket_name,
    plan.bucket,
  );
  const objects = bindings.filter((x) => x.type === "durable_object_namespace");
  assert.equal(objects.length, 1);
  assert.equal(objects[0].name, "VAULTS");
  assert.equal(objects[0].class_name, "Vault");
  assert.ok(
    !objects[0].script_name || objects[0].script_name === plan.vaultName,
  );
  const secret = bindings.find((x) => x.name === "FIXTURE_SECRET");
  assert.equal(secret?.type, "secrets_store_secret");
  assert.equal(secret.store_id, plan.storeId);
  assert.equal(secret.secret_name, plan.providerSecretName);
  assert.equal(bindings.filter((x) => x.type === "service").length, 0);
  assert.equal(
    bindings.find((x) => x.name === "HOSTED_FIXTURE_EXPIRES")?.text,
    String(plan.deadline),
  );
  assert.equal(
    bindings.find((x) => x.name === "HOSTED_REPO_RECOVERY")?.text,
    "1",
  );
  assert.equal(
    bindings.find((x) => x.name === "HOSTED_BACKEND_KEY")?.type,
    "secret_text",
  );
  assert.equal(metadata.resources.script_runtime.limits.subrequests, 50000);
  assert.equal(
    bindings.find((x) => x.name === "CLOUDFLARE_SECRET_SCOPES")?.text,
    plan.vault.vars.CLOUDFLARE_SECRET_SCOPES,
  );
}
