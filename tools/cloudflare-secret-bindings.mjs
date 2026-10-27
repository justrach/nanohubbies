import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/** This tool handles references only. Secret values go directly to Cloudflare. */
export function vaultConfiguration(entries, base) {
  if (!Array.isArray(entries) || entries.length > 1000)
    throw Error("Expected an array of at most 1000 secret references");
  const scopes = {},
    targets = new Set(),
    providerSecrets = new Set();
  const allowed = new Set([
    "binding",
    "storeId",
    "secretName",
    "repository",
    "environment",
    "name",
  ]);
  const bindings = entries.map((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      Object.keys(entry).some((k) => !allowed.has(k))
    )
      throw Error("Manifest accepts reference metadata only");
    const { binding, storeId, secretName, repository, environment, name } =
      entry;
    if (
      ![binding, name].every(
        (v) => typeof v === "string" && /^[A-Z_][A-Z0-9_]{0,127}$/.test(v),
      ) ||
      ["VAULTS", "CLOUDFLARE_SECRET_SCOPES"].includes(binding) ||
      !/^[a-f0-9]{32}$/.test(storeId) ||
      typeof secretName !== "string" ||
      !/^[a-zA-Z0-9_-]{1,255}$/.test(secretName) ||
      typeof repository !== "string" ||
      !/^[a-z0-9][a-z0-9-]{0,62}$/.test(repository) ||
      typeof environment !== "string" ||
      !/^[a-z][a-z0-9-]{0,31}$/.test(environment)
    )
      throw Error("Invalid secret reference metadata");
    const target = `${repository}/${environment}/${name}`,
      provider = `${storeId}/${secretName}`;
    if (
      Object.hasOwn(scopes, binding) ||
      targets.has(target) ||
      providerSecrets.has(provider)
    )
      throw Error(
        "Duplicate binding, repository secret or shared Cloudflare value",
      );
    scopes[binding] = { repository, environment, name };
    targets.add(target);
    providerSecrets.add(provider);
    return { binding, store_id: storeId, secret_name: secretName };
  });
  const encoded = JSON.stringify(scopes);
  if (Buffer.byteLength(encoded) > 32 * 1024)
    throw Error(
      "Secret scope metadata exceeds 32 KiB; split the vault deployment",
    );
  return {
    ...base,
    vars: { ...base.vars, CLOUDFLARE_SECRET_SCOPES: encoded },
    secrets_store_secrets: bindings,
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [manifest, output] = process.argv.slice(2);
  if (!manifest || !output || process.argv.length !== 4)
    throw Error(
      "Usage: node tools/cloudflare-secret-bindings.mjs references.json packages/vault/wrangler.secrets.jsonc",
    );
  const base = JSON.parse(
    await readFile(
      new URL("../packages/vault/wrangler.jsonc", import.meta.url),
      "utf8",
    ),
  );
  // An absolute entry point keeps the generated config independent of output location.
  base.main = fileURLToPath(
    new URL("../packages/vault/src/index.ts", import.meta.url),
  );
  delete base.$schema;
  const config = vaultConfiguration(
    JSON.parse(await readFile(manifest, "utf8")),
    base,
  );
  await writeFile(output, JSON.stringify(config, null, 2) + "\n", {
    mode: 0o600,
  });
  console.log(
    `Wrote ${config.secrets_store_secrets.length} scoped Cloudflare bindings to ${output}; no values read or written`,
  );
}
