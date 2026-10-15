// Real coordination and auth regressions using isolated Worker storage.
import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { base, boot, call, credentials, dir, exec, login, mf, ok, origin } from "./room/harness.ts";

let alice: Record<string, string>;
let bob: Record<string, string>;
let first: any;
let second: any;
let token: any;
let secondToken: any;
let handoff: any;

try {
  await boot();
  alice = await login("alice");
  bob = await login("bob");
  await ok(
    "POST",
    base,
    { files: [{ path: "base.txt", text: "base\n" }] },
    alice,
  );
  assert.equal(
    (await call("POST", `${base}/agents`, { handle: "alice", type: "Codex" }))
      .status,
    401,
  );
  first = await ok(
    "POST",
    `${base}/agents`,
    { handle: "alice", type: "Codex" },
    alice,
  );
  assert.equal(first.heartbeatAt, null);
  assert.equal(first.status, "offline");
  assert.equal(
    (
      await ok(
        "POST",
        `${base}/agents`,
        { handle: "alice", type: "different" },
        alice,
      )
    ).id,
    first.id,
  );
  assert.equal(
    (
      await call(
        "POST",
        `${base}/agents`,
        { handle: "alice", type: "Claude" },
        bob,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        "POST",
        `${base}/agents`,
        { handle: "sequencer", type: "custom" },
        alice,
      )
    ).status,
    400,
  );
  await ok("POST", `${base}/agents/legacy/lives`, {});
  assert.equal(
    (
      await call(
        "POST",
        `${base}/agents`,
        { handle: "legacy", type: "Codex" },
        alice,
      )
    ).status,
    400,
  );
  second = await ok(
    "POST",
    `${base}/agents`,
    { handle: "builder", type: "Claude Code" },
    bob,
  );
  token = await ok("POST", `${base}/agents/alice/token`, {}, alice);
  secondToken = await ok("POST", `${base}/agents/builder/token`, {}, bob);
  const auth = credentials("alice", token.token);
  const other = credentials("builder", secondToken.token);
  assert.equal(
    (await call("POST", `${base}/agents/alice/token`, {}, bob)).status,
    403,
  );
  assert.equal(
    (await call("POST", `${base}/agents/alice/token`, {}, auth)).status,
    403,
  );
  assert.equal(
    (await ok("GET", "/api/tokens", undefined, alice)).find(
      (t: any) => t.id === token.id,
    ).agentId,
    first.id,
  );
  assert.ok(
    !(await ok("GET", "/api/tokens", undefined, alice)).some(
      (t: any) => "token" in t,
    ),
  );
  for (const action of ["lives", "status", "hold"]) {
    assert.equal(
      (
        await call("POST", `${base}/agents/alice/${action}`, {
          intent: "spoof",
          issue: 1,
        })
      ).status,
      403,
    );
    assert.equal(
      (await call("POST", `${base}/agents/alice/${action}`, {}, alice)).status,
      403,
    );
    assert.equal(
      (await call("POST", `${base}/agents/alice/${action}`, {}, other)).status,
      403,
    );
  }
  assert.equal(
    (await call("GET", `${base}/agents/alice`, undefined, alice)).status,
    200,
    "owner can inspect AgentDrawer info",
  );
  assert.equal(
    (await call("GET", `${base}/agents/alice`, undefined, bob)).status,
    403,
  );
  assert.equal(
    (
      await call(
        "POST",
        `${base}/agents/alice/heartbeat`,
        {},
        credentials("renamed", token.token),
      )
    ).status,
    401,
  );
  assert.equal(
    (await call("POST", "/api/trunks/other/agents/alice/heartbeat", {}, auth))
      .status,
    401,
  );
  const legacyToken = await ok(
    "POST",
    "/api/tokens",
    { trunk: "room-test", label: "legacy" },
    alice,
  );
  const legacyAuth = credentials("alice", legacyToken.token);
  assert.equal(
    (await call("POST", `${base}/agents/alice/lives`, {}, legacyAuth)).status,
    403,
  );
  assert.equal(
    (await call("POST", `${base}/channel`, { from: "alice", body: "spoof" }))
      .status,
    403,
  );
  assert.equal(
    (
      await call("POST", `${base}/channel`, {
        from: "sequencer",
        body: "spoof",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        "POST",
        `${base}/channel`,
        { from: "builder", body: "spoof" },
        auth,
      )
    ).status,
    403,
  );
  const person = await ok(
    "POST",
    `${base}/channel`,
    { from: "alice", body: "human context" },
    alice,
  );
  assert.equal(person.from, "person:alice");
  console.log(
    "ok: stable registry, cross-owner collisions, owner-only issuance, bound identities, legacy reservation fences",
  );

  const life = await ok("POST", `${base}/agents/alice/lives`, {}, auth);
  const change = await ok(
    "POST",
    `${base}/agents/alice/submit`,
    {
      life: life.life,
      intent: "bound HTTP change",
      edits: [{ op: "create", path: "bound.txt", text: "bound\n" }],
      wait: "published",
    },
    auth,
  );
  assert.equal(change.status, "landed");
  const pulse = await ok(
    "POST",
    `${base}/agents/alice/heartbeat`,
    {
      status: "blocked",
      task: "Review HTTP change",
      progress: "Waiting for feedback",
    },
    auth,
  );
  assert.equal(pulse.owner.id, first.owner.id);
  assert.equal(pulse.status, "blocked");
  assert.ok(pulse.heartbeatAt > 0);
  assert.equal(
    (
      await call(
        "POST",
        `${base}/agents/alice/heartbeat`,
        { status: "pretend" },
        auth,
      )
    ).status,
    400,
  );
  await ok(
    "POST",
    `${base}/agents/alice/status`,
    { intent: "Run checks", progress: "Checking" },
    auth,
  );
  assert.equal(
    (await ok("GET", `${base}/agents`)).find((a: any) => a.id === first.id)
      .task,
    "Run checks",
  );
  const message = await ok(
    "POST",
    `${base}/channel`,
    { body: "@builder please review" },
    auth,
  );
  const reply = await ok(
    "POST",
    `${base}/channel`,
    { body: "Reviewing", replyTo: message.id },
    other,
  );
  assert.deepEqual(reply.to, ["alice"]);
  handoff = await ok(
    "POST",
    `${base}/channel`,
    { body: "Here is the next step", replyTo: reply.id, handoffTo: "builder" },
    auth,
  );
  assert.equal(handoff.handoffTo, "builder");
  assert.equal(handoff.replyTo, reply.id);
  assert.equal(
    (
      await call(
        "POST",
        `${base}/channel`,
        { body: "bad", replyTo: 999_999 },
        auth,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        "POST",
        `${base}/channel`,
        { body: "bad", handoffTo: "missing" },
        auth,
      )
    ).status,
    400,
  );
  assert.equal(
    (await call("POST", `${base}/agents/alice/ack`, { id: handoff.id }, auth))
      .status,
    400,
  );
  const ack = await ok(
    "POST",
    `${base}/agents/builder/ack`,
    { id: handoff.id },
    other,
  );
  assert.deepEqual(
    await ok("POST", `${base}/agents/builder/ack`, { id: handoff.id }, other),
    ack,
  );
  assert.equal(
    (
      await ok("GET", `${base}/agents/builder/inbox?after=0`, undefined, other)
    ).messages.find((m: any) => m.id === handoff.id).acknowledgements[0].agent,
    "builder",
  );
  for (let i = 0; i < 105; i++)
    await ok("POST", `${base}/channel`, {
      from: "legacy",
      body: `@builder backlog ${i}`,
    });
  const page1 = await ok(
    "GET",
    `${base}/agents/builder/inbox?after=0`,
    undefined,
    other,
  );
  assert.equal(page1.messages.length, 100);
  assert.equal(page1.hasMore, true);
  const page2 = await ok(
    "GET",
    `${base}/agents/builder/inbox?after=${page1.nextCursor}`,
    undefined,
    other,
  );
  assert.equal(page2.messages.length, 7);
  assert.equal(page2.hasMore, false);
  const ids = [...page1.messages, ...page2.messages].map((m: any) => m.id);
  assert.equal(new Set(ids).size, 107);
  assert.deepEqual(
    ids,
    [...ids].sort((a, b) => a - b),
  );
  assert.equal(
    (
      await call(
        "GET",
        `${base}/agents/builder/inbox?after=-1`,
        undefined,
        other,
      )
    ).status,
    400,
  );
  console.log(
    "ok: bound HTTP landing, heartbeat/status, replies, handoffs, recipient-only idempotent ack, complete inbox paging",
  );

  const wsResponse = await mf.dispatchFetch(origin + `${base}/live`, {
    headers: { Upgrade: "websocket", ...alice },
  });
  const socket = wsResponse.webSocket!;
  socket.accept();
  socket.send(JSON.stringify({ type: "post", body: "websocket human" }));
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(
    (await ok("GET", `${base}/channel`)).find(
      (m: any) => m.body === "websocket human",
    ).from,
    "person:alice",
  );
  socket.close();

  const clone = join(dir, "clone");
  await exec("git", ["clone", "-q", `${origin}/git/room-test.git`, clone]);
  const git = async (...args: string[]) => exec("git", ["-C", clone, ...args]);
  await git("config", "user.name", "alice");
  await git("config", "user.email", "room@example.invalid");
  await writeFile(join(clone, "git.txt"), "git\n");
  await git("add", "git.txt");
  await git("commit", "-qm", "bound git change");
  await git(
    "remote",
    "set-url",
    "--push",
    "origin",
    `${origin.replace("://", `://alice:${legacyToken.token}@`)}/git/room-test.git`,
  );
  await assert.rejects(git("push"), /scoped agent credential/);
  await git(
    "remote",
    "set-url",
    "--push",
    "origin",
    `${origin.replace("://", `://alice:${token.token}@`)}/git/room-test.git`,
  );
  await git("push");
  await git("fsck", "--full", "--strict");
  console.log(
    "ok: websocket human sender cannot spoof agent; legacy git spoof refused; bound git push lands",
  );

  await mf.dispose();
  await boot();
  const restored = await ok("GET", `${base}/room`);
  assert.equal(
    restored.roster.find((a: any) => a.handle === "alice").id,
    first.id,
  );
  const restoredInbox = await ok(
    "GET",
    `${base}/agents/builder/inbox?after=0`,
    undefined,
    credentials("builder", secondToken.token),
  );
  assert.equal(
    restoredInbox.messages.find((m: any) => m.id === handoff.id)
      .acknowledgements[0].agent,
    "builder",
  );
  assert.ok(
    (await ok("GET", "/api/agent-help")).room.inbox.includes("nextCursor"),
  );
  const d1 = await mf.getD1Database("AUTH_DB");
  await d1
    .prepare("UPDATE agent_token SET expiresAt = 0 WHERE id = ?")
    .bind(secondToken.id)
    .run();
  assert.equal(
    (
      await call(
        "POST",
        `${base}/agents/builder/heartbeat`,
        {},
        credentials("builder", secondToken.token),
      )
    ).status,
    401,
  );
  assert.equal(
    (await ok("DELETE", `/api/tokens/${token.id}`, undefined, alice)).revoked,
    true,
  );
  assert.equal(
    (
      await call(
        "POST",
        `${base}/agents/alice/heartbeat`,
        {},
        credentials("alice", token.token),
      )
    ).status,
    401,
  );
  assert.ok(
    !(await ok("GET", "/api/tokens", undefined, alice)).some(
      (t: any) => t.id === token.id,
    ),
  );
  console.log(
    "ok: runtime restart persists registry/messages/ack; credential expiry, revocation and safe discovery",
  );
} finally {
  await mf!?.dispose();
  await rm(dir, { recursive: true, force: true });
}
