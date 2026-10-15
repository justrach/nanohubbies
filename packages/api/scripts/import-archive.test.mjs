import test from "node:test";
import assert from "node:assert/strict";
import { readArchive } from "../src/import/archive.ts";
function header(path, size, type = "0") {
  const h = Buffer.alloc(512);
  h.write(path, 0, 100);
  h.write("0000644\0", 100);
  h.write(size.toString(8).padStart(11, "0") + "\0", 124);
  h.write(type, 156);
  h.fill(32, 148, 156);
  h.write("ustar\0", 257);
  const sum = h.reduce((a, b) => a + b, 0);
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  return h;
}
function entry(path, value, type = "0") {
  const body = Buffer.from(value);
  return [header(path, body.length, type), body, Buffer.alloc((512 - body.length % 512) % 512)];
}
function pax(key, value) {
  const record = `${key}=${value}\n`;
  let length = Buffer.byteLength(record) + 2;
  while (String(length).length + 1 + Buffer.byteLength(record) !== length)
    length = String(length).length + 1 + Buffer.byteLength(record);
  return `${length} ${record}`;
}
function stream(chunks) {
  return new ReadableStream({
    async pull(controller) {
      const chunk = await chunks.next();
      if (chunk.done) controller.close(); else controller.enqueue(chunk.value);
    },
    cancel() { return chunks.return?.(); },
  });
}
function* pieces(chunks) {
  for (const chunk of chunks) for (let at = 0; at < chunk.length; at += 71) yield chunk.subarray(at, at + 71);
}
test("streams past a 70 MiB asset and retains following source without archive buffering", async () => {
  let ended = false;
  function* archive() {
    try {
      yield header("root/big.png", 70 * 1024 * 1024);
      const bytes = new Uint8Array(64 * 1024);
      for (let i = 0; i < 1120; i++) yield bytes;
      yield* entry("root/src/main.ts", "export const answer = 42;\n");
      yield Buffer.alloc(1024);
    } finally { ended = true; }
  }
  const got = await readArchive(stream(archive()));
  assert.equal(got.skipped, 1);
  assert.deepEqual(got.files, [{ path: "src/main.ts", text: "export const answer = 42;\n" }]);
  assert.equal(ended, true);
});
test("split tar headers and UTF-8 pax path records preserve names and origin commit", async () => {
  const path = "src/" + "日本語".repeat(25) + ".ts";
  const sha = "a".repeat(40);
  const got = await readArchive(stream(pieces([
    ...entry("pax", pax("comment", sha), "g"),
    ...entry("pax", pax("path", "root/" + path), "x"),
    ...entry("root/short", "hello\n"),
    ...entry("root/dist/bundle.js", "ignored"),
    ...entry("root/image.bin", Buffer.from([0,1,2])),
    Buffer.alloc(1024),
  ])));
  assert.equal(got.commit, sha);
  assert.equal(got.skipped, 2);
  assert.deepEqual(got.files, [{ path, text: "hello\n" }]);
});
test("truncation, checksum errors, traversal and duplicate paths fail instead of seeding corrupt data", async () => {
  await assert.rejects(readArchive(stream(pieces([header("root/a", 100), Buffer.from("short")]))), /ended/);
  const broken = header("root/a", 1); broken[0] = 1;
  await assert.rejects(readArchive(stream(pieces([broken]))), /checksum/);
  await assert.rejects(readArchive(stream(pieces(entry("root/../escape", "x")))), /unsafe path/);
  await assert.rejects(readArchive(stream(pieces([...entry("root/a", "x"), ...entry("root/a", "y")]))), /duplicate/);
});
test("retained text budget is independent of streamed asset bytes and cancels on failure", async () => {
  let cancelled = false;
  function* archive() {
    try { yield* entry("root/a", "too much source"); yield Buffer.alloc(1024); }
    finally { cancelled = true; }
  }
  await assert.rejects(readArchive(stream(archive()), 3), /source-content budget/);
  assert.equal(cancelled, true);
});
test("streaming sink applies backpressure without retaining a source array", async () => {
  function* archive() {
    for (let i = 0; i < 48; i++) yield* entry(`root/src/${i}.txt`, "x".repeat(200000));
    yield Buffer.alloc(1024);
  }
  let count = 0, active = false;
  const got = await readArchive(stream(archive()), 16 * 1024 * 1024, async (file, progress) => {
    assert.equal(active, false);
    active = true;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(file.path, `src/${count}.txt`);
    assert.equal(progress.count, ++count);
    active = false;
  });
  assert.equal(count, 48);
  assert.equal(got.count, 48);
  assert.ok(got.bytes > 8 * 1024 * 1024);
  assert.deepEqual(got.files, []);
});
test("a failed durable sink cancels the archive", async () => {
  let cancelled = false;
  function* archive() {
    try { yield* entry("root/a", "hello"); yield Buffer.alloc(1024); }
    finally { cancelled = true; }
  }
  await assert.rejects(readArchive(stream(archive()), 1024, async () => { throw new Error("storage failed"); }), /storage failed/);
  assert.equal(cancelled, true);
});
