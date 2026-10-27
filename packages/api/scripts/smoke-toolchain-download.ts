/** Explicit real-provider acceptance of trusted image preparation, using a
 * tiny synthetic image. Never runs candidate code or registers a CI runner. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve, join } from "node:path";
import { Codegraff, allocateSandbox } from "../../../tools/codegraff-actions.mjs";
import { toolchain } from "../../../tools/toolchain.mjs";

if (process.env.NANOHUB_LIVE_CODEGRAFF !== "1" || !process.env.CODEGRAFF_API_KEY)
  throw Error("Explicit live opt-in and an existing sandbox-scoped control key are required");
const [configPath, artifactPath] = process.argv.slice(2);
const sourceRoot = resolve(import.meta.dirname, "../../..");
if (![configPath, artifactPath].every(path => path && isAbsolute(path) && resolve(path) !== sourceRoot && !resolve(path).startsWith(sourceRoot + "/")))
  throw Error("Use absolute trusted configuration and private artifact paths outside the checkout");
const config = JSON.parse(await readFile(configPath, "utf8"));
assert.equal(config.syntheticFixture, true);
const selected = toolchain(config.image, undefined, undefined, config.imageDownload);
assert.ok(selected.download && selected.download.bytes <= 1024 * 1024, "Only a tiny synthetic image is allowed in this probe");
await mkdir(artifactPath, { recursive: true, mode: 0o700 });
const receiptPath = join(artifactPath, "sandbox.json"), client = new Codegraff(process.env.CODEGRAFF_API_KEY);
const record: Record<string, unknown> = {
  startedAt: new Date().toISOString(), syntheticImage: true, hostedNanohub: false,
  candidateUploaded: false, cleanupNeeded: true,
  image: selected.image, archiveSha256: selected.download.sha256, archiveBytes: selected.download.bytes,
};
const save = () => writeFile(receiptPath, JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
await save();
let sandbox: string | undefined;
try {
  const allocated = await allocateSandbox(client, { provider: "fleet", cpu: 2, memory: 4, disk: 10, autoStopMinutes: 15 }, Date.now() + 5 * 60000);
  assert.match(allocated.id, /^[A-Za-z0-9_-]{1,160}$/);
  sandbox = allocated.id; record.sandboxId = sandbox; await save();
  await client.ready(sandbox, Date.now() + 5 * 60000);
  await client.exec(sandbox, "command -v curl && docker version --format '{{.Server.Version}}'");
  await client.downloadImage(sandbox, selected.download, Date.now() + 3 * 60000);
  await client.loadImage(sandbox, "/workspace/nanohub-toolchain/image.tar", Date.now() + 3 * 60000);
  assert.equal((await client.exec(sandbox, `docker image inspect --format '{{.Id}}' '${selected.image}'`)).trim(), selected.image);
  await client.exec(sandbox, "test ! -e /tmp/SHOULD_NOT_EXIST && test ! -e /tmp/nanohub-image-download.sh");
  record.downloadAndLoadVerified = true; record.privateControlScriptRemoved = true;
  const checks: string[] = [];
  for (const kind of ["digest", "length", "redirect", "overflow"]) {
    const descriptor = { ...selected.download };
    if (kind === "digest") descriptor.sha256 = "0".repeat(64);
    if (kind === "length") descriptor.bytes++;
    if (kind === "redirect" || kind === "overflow") {
      const url = new URL(descriptor.url); url.pathname = "/" + kind; descriptor.url = url.href;
    }
    await assert.rejects(client.downloadImage(sandbox, descriptor, Date.now() + 60000), error =>
      error instanceof Error && /digest verification failed/.test(error.message) && !error.message.includes("synthetic-toolchain-read"));
    await client.exec(sandbox, "test ! -e /workspace/nanohub-toolchain/image.tar && test ! -e /tmp/nanohub-image-download.sh");
    if (kind === "overflow") {
      const size = Number((await client.exec(sandbox, "wc -c < /workspace/nanohub-toolchain/image.part")).trim());
      assert.ok(size <= descriptor.bytes + 1); record.overflowBytesWritten = size;
    }
    checks.push(kind);
  }
  record.rejected = checks;
  record.completedAt = new Date().toISOString();
} catch (error) {
  record.failed = true;
  // Control errors are deliberately generic. Never persist a signed URL.
  record.error = String(error).replaceAll(selected.download.url, "[redacted archive URL]");
  throw error;
} finally {
  if (sandbox) {
    try { await client.destroy(sandbox); record.cleanupNeeded = false; record.deletionConfirmed = true; }
    catch { record.cleanupError = "Sandbox deletion was not confirmed"; }
  }
  await save();
}
assert.equal(record.cleanupNeeded, false);
assert.ok(!JSON.stringify(record).includes("synthetic-toolchain-read"));
console.log("PASS: fresh Codegraff VM downloads and loads an exact synthetic image; digest/length/redirect/overflow refusal, bounded writes, private control-script cleanup and confirmed VM destruction");
