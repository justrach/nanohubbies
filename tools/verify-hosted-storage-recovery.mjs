/** Uses the same resumable isolation and cleanup lifecycle as hosted Git acceptance. */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { verifyHostedGitImport } from "./verify-hosted-git-import.mjs";
const args = process.argv.slice(2);
if (args[0] === "--cleanup") {
  assert.equal(args.length, 2);
  await verifyHostedGitImport(
    undefined,
    undefined,
    undefined,
    args[1],
    "storage-recovery",
  );
} else {
  assert.equal(
    args.length,
    2,
    "Use absolute account config and private artifact directory paths",
  );
  await verifyHostedGitImport(
    args[0],
    resolve(import.meta.dirname, ".."),
    args[1],
    undefined,
    "storage-recovery",
  );
}
