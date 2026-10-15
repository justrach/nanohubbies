// Stream a real local Git archive, seed isolated storage, then clone and fsck.
// Usage: node scripts/smoke-import.ts /path/to/local/repository
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { readArchive } from "../src/import/archive.ts";
import { base, boot, dir, exec, mf, ok, origin } from "./room/harness.ts";

const repository = process.argv[2];
if (!repository) throw new Error("Pass the local Git repository to validate");
const archive = spawn("git", ["-C", repository, "archive", "--format=tar", "--prefix=source/", "HEAD"], { stdio: ["ignore", "pipe", "inherit"] });
const done = new Promise<void>((resolve, reject) => {
  archive.once("error", reject);
  archive.once("exit", code => code === 0 ? resolve() : reject(new Error(`git archive exited ${code}`)));
});
try {
  const imported = await readArchive(Readable.toWeb(archive.stdout) as ReadableStream<Uint8Array>);
  await done;
  assert.ok(imported.files.length > 0);
  console.log(`Streamed ${imported.files.length} text files; excluded ${imported.skipped} unsupported files`);
  await boot();
  await ok("POST", base, { files: imported.files });
  const clone = join(dir, "clone");
  await exec("git", ["clone", "-q", `${origin}/git/room-test.git`, clone]);
  await exec("git", ["-C", clone, "fsck", "--full"]);
  for (const file of imported.files) {
    assert.equal(await readFile(join(clone, file.path), "utf8"), file.text, file.path);
  }
  console.log("ok: every retained file matches after Worker seeding, R2 publication and real git clone; fsck passes");
} finally {
  archive.kill();
  await done.catch(() => {});
  if (mf) await mf.dispose();
  await rm(dir, { recursive: true, force: true });
}
