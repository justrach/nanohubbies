import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
const bundled = await build({
  entryPoints: [
    new URL("../src/repository/validate.ts", import.meta.url).pathname,
    new URL("../src/git.ts", import.meta.url).pathname,
  ],
  bundle: true,
  platform: "node",
  format: "esm",
  outdir: "/virtual",
  write: false,
});
const [validation, git] = await Promise.all(
  bundled.outputFiles.map(
    (file) =>
      import(
        "data:text/javascript;base64," +
          Buffer.from(file.text).toString("base64")
      ),
  ),
);
const { validateGraph } = validation,
  { encode, decode, tree, commit } = git;
const limits = { objectBytes: 1 << 20, totalBytes: 1 << 20, objects: 1000 };
function graph() {
  const objects = new Map(),
    add = (object) => {
      objects.set(object.sha, decode(object.raw));
      return object.sha;
    };
  const entries = Array.from({ length: 64 }, (_, i) => ({
    name: i === 0 ? "検証😀" : `file-${i}`,
    mode: i === 1 ? "100755" : i === 2 ? "120000" : "100644",
    sha: add(
      encode(
        "blob",
        Uint8Array.from([
          i,
          0,
          255,
          128,
          ...new TextEncoder().encode("fixture"),
        ]),
      ),
    ),
  }));
  const root = add(tree(entries)),
    signature = {
      name: "Fixture",
      email: "fixture@example.invalid",
      time: 1700000000,
    };
  const head = add(
    commit({
      tree: root,
      parents: [],
      author: signature,
      committer: signature,
      message: "Binary, modes, Unicode",
    }),
  );
  const tag = add(
    encode(
      "tag",
      new TextEncoder().encode(
        `object ${head}\ntype commit\ntag v1\ntagger Fixture <fixture@example.invalid> 1700000000 +0000\n\nAnnotated\n`,
      ),
    ),
  );
  return {
    objects,
    roots: [
      { sha: head, type: "commit" },
      { sha: tag, type: "tag" },
      { sha: head, type: "commit" },
    ],
    head,
    leaf: entries[5].sha,
  };
}
function delayed(objects, change = (value) => value) {
  let active = 0,
    peak = 0;
  const reads = new Map();
  return {
    get: async (sha) => {
      active++;
      peak = Math.max(peak, active);
      reads.set(sha, (reads.get(sha) ?? 0) + 1);
      try {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return change(objects.get(sha) ?? null, sha);
      } finally {
        active--;
      }
    },
    active: () => active,
    peak: () => peak,
    reads,
  };
}
test("bounded read-ahead checks exactly the same complete binary/mode/tag graph and deduplicates reads", async () => {
  const f = graph(),
    serial = delayed(f.objects),
    parallel = delayed(f.objects);
  const expected = await validateGraph(serial.get, f.roots, limits, 1),
    actual = await validateGraph(parallel.get, f.roots, limits, 2);
  assert.deepEqual(actual, expected);
  assert.equal(actual.size, f.objects.size);
  assert.equal(serial.peak(), 1);
  assert.equal(parallel.peak(), 2);
  assert.equal(parallel.active(), 0);
  assert.ok([...parallel.reads.values()].every((count) => count === 1));
});
for (const mode of [1, 2]) {
  test(`read-ahead ${mode} refuses missing, corrupt and mistyped objects`, async () => {
    const f = graph();
    for (const replace of [
      () => null,
      (object) => ({ ...object, body: new Uint8Array([9]) }),
      (object) => ({ ...object, type: "commit" }),
    ]) {
      const io = delayed(f.objects, (object, sha) =>
        sha === f.leaf ? replace(object) : object,
      );
      await assert.rejects(
        validateGraph(io.get, f.roots, limits, mode),
        /Missing or invalid object/,
      );
      assert.equal(io.active(), 0);
    }
    const io = delayed(f.objects);
    await assert.rejects(
      validateGraph(
        io.get,
        [...f.roots, { sha: f.head, type: "blob" }],
        limits,
        mode,
      ),
      /Wrong object type/,
    );
    assert.equal(io.active(), 0);
  });
  test(`read-ahead ${mode} preserves object, expanded-byte and per-object limits`, async () => {
    const f = graph();
    for (const override of [
      { objects: 4 },
      { totalBytes: 20 },
      { objectBytes: 3 },
    ]) {
      const io = delayed(f.objects);
      await assert.rejects(
        validateGraph(io.get, f.roots, { ...limits, ...override }, mode),
        /exceeds configured/,
      );
      assert.equal(io.active(), 0);
    }
  });
  test(`read-ahead ${mode} preserves LFS, unsupported submodule and path rejection`, async () => {
    for (const bad of ["lfs", "submodule", "path"]) {
      const f = graph(),
        body = new TextEncoder().encode(
          bad === "lfs"
            ? "version https://git-lfs.github.com/spec/v1\noid sha256:abc\n"
            : "data",
        ),
        blob = encode("blob", body);
      f.objects.set(blob.sha, decode(blob.raw));
      const t = tree([
        {
          name: bad === "path" ? ".git" : "file",
          mode: bad === "submodule" ? "160000" : "100644",
          sha: blob.sha,
        },
      ]);
      f.objects.set(t.sha, decode(t.raw));
      const io = delayed(f.objects);
      await assert.rejects(
        validateGraph(io.get, [{ sha: t.sha, type: "tree" }], limits, mode),
        /LFS|Unsupported/,
      );
      assert.equal(io.active(), 0);
    }
  });
}
test("speculative failures are drained without unhandled rejection or I/O after a failed graph", async () => {
  const f = graph();
  let active = 0;
  const get = async (sha) => {
    active++;
    try {
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (sha === f.head || sha === f.roots[1].sha) throw Error("read failure");
      return f.objects.get(sha);
    } finally {
      active--;
    }
  };
  await assert.rejects(validateGraph(get, f.roots, limits, 2), /read failure/);
  assert.equal(active, 0);
});
test("invalid concurrency and object identifiers fail before any I/O", async () => {
  let calls = 0;
  const get = async () => {
    calls++;
    return null;
  };
  await assert.rejects(validateGraph(get, [], limits, 3), /concurrency/);
  await assert.rejects(
    validateGraph(get, [{ sha: "invalid" }], limits, 2),
    /Invalid object ID/,
  );
  assert.equal(calls, 0);
});
