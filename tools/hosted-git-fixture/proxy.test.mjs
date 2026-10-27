import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { gzipSync, brotliCompressSync } from "node:zlib";
import { gitProxy } from "./proxy.mjs";
import { bucketExists } from "./observations.mjs";
import { safeTrace } from "./trace.mjs";

test("runtime trace drops request credentials and arbitrary console/exception content", () => {
  const secret = "private-control-and-git-credential";
  const result = safeTrace({
    outcome: "ok",
    event: {
      request: { headers: { authorization: secret } },
      response: { status: 200 },
    },
    logs: [
      { message: [secret] },
      { message: ["nanohub-fixture-git-reads", "1000", "321", "2", "0"] },
    ],
    exceptions: [{ message: secret }],
    cpuTime: 15,
  });
  assert.deepEqual(result.reads, [[1000, 321, 2, 0]]);
  assert.equal(result.status, 200);
  assert.equal(result.exceptions, 1);
  assert.equal(JSON.stringify(result).includes(secret), false);
});
test("Git bridge forwards decompressed gzip/brotli bytes without stale length or encoding", async () => {
  let calls = 0;
  const pack = Buffer.from("binary pack \0".repeat(1000));
  const server = createServer((req, res) => {
    calls++;
    assert.equal(req.headers["x-nanohub-hosted-fixture"], "private-control");
    assert.equal(req.headers.authorization, "Basic synthetic");
    const br = req.url.endsWith("/br"),
      body = br ? brotliCompressSync(pack) : gzipSync(pack);
    res.writeHead(200, {
      "Content-Encoding": br ? "br" : "gzip",
      "Content-Length": body.length,
      "Content-Type": "application/x-git-packed-objects",
    });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const proxy = await gitProxy({
    origin: "http://127.0.0.1:" + server.address().port,
    authorization: "Basic synthetic",
    control: "private-control",
    repositoryPath: "/git/test/repo.git",
  });
  try {
    for (const encoding of ["gzip", "br"]) {
      const response = await fetch(
        proxy.origin + "/git/test/repo.git/" + encoding,
        { headers: { Authorization: "Basic synthetic" } },
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-encoding"), null);
      assert.equal(response.headers.get("content-length"), null);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), pack);
    }
    assert.equal(
      (await fetch(proxy.origin + "/git/test/repo.git/HEAD")).status,
      401,
    );
    assert.equal(
      (
        await fetch(proxy.origin + "/__fixture/session", {
          headers: { Authorization: "Basic synthetic" },
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await fetch(proxy.origin + "/git/other/repo.git/HEAD", {
          headers: { Authorization: "Basic synthetic" },
        })
      ).status,
      404,
    );
    assert.equal(calls, 2);
    assert.deepEqual(proxy.traffic(), { objectUploads: 0, refPublications: 0 });
    for (const suffix of ["/nanohub-import/objects", "/git-receive-pack"])
      await (
        await fetch(proxy.origin + "/git/test/repo.git" + suffix, {
          method: "POST",
          headers: { Authorization: "Basic synthetic" },
          body: "synthetic",
        })
      ).arrayBuffer();
    assert.deepEqual(proxy.traffic(), { objectUploads: 1, refPublications: 1 });
  } finally {
    await proxy.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
test("bucket absence requires an exact missing-bucket response, never a partial listing or authorization failure", () => {
  const name = "nh-git-live-example-objects";
  assert.equal(
    bucketExists(
      { code: 0, stdout: "name:  " + name + "\nbucket_size: 0 B", stderr: "" },
      name,
    ),
    true,
  );
  assert.equal(
    bucketExists(
      {
        code: 1,
        stdout: "",
        stderr: "The specified bucket does not exist. [code: 10006]",
      },
      name,
    ),
    false,
  );
  for (const result of [
    { code: 0, stdout: "Listing buckets...\nname: other", stderr: "" },
    { code: 1, stdout: "", stderr: "Unauthorized [code: 10000]" },
    { code: 1, stdout: "", stderr: "Network unavailable" },
  ])
    assert.throws(() => bucketExists(result, name));
});
test("closing the bridge aborts an active upstream response and drains local connections", async () => {
  let entered;
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  let closed;
  const disconnected = new Promise((resolve) => {
    closed = resolve;
  });
  const server = createServer((req, res) => {
    res.writeHead(200);
    res.write("begin");
    req.on("close", closed);
    entered();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const proxy = await gitProxy({
    origin: "http://127.0.0.1:" + server.address().port,
    authorization: "Basic synthetic",
    control: "private-control",
    repositoryPath: "/git/test/repo.git",
  });
  try {
    const response = fetch(proxy.origin + "/git/test/repo.git/HEAD", {
      headers: { Authorization: "Basic synthetic" },
    })
      .then((r) => r.text())
      .catch(() => null);
    await ready;
    await proxy.close();
    await Promise.race([
      disconnected,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(Error("Upstream connection still open")),
          1000,
        ).unref(),
      ),
    ]);
    await response;
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
