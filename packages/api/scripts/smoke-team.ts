import WebSocket from "ws";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { teamFixture, ROOM, OTHER } from "./team/fixture.ts";

const f = await teamFixture();
const base = "/api/trunks/private-team";
const auth = (name: string, token: string) => ({
  authorization: `Basic ${btoa(`${name}:${token}`)}`,
});
const exec = promisify(execFile);
async function serverClosed(socket: WebSocket) {
  const until = Date.now() + 3000;
  while (socket.readyState === WebSocket.OPEN && Date.now() < until)
    await new Promise((resolve) => setTimeout(resolve, 10));
  // workerd's HTTP proxy can keep the TCP close handshake in CLOSING;
  // receipt of the server close frame is the application boundary.
  assert.ok(
    socket.readyState === WebSocket.CLOSING ||
      socket.readyState === WebSocket.CLOSED,
  );
  socket.terminate();
}
async function openSocket(headers = {}) {
  const socket = new WebSocket(
    f.origin.replace(/^http/, "ws") + base + "/live",
    { headers },
  );
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return socket;
}
try {
  const alice = await f.login("local-alice", "101");
  const bob = await f.login("local-bob", "202");
  const stranger = await f.login("local-stranger", "303");
  await f.json(
    "POST",
    base,
    { files: [{ path: "private.txt", text: "team secret fixture\n" }] },
    alice,
  );
  await f.json(
    "POST",
    "/api/trunks/public-demo",
    { files: [{ path: "public.txt", text: "public\n" }] },
    alice,
  );
  assert.equal(
    (await f.json("GET", `${base}/team`, undefined, alice)).canConnect,
    true,
  );
  assert.equal(
    (await f.json("GET", `${base}/team`, undefined, bob)).canConnect,
    false,
  );
  assert.equal((await f.request("GET", "/api/teams")).status, 401);
  assert.equal(
    (await f.json("GET", "/api/teams", undefined, bob)).rooms[0].role,
    "member",
  );
  assert.deepEqual(
    (await f.json("GET", "/api/teams", undefined, stranger)).rooms,
    [],
  );
  assert.equal(
    (await f.request("POST", `${base}/team`, { roomId: ROOM }, bob)).status,
    403,
  );
  assert.equal(
    (
      await f.request(
        "POST",
        `${base}/team`,
        { roomId: ROOM },
        { ...alice, origin: "https://elsewhere.invalid" },
      )
    ).status,
    403,
  );
  f.members.set("101", "member");
  assert.equal(
    (await f.request("POST", `${base}/team`, { roomId: ROOM }, alice)).status,
    403,
  );
  f.members.set("101", "owner");
  const publicSocket = await openSocket();
  const bound = await f.json("POST", `${base}/team`, { roomId: ROOM }, alice);
  assert.equal(bound.team.roomId, ROOM);
  await serverClosed(publicSocket);
  console.log(
    "ok: creator + room-owner proof, same-origin binding, old public sockets closed",
  );

  for (const path of [
    "",
    "/info",
    "/repo",
    "/files",
    "/tree",
    "/raw?path=private.txt",
    "/brief",
    "/room",
    "/channel",
    "/agents",
    "/issues",
    "/log",
    "/live",
  ]) {
    assert.equal((await f.request("GET", base + path)).status, 404, path);
    assert.equal(
      (await f.request("GET", base + path, undefined, stranger)).status,
      404,
      path,
    );
  }
  assert.deepEqual(
    (await f.json("GET", "/api/trunks")).map((v: any) => v.name),
    ["public-demo"],
  );
  assert.ok(
    (await f.json("GET", "/api/trunks", undefined, bob)).some(
      (v: any) => v.name === "private-team",
    ),
  );
  assert.equal(
    (await f.request("GET", "/git/private-team.git/HEAD")).status,
    401,
  );
  assert.equal(
    (
      await f.request(
        "GET",
        "/git/private-team.git/objects/00/" + "0".repeat(38),
      )
    ).status,
    401,
  );
  assert.equal(
    (await f.request("POST", `${base}/clone-token`, {}, bob)).status,
    403,
  );
  assert.equal(
    (await f.request("POST", `${base}/benchmark?n=1`, {}, bob)).status,
    403,
  );
  assert.equal(
    (await f.request("POST", `${base}/swarm`, { agents: 1 }, bob)).status,
    403,
  );
  assert.equal(
    (await f.request("POST", `${base}/agents/unregistered/lives`, {}, bob))
      .status,
    403,
  );
  assert.equal((await f.request("DELETE", base, undefined, bob)).status, 403);
  const registered = await f.json(
    "POST",
    `${base}/agents`,
    {
      handle: "builder",
      type: "Codex",
      owner: { id: "codegraff:local-alice" },
    },
    bob,
  );
  assert.equal(registered.owner.id, "codegraff:local-bob");
  assert.equal(
    (await f.request("POST", `${base}/agents/builder/token`, {}, alice)).status,
    403,
  );
  const credential = await f.json(
    "POST",
    `${base}/agents/builder/token`,
    {},
    bob,
  );
  const agent = auth("builder", credential.token);
  assert.equal(
    (
      await f.request(
        "POST",
        `${base}/agents`,
        { handle: "mixed", type: "Codex" },
        { ...alice, ...agent },
      )
    ).status,
    401,
  );
  const legacy = await f.json(
    "POST",
    "/api/tokens",
    { label: "legacy", trunk: "private-team" },
    bob,
  );
  assert.equal(
    (
      await f.request(
        "GET",
        `${base}/info`,
        undefined,
        auth("builder", legacy.token),
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await f.request(
        "GET",
        `${base}/info`,
        undefined,
        auth("imposter", credential.token),
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await f.request(
        "GET",
        `${base}/info`,
        undefined,
        auth("builder", credential.token + "bad"),
      )
    ).status,
    401,
  );
  console.log(
    "ok: all private reads fenced; no legacy, mixed-cookie or claimed-owner impersonation",
  );

  const life = await f.json("POST", `${base}/agents/builder/lives`, {}, agent);
  const changed = await f.json(
    "POST",
    `${base}/agents/builder/submit`,
    {
      life: life.life,
      intent: "verified team work",
      edits: [{ op: "create", path: "http.txt", text: "bound\n" }],
      wait: "published",
    },
    agent,
  );
  assert.equal(changed.status, "landed");
  const proof = await f.json(
    "GET",
    `/fixture/proof?principal=${registered.id}`,
  );
  assert.equal(proof.ownerId, "codegraff:local-bob");
  assert.equal(proof.subject, "202");
  assert.equal(proof.credentialId, credential.id);
  assert.equal(proof.agentId, registered.id);
  assert.equal(proof.roomId, ROOM);
  assert.equal(proof.role, "member");
  assert.ok(!JSON.stringify(proof).includes(credential.token));
  const clone = join(f.dir, "clone");
  await exec("git", [
    "clone",
    "-q",
    `${f.origin.replace("://", `://builder:${credential.token}@`)}/git/private-team.git`,
    clone,
  ]);
  const git = (...args: string[]) => exec("git", ["-C", clone, ...args]);
  await git("config", "user.name", "Untrusted author display name");
  await git("config", "user.email", "team@example.invalid");
  await writeFile(join(clone, "git.txt"), "verified git\n");
  await git("add", "git.txt");
  await git("commit", "-qm", "verified git change");
  await git("push");
  await git("fsck", "--full", "--strict");
  const head = await f.request(
    "GET",
    "/git/private-team.git/HEAD",
    undefined,
    agent,
  );
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("cache-control"), "private, no-store");
  assert.match(head.headers.get("vary")!, /Authorization/);
  console.log(
    "ok: real authenticated clone + push, HTTP landing, internal identity proof, private caching",
  );

  const bobSocket = await openSocket(bob);
  const frames: string[] = [];
  bobSocket.addEventListener("message", (event) =>
    frames.push(String(event.data)),
  );
  f.members.delete("202");
  assert.equal(
    (await f.request("GET", `${base}/info`, undefined, bob)).status,
    404,
  );
  assert.equal(
    (await f.request("GET", `${base}/agents/builder/inbox`, undefined, agent))
      .status,
    404,
  );
  assert.equal(
    (
      await f.request(
        "POST",
        `${base}/agents/builder/heartbeat`,
        { status: "working" },
        agent,
      )
    ).status,
    404,
  );
  assert.equal(
    (await f.request("GET", "/git/private-team.git/HEAD", undefined, agent))
      .status,
    404,
  );
  await assert.rejects(git("fetch"));
  await f.json(
    "POST",
    `${base}/channel`,
    { body: "message-after-member-removal" },
    alice,
  );
  await serverClosed(bobSocket);
  assert.ok(
    !frames.some((frame) => frame.includes("message-after-member-removal")),
  );
  assert.ok(
    !(await f.json("GET", "/api/trunks", undefined, bob)).some(
      (v: any) => v.name === "private-team",
    ),
  );
  console.log(
    "ok: membership removal stops existing credentials, git and live updates",
  );

  f.provider.wrongSubject = true;
  assert.equal(
    (await f.request("GET", `${base}/info`, undefined, alice)).status,
    403,
  );
  f.provider.wrongSubject = false;
  f.provider.wrongAudience = true;
  assert.equal(
    (await f.request("GET", `${base}/info`, undefined, alice)).status,
    403,
  );
  f.provider.wrongAudience = false;
  f.provider.expired = true;
  assert.equal(
    (await f.request("GET", `${base}/info`, undefined, alice)).status,
    403,
  );
  f.provider.expired = false;
  f.provider.down = true;
  assert.equal(
    (await f.request("GET", `${base}/info`, undefined, alice)).status,
    503,
  );
  assert.deepEqual(
    (await f.json("GET", "/api/trunks", undefined, alice)).map(
      (v: any) => v.name,
    ),
    ["public-demo"],
  );
  f.provider.down = false;
  assert.equal(
    (await f.request("POST", `${base}/team`, { roomId: OTHER }, alice)).status,
    403,
  );
  await f.restart();
  assert.equal((await f.request("GET", `${base}/info`)).status, 404);
  assert.equal(
    (await f.json("GET", `${base}/team`, undefined, alice)).team.roomId,
    ROOM,
  );
  assert.equal(
    (await f.json("GET", `/fixture/proof?principal=${registered.id}`)).subject,
    "202",
  );
  f.members.set("202", "member");
  await f.json("DELETE", `/api/tokens/${credential.id}`, undefined, bob);
  assert.equal(
    (await f.request("GET", `${base}/info`, undefined, agent)).status,
    401,
  );
  console.log(
    "ok: wrong subject/audience/stale proof/outage fail closed; persisted policy + proof; token revocation",
  );
} finally {
  await f.close();
}
