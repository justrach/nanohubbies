import { test, expect } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { buildDistribution } from "../scripts/build.mjs";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
test("portable help explains the branch rename grant and retained role/lock restrictions without credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nh-branch-help-"));
  try {
    const manifest = await buildDistribution(directory),
      module = join(directory, manifest.path.replace(/^\/nh\//, "")),
      child = Bun.spawn([process.execPath, module, "--help"], {
        cwd: directory,
        env: { PATH: process.env.PATH, HOME: directory, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
    const [code, help, error] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect({ code, error }).toEqual({ code: 0, error: "" });
    expect(help).toContain("branch rename OLD NEW");
    expect(help).toContain("Branch renames require branches:write.");
    expect(help).toContain("default or protected branches require current admin access.");
    expect(help).toContain("Locks still apply.");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("API, web and unrelated working directories publish identical release bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nh-reproducible-build-")),
    root = resolve(import.meta.dirname, "../../.."),
    builder = resolve(import.meta.dirname, "../scripts/build.mjs");
  try {
    const builds = await Promise.allSettled(
      [root, join(root, "packages/api"), join(root, "apps/web"), directory].map(
        async (cwd, index) => {
          const output = join(directory, String(index)),
            child = Bun.spawn([process.execPath, builder, output], {
              cwd,
              stdout: "pipe",
              stderr: "pipe",
            }),
            [exit, stdout, stderr] = await Promise.all([
              child.exited,
              new Response(child.stdout).text(),
              new Response(child.stderr).text(),
            ]);
          expect({ exit, stderr }).toEqual({ exit: 0, stderr: "" });
          const manifest = JSON.parse(stdout),
            module = await readFile(
              join(output, manifest.path.replace(/^\/nh\//, "")),
            );
          expect(module.length).toBe(manifest.bytes);
          expect(digest(module)).toBe(manifest.sha256);
          expect(
            JSON.parse(await readFile(join(output, "latest.json"), "utf8")),
          ).toEqual(manifest);
          expect(
            await readFile(
              join(output, "releases", manifest.version, "SHA256SUMS"),
              "utf8",
            ),
          ).toBe(`${manifest.sha256}  nh.mjs\n`);
          return {
            manifest,
            installer: digest(await readFile(join(output, "install.mjs"))),
          };
        },
      ),
    );
    for (const built of builds) {
      if (built.status === "rejected") throw built.reason;
      expect(built.value).toEqual(builds[0].value);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
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
