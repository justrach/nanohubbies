import { mkdir, writeFile, rename, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
// The workspace build runs both CLI and web tasks. Each publishes this same
// directory; replacing complete files prevents concurrent truncation/zero fills.
async function atomicWrite(path, bytes) {
  const temporary = path + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
export async function buildDistribution(
  output = resolve(import.meta.dirname, "../../../apps/web/public/nh"),
) {
  const root = resolve(import.meta.dirname, ".."),
    { version } = await Bun.file(join(root, "package.json")).json();
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw Error("A stable CLI version is required");
  const release = join(output, "releases", version);
  await mkdir(release, { recursive: true });
  for (const [entry, path] of [
    [join(root, "bin/nh.mjs"), join(release, "nh.mjs")],
    [join(root, "install.mjs"), join(output, "install.mjs")],
  ]) {
    const built = await Bun.build({
      entrypoints: [entry],
      target: "bun",
      format: "esm",
      minify: false,
      sourcemap: "none",
    });
    if (!built.success)
      throw new AggregateError(built.logs, "CLI bundling failed");
    if (built.outputs.length !== 1)
      throw Error("Expected one portable CLI module");
    await atomicWrite(path, await built.outputs[0].arrayBuffer());
  }
  const bytes = await Bun.file(join(release, "nh.mjs")).bytes(),
    manifest = {
      format: 1,
      version,
      path: `/nh/releases/${version}/nh.mjs`,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  await atomicWrite(
    join(release, "SHA256SUMS"),
    `${manifest.sha256}  nh.mjs\n`,
  );
  await atomicWrite(
    join(output, "latest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  return manifest;
}
if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url))
  console.log(
    JSON.stringify(await buildDistribution(process.argv[2]), null, 2),
  );
