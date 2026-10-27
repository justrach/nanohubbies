import { test, expect } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { buildDistribution } from "../scripts/build.mjs";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
test("concurrent workspace builds expose only complete CLI, installer and manifest files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nh-concurrent-build-"));
  try {
    const baseline = await buildDistribution(directory),
      module = join(directory, baseline.path.replace(/^\/nh\//, "")),
      installer = join(directory, "install.mjs"),
      installerHash = digest(await readFile(installer));
    let remaining = 8,
      observations = 0;
    const builds = Array.from({ length: remaining }, () =>
      buildDistribution(directory).finally(() => remaining--),
    );
    try {
      while (remaining) {
        expect(digest(await readFile(module))).toBe(baseline.sha256);
        expect(digest(await readFile(installer))).toBe(installerHash);
        expect(
          JSON.parse(await readFile(join(directory, "latest.json"), "utf8")),
        ).toEqual(baseline);
        observations++;
      }
    } finally {
      await Promise.all(builds);
    }
    expect(observations).toBeGreaterThan(0);
    for (const built of await Promise.all(builds))
      expect(built).toEqual(baseline);
    expect(
      await readFile(
        join(directory, "releases", baseline.version, "SHA256SUMS"),
        "utf8",
      ),
    ).toBe(`${baseline.sha256}  nh.mjs\n`);
    expect(
      (await readdir(directory, { recursive: true })).some((name) =>
        name.endsWith(".tmp"),
      ),
    ).toBe(false);
    const child = Bun.spawn([process.execPath, module, "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await child.exited).toBe(0);
    expect((await new Response(child.stdout).text()).trim()).toBe(
      `nh ${baseline.version}`,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
