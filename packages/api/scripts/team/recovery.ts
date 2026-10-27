/** Test-only physical recovery. These are Miniflare files, never Cloudflare exports. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { teamFixture } from "./fixture.ts";

const resources = ["do", "d1", "r2"] as const;
type File = { path: string; bytes: number; sha256: string };

async function inventory(directory: string): Promise<File[]> {
  const files: File[] = [];
  async function visit(relative: string) {
    for (const entry of await readdir(join(directory, relative), { withFileTypes: true })) {
      const path = relative ? relative + "/" + entry.name : entry.name;
      if (entry.isDirectory()) await visit(path);
      else {
        assert.ok(entry.isFile(), "Recovery snapshots cannot contain links or special files");
        const bytes = await readFile(join(directory, path));
        files.push({ path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
      }
    }
  }
  await visit("");
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function recoveryFixture(f: Awaited<ReturnType<typeof teamFixture>>) {
  let sequence = 0;
  return {
    async checkpoint() {
      const directory = join(f.dir, "recovery", String(++sequence));
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await f.offlineStorage(async state => {
        for (const resource of resources)
          await cp(join(state, resource), join(directory, resource), { recursive: true, errorOnExist: true, force: false });
      });
      // The expected digest lives outside the snapshot. A rewritten manifest
      // cannot make a damaged snapshot valid. No provider secret value is copied.
      const expected = await inventory(directory);
      assert.ok(expected.some(file => file.path.startsWith("do/")));
      assert.ok(expected.some(file => file.path.startsWith("d1/")));
      assert.ok(expected.some(file => file.path.startsWith("r2/")));
      return {
        directory,
        files: expected.map(file => ({ ...file })),
        async restore() {
          assert.deepEqual(await inventory(directory), expected, "Recovery snapshot integrity mismatch");
          await f.offlineStorage(async state => {
            // Check again while stopped, before removing anything. Callers use
            // only their private synthetic directory, with no concurrent writer.
            assert.deepEqual(await inventory(directory), expected, "Recovery snapshot integrity mismatch");
            for (const resource of [...resources, "cache"])
              await rm(join(state, resource), { recursive: true, force: true });
            for (const resource of resources)
              await cp(join(directory, resource), join(state, resource), { recursive: true, errorOnExist: true, force: false });
            for (const file of expected) {
              const bytes = await readFile(join(state, file.path));
              assert.equal(bytes.length, file.bytes);
              assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256);
            }
          });
        },
        async contains(value: string) {
          const needle = Buffer.from(value);
          for (const file of expected)
            if ((await readFile(join(directory, file.path))).includes(needle)) return true;
          return false;
        },
      };
    },
    async loseApplicationStorage() {
      await f.offlineStorage(async state => {
        for (const resource of [...resources, "cache"])
          await rm(join(state, resource), { recursive: true, force: true });
      });
    },
  };
}
