import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { gzipSync, brotliCompressSync } from "node:zlib";
import { gitProxy } from "./proxy.mjs";
import { bucketExists } from "./observations.mjs";
import { safeTrace } from "./trace.mjs";
import { observeWithRetries, wranglerArguments } from "./provider-retry.mjs";

test("provider runtime is explicit and cannot introduce arbitrary CLI switches", () => {
  assert.deepEqual(wranglerArguments(["versions", "list"]), [
    "x",
    "wrangler",
    "versions",
    "list",
  ]);
  assert.throws(
    () => wranglerArguments(["versions", "list"], "bun"),
    /supported Node.js runtime/,
  );
  assert.throws(
    () => wranglerArguments(["versions", "list"], "--foreign-config"),
    /supported Node.js runtime/,
  );
});

test("provider observation retries transport failures and preserves explicit missing-resource evidence", async () => {
  let calls = 0;
  const sleeps = [];
  const result = await observeWithRetries(
    ["versions", "list", "--json"],
    async () =>
      ++calls === 1
        ? { code: 1, stdout: "", stderr: "fetch failed" }
        : { code: 1, stdout: "", stderr: "Worker does not exist [code:10007]" },
    async (ms) => {
      sleeps.push(ms);
    },
  );
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [1000]);
  assert.match(result.stderr, /10007/);
});
test("provider writes and restores never retry an unknown transport outcome", async () => {
  for (const args of [
    ["deploy"],
    ["delete", "owned-worker", "--force"],
    ["secret", "bulk", "private-file"],
    ["r2", "bucket", "create", "owned-bucket"],
    ["d1", "create", "owned-database"],
    ["d1", "time-travel", "restore", "owned-database"],
    ["secrets-store", "secret", "create", "store"],
    ["secrets-store", "secret", "delete", "store"],
    ["secrets-store", "secret", "update", "store"],
  ]) {
    let calls = 0;
    await observeWithRetries(
      args,
      async () => {
        calls++;
        return { code: 1, stdout: "", stderr: "fetch failed" };
      },
      async () => {
        throw Error("Mutation retry");
      },
    );
    assert.equal(calls, 1);
  }
});
test("provider read retries are bounded and do not disguise access denials or missing resources", async () => {
  let calls = 0;
  const sleeps = [];
  const result = await observeWithRetries(
    ["d1", "list", "--json"],
    async () => {
      calls++;
      return { code: 1, stdout: "", stderr: "fetch failed" };
    },
    async (ms) => {
      sleeps.push(ms);
    },
  );
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [1000, 3000]);
  assert.equal(result.code, 1);
  for (const stderr of [
    "Authentication failed [code:10000]",
    "Bucket missing [code:10006]",
    "Permission denied [403]",
  ]) {
    let attempts = 0;
    await observeWithRetries(
      ["r2", "bucket", "info", "owned"],
      async () => {
        attempts++;
        return { code: 1, stdout: "", stderr };
      },
      async () => {
        throw Error("Unexpected retry");
      },
    );
    assert.equal(attempts, 1);
  }
});
test("provider observations retry actual CLI API-timeout text and locally killed read attempts", async () => {
  for (const failure of [
    {
      code: 1,
      stdout: "",
      stderr: "The request to Cloudflare's API timed out.",
    },
    { code: 1, stdout: "", stderr: "", timedOut: true },
  ]) {
    let calls = 0;
    const result = await observeWithRetries(
      ["versions", "list"],
      async () =>
        ++calls === 1 ? failure : { code: 0, stdout: "[]", stderr: "" },
      async () => {},
    );
    assert.equal(calls, 2);
    assert.equal(result.code, 0);
    let writes = 0;
    await observeWithRetries(
      ["deploy"],
      async () => {
        writes++;
        return failure;
      },
      async () => {
        throw Error("Write retry");
      },
    );
    assert.equal(writes, 1);
  }
});

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
test("repository recovery Git bridge only prefixes the explicit operator transport and preserves auth/query", async () => {
  await assert.rejects(
    gitProxy({ upstreamPrefix: "https://foreign.example/" }),
    /Unexpected fixture upstream/,
  );
  const server = createServer((req, res) => {
    assert.equal(
      req.url,
      "/__fixture/app/git/test/repo.git/info/refs?service=git-upload-pack",
    );
    assert.equal(req.headers.authorization, "Basic synthetic");
    assert.equal(req.headers["x-nanohub-hosted-fixture"], "private-control");
    res.writeHead(200);
    res.end("real application auth still receives this");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const proxy = await gitProxy({
    origin: "http://127.0.0.1:" + server.address().port,
    authorization: "Basic synthetic",
    control: "private-control",
    repositoryPath: "/git/test/repo.git",
    upstreamPrefix: "/__fixture/app",
  });
  try {
    const response = await fetch(
      proxy.origin + "/git/test/repo.git/info/refs?service=git-upload-pack",
      { headers: { authorization: "Basic synthetic" } },
    );
    assert.equal(response.status, 200);
    await response.text();
  } finally {
    await proxy.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
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
