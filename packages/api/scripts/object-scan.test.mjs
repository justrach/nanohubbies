import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
const output = await build({
  entryPoints: [
    new URL("../src/objects.ts", import.meta.url).pathname,
    new URL("../src/packfile.ts", import.meta.url).pathname,
    new URL("../src/git.ts", import.meta.url).pathname,
  ],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  outdir: "/virtual",
});
const [{ ObjectReader }, { buildPack, packEntry, packKey }, { encode }] =
  await Promise.all(
    output.outputFiles.map(
      (file) =>
        import(
          "data:text/javascript;base64," +
            Buffer.from(file.text).toString("base64")
        ),
    ),
  );
function pack(seed, count, size) {
  const objects = Array.from({ length: count }, (_, i) => {
    const body = new Uint8Array(size).fill((seed + i) % 255);
    body[0] = i;
    const encoded = encode("blob", body);
    return { sha: encoded.sha, body };
  });
  const built = buildPack(objects.map((o) => packEntry(o.sha, "blob", o.body)));
  return { ...built, objects };
}
function fixture(packs, scan) {
  const bytes = new Map(),
    reads = [];
  for (const p of packs) {
    bytes.set(packKey("fixture", p.name, "pack"), p.pack);
    bytes.set(packKey("fixture", p.name, "idx"), p.idx);
  }
  const bucket = {
    async get(key, options) {
      reads.push({ key, range: !!options?.range });
      await new Promise((resolve) => setImmediate(resolve));
      const body = bytes.get(key);
      if (!body) return null;
      const selected = options?.range
        ? body.slice(
            options.range.offset,
            options.range.offset + options.range.length,
          )
        : body.slice();
      return { size: body.length, arrayBuffer: async () => selected.buffer };
    },
  };
  const reader = new ObjectReader(
    bucket,
    "fixture",
    async () => packs.map((p) => ({ name: p.name, bytes: p.pack.length })),
    scan,
  );
  return {
    reader,
    bucket,
    reads,
    bytes,
    packReads: () => reads.filter((r) => r.key.endsWith(".pack")),
  };
}
test("request-scoped scans reuse one whole import pack across concurrent cold object reads", async () => {
  const p = pack(10, 12, 64 << 10),
    f = fixture([p], true);
  await f.reader.prepare();
  const results = await Promise.all(p.objects.map((o) => f.reader.get(o.sha)));
  for (let i = 0; i < results.length; i++) {
    assert.equal(results[i].type, "blob");
    assert.deepEqual(results[i].body, p.objects[i].body);
  }
  assert.equal(f.packReads().length, 1);
  assert.equal(f.packReads()[0].range, false);
});
test("ordinary readers retain range fetches rather than downloading a larger pack", async () => {
  const p = pack(20, 6, 64 << 10),
    f = fixture([p], false);
  await f.reader.prepare();
  for (const o of p.objects)
    assert.deepEqual((await f.reader.get(o.sha)).body, o.body);
  assert.equal(f.packReads().length, 6);
  assert.ok(f.packReads().every((r) => r.range));
});
test("scan cache evicts by its 16 MiB byte budget and refreshes LRU position", async () => {
  const packs = Array.from({ length: 6 }, (_, i) => pack(30 + i, 1, 3 << 20)),
    f = fixture(packs, true);
  await f.reader.prepare();
  for (const p of packs.slice(0, 5)) await f.reader.get(p.objects[0].sha);
  assert.equal(f.packReads().length, 5);
  await f.reader.get(packs[0].objects[0].sha);
  assert.equal(f.packReads().length, 5);
  await f.reader.get(packs[5].objects[0].sha);
  assert.equal(f.packReads().length, 6);
  await f.reader.get(packs[0].objects[0].sha);
  assert.equal(f.packReads().length, 6, "recent pack remains cached");
  await f.reader.get(packs[1].objects[0].sha);
  assert.equal(
    f.packReads().length,
    7,
    "older pack evicted rather than exceeding budget",
  );
});
test("packs over four MiB stay ranged during scans", async () => {
  const p = pack(50, 2, 3 << 20),
    f = fixture([p], true);
  await f.reader.prepare();
  for (const o of p.objects)
    assert.deepEqual((await f.reader.get(o.sha)).body, o.body);
  assert.equal(f.packReads().length, 2);
  assert.ok(f.packReads().every((r) => r.range));
});
test("failed shared pack loads can retry and truncated packs are rejected", async () => {
  const p = pack(70, 8, 64 << 10),
    f = fixture([p], true);
  await f.reader.prepare();
  const key = packKey("fixture", p.name, "pack");
  f.bytes.set(key, new Uint8Array(5));
  const errors = await Promise.allSettled(
    p.objects.slice(0, 2).map((o) => f.reader.get(o.sha)),
  );
  assert.ok(
    errors.every(
      (e) =>
        e.status === "rejected" && /length mismatch/.test(e.reason.message),
    ),
  );
  assert.equal(f.packReads().length, 1);
  f.bytes.set(key, p.pack);
  assert.deepEqual(
    (await f.reader.get(p.objects[0].sha)).body,
    p.objects[0].body,
  );
  assert.equal(f.packReads().length, 2);
});
test("ordinary shared readers never reuse an in-flight platform promise across calls", async () => {
  const p = pack(80, 2, 16 << 10),
    f = fixture([p], false);
  await f.reader.prepare();
  await Promise.all(p.objects.map((o) => f.reader.get(o.sha)));
  assert.equal(f.packReads().length, 2);
});
test("a mismatched stored size is canceled before allocating a whole pack", async () => {
  const p = pack(90, 8, 64 << 10),
    f = fixture([p], true);
  await f.reader.prepare();
  let allocated = false,
    canceled = false;
  f.bucket.get = async () => ({
    size: p.pack.length + 1,
    body: {
      cancel: async () => {
        canceled = true;
      },
    },
    arrayBuffer: async () => {
      allocated = true;
      throw Error("must not allocate");
    },
  });
  await assert.rejects(f.reader.get(p.objects[0].sha), /length mismatch/);
  assert.equal(allocated, false);
  assert.equal(canceled, true);
});
