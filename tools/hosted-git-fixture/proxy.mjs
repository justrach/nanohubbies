import { createServer } from "node:http";
import { Readable } from "node:stream";

/** Git-only loopback bridge. The caller's CLI never receives the control key. */
export async function gitProxy({
  origin,
  authorization,
  control,
  repositoryPath,
  upstreamPrefix = "",
}) {
  if (!["", "/__fixture/app"].includes(upstreamPrefix))
    throw Error("Unexpected fixture upstream prefix");
  const upstreamOrigin = new URL(origin).origin,
    controllers = new Set();
  let closing = false;
  const mutations = { objectUploads: 0, refPublications: 0 };
  const server = createServer((request, response) => {
    const target = new URL(request.url, upstreamOrigin);
    if (
      closing ||
      target.origin !== upstreamOrigin ||
      !target.pathname.startsWith(repositoryPath + "/") ||
      !["GET", "HEAD", "POST"].includes(request.method)
    ) {
      response.writeHead(404).end();
      return;
    }
    if (request.headers.authorization !== authorization) {
      response
        .writeHead(401, {
          "WWW-Authenticate": 'Basic realm="nanohub-hosted-fixture"',
        })
        .end();
      return;
    }
    const controller = new AbortController();
    if (
      request.method === "POST" &&
      target.pathname === repositoryPath + "/nanohub-import/objects"
    )
      mutations.objectUploads++;
    if (
      request.method === "POST" &&
      target.pathname === repositoryPath + "/git-receive-pack"
    )
      mutations.refPublications++;
    controllers.add(controller);
    const headers = new Headers({ "x-nanohub-hosted-fixture": control });
    for (const name of [
      "authorization",
      "content-type",
      "range",
      "user-agent",
      "accept",
      "git-protocol",
    ])
      if (request.headers[name]) headers.set(name, request.headers[name]);
    const upstreamTarget = new URL(target);
    upstreamTarget.pathname = upstreamPrefix + upstreamTarget.pathname;
    fetch(upstreamTarget, {
      method: request.method,
      headers,
      ...(["GET", "HEAD"].includes(request.method)
        ? {}
        : { body: request, duplex: "half" }),
      redirect: "error",
      signal: controller.signal,
    })
      .then((upstream) => {
        // Fetch transparently decompresses the bytes. Forwarding their original
        // encoding/length makes the CLI decompress them twice or truncate a pack.
        const output = new Headers(upstream.headers);
        output.delete("content-encoding");
        output.delete("content-length");
        output.delete("transfer-encoding");
        output.delete("connection");
        response.writeHead(upstream.status, Object.fromEntries(output));
        if (upstream.body)
          Readable.fromWeb(upstream.body)
            .on("error", () => response.destroy())
            .pipe(response);
        else response.end();
      })
      .catch(() => {
        if (!response.headersSent) response.writeHead(502);
        response.end();
      });
    response.once("close", () => {
      controller.abort();
      controllers.delete(controller);
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    origin: "http://127.0.0.1:" + server.address().port,
    traffic: () => ({ ...mutations }),
    async close() {
      closing = true;
      for (const controller of controllers) controller.abort();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
