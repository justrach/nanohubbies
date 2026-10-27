import WebSocket from "ws";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";
import { teamFixture, ROOM } from "./team/fixture.ts";
const f = await teamFixture({}, { vault: true });
async function socketFor(headers: Record<string, string>) {
  const socket = new WebSocket(
    f.origin.replace(/^http/, "ws") + "/api/trunks/independent/live",
    { headers },
  );
  const frames: string[] = [];
  socket.on("message", (m) => frames.push(String(m)));
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return { socket, frames };
}
async function closes(socket: WebSocket) {
  const until = Date.now() + 3000;
  while (socket.readyState === WebSocket.OPEN && Date.now() < until)
    await new Promise((r) => setTimeout(r, 10));
  // The local workerd proxy can retain the TCP closing handshake after the
  // server's access-revocation close frame has already arrived.
  assert.ok(
    socket.readyState === WebSocket.CLOSING ||
      socket.readyState === WebSocket.CLOSED,
    "Socket retained revoked authority",
  );
  socket.terminate();
}

try {
  const alice = await f.login("owner", "101"),
    bob = await f.login("writer", "202"),
    eve = await f.login("outsider", "303"),
    admin = await f.login("admin", "404");
  const base = "/api/trunks/independent";
  await f.json("POST", base, { mode: "git" }, alice);
  async function invite(userId: string, role: string) {
    return f.json("POST", `${base}/collaborators`, { userId, role }, alice);
  }
  async function accept(
    invitation: any,
    who: Record<string, string>,
    trunk = "independent",
  ) {
    return f.request(
      "POST",
      "/api/invitations/accept",
      { trunk, token: invitation.token },
      who,
    );
  }
  const invitation = await invite("codegraff:writer", "writer");
  assert.equal((await f.request("GET", base, undefined, bob)).status, 404);
  assert.equal((await accept(invitation, eve)).status, 400);
  assert.equal((await accept(invitation, bob)).status, 200);
  assert.equal((await accept(invitation, bob)).status, 400);
  assert.ok(
    (await f.json("GET", "/api/trunks", undefined, bob)).some(
      (t) => t.name === "independent",
    ),
  );
  assert.equal(
    (
      await f.request(
        "POST",
        `${base}/collaborators`,
        { userId: "codegraff:outsider", role: "admin" },
        bob,
      )
    ).status,
    403,
  );
  await f.json(
    "POST",
    `${base}/agents`,
    { handle: "writer", type: "test" },
    bob,
  );
  const cred = await f.json("POST", `${base}/agents/writer/token`, {}, bob),
    agent = { authorization: `Basic ${btoa(`writer:${cred.token}`)}` };
  assert.equal(
    (
      await f.request(
        "GET",
        "/git/independent.git/info/refs?service=git-receive-pack",
        undefined,
        agent,
      )
    ).status,
    200,
  );
  const liveWriter = await socketFor(bob);
  await f.json(
    "PATCH",
    `${base}/collaborators`,
    { userId: "codegraff:writer", role: "reader" },
    alice,
  );
  const writerClosed = closes(liveWriter.socket);
  liveWriter.socket.send(
    JSON.stringify({ type: "post", body: "denied-after-demotion" }),
  );
  await writerClosed;
  assert.ok(
    !(await f.json("GET", `${base}/channel`, undefined, alice)).some(
      (m) => m.body === "denied-after-demotion",
    ),
  );
  assert.equal(
    (await f.request("GET", "/git/independent.git/info/refs", undefined, agent))
      .status,
    200,
  );
  assert.equal(
    (
      await f.request(
        "GET",
        "/git/independent.git/info/refs?service=git-receive-pack",
        undefined,
        agent,
      )
    ).status,
    403,
  );
  for (const path of [
    "repository/objects",
    "pulls",
    "issues",
    "channel",
    "agents/writer/lives",
  ])
    assert.equal(
      (await f.request("POST", `${base}/${path}`, {}, agent)).status,
      403,
      path,
    );
  await f.json(
    "POST",
    `${base}/agents`,
    { handle: "read-only", type: "test" },
    bob,
  );
  const readCred = await f.json(
    "POST",
    `${base}/agents/read-only/token`,
    {},
    bob,
  );
  assert.equal(
    (
      await f.request("GET", "/git/independent.git/info/refs", undefined, {
        authorization: `Basic ${btoa(`read-only:${readCred.token}`)}`,
      })
    ).status,
    200,
  );
  assert.equal(
    (await f.request("GET", `${base}/secrets`, undefined, bob)).status,
    403,
  );
  const adminInvite = await invite("codegraff:admin", "admin");
  assert.equal((await accept(adminInvite, admin)).status, 200);
  const protection={branch:"release/*",pullRequest:true,approvals:1,checks:[],beforeOpen:[],preventForce:true,preventDelete:true};
  assert.equal((await f.request("PUT",`${base}/protection`,protection,bob)).status,403);
  await f.json("PUT",`${base}/protection`,protection,admin);
  await f.json("DELETE",`${base}/protection`,{branch:"release/*"},admin);
  const adminRuleset={name:"Admin-managed tags",target:"tag",enforcement:"active",conditions:{ref_name:{include:["~ALL"],exclude:[]}},rules:[{type:"deletion"}],bypass_actors:[{actor_type:"User",actor_id:"codegraff:admin",bypass_mode:"always"}]};
  assert.equal((await f.request("POST",`${base}/rulesets`,adminRuleset,bob)).status,403);
  const managedRule=await f.json("POST",`${base}/rulesets`,adminRuleset,admin);
  const renamedRuleset={...adminRuleset,name:"Updated by admin"};
  await f.json("PUT",`${base}/rulesets/${managedRule.id}`,renamedRuleset,admin);
  assert.ok((await f.json("GET",`${base}/rulesets`,undefined,bob)).rulesets.some(r=>r.id===managedRule.id));
  assert.ok(!("bypass_actors" in (await f.json("GET",`${base}/rulesets/${managedRule.id}`,undefined,bob))));
  assert.deepEqual((await f.json("GET",`${base}/rulesets/${managedRule.id}`,undefined,admin)).bypass_actors,adminRuleset.bypass_actors);
  assert.ok(!(await f.json("GET",`${base}/branches`,undefined,bob)).rulesets.some(r=>"bypass_actors" in r));
  await f.json("DELETE",`${base}/rulesets/${managedRule.id}`,undefined,admin);
  const activityResponse=await f.request("GET",`${base}/repository/audit?ruleset=${managedRule.id}`,undefined,admin);
  assert.equal(activityResponse.headers.get("cache-control"),"private, no-store");
  const activity=await activityResponse.json() as {events:any[]};
  assert.equal(activity.events.length,3);
  assert.equal(activity.events[0].previousRuleset.name,renamedRuleset.name);
  assert.equal(activity.events[1].previousRuleset.name,adminRuleset.name);
  assert.equal(activity.events[1].ruleset.name,renamedRuleset.name);
  assert.ok(activity.events.every(e=>e.actor==="codegraff:admin"));
  for(const identity of [bob,agent])assert.equal((await f.request("GET",`${base}/repository/audit`,undefined,identity)).status,403);
  assert.equal((await f.request("GET",`${base}/repository/audit`,undefined,eve)).status,404);
  assert.equal((await f.request("POST",`${base}/ci/runners`,{name:"not-owner"},admin)).status,403);
  assert.equal((await f.request("GET",`${base}/ci/runners`,undefined,admin)).status,403);
  assert.equal((await f.request("GET",`${base}/ci/runners`,undefined,bob)).status,403);

  assert.equal(
    (
      await f.request(
        "PATCH",
        `${base}/collaborators`,
        { userId: "codegraff:owner", role: null },
        alice,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request(
        "PATCH",
        `${base}/collaborators`,
        { userId: "codegraff:writer", role: "admin" },
        admin,
      )
    ).status,
    400,
  );
  const cancelled = await invite("codegraff:outsider", "writer");
  await f.json(
    "DELETE",
    `${base}/collaborators/${cancelled.id}`,
    undefined,
    alice,
  );
  assert.equal((await accept(cancelled, eve)).status, 400);
  // Values are never echoed on management routes. Workload tokens are distinct from agent and CI tokens.
  const secret = "synthetic-test-secret-DO-NOT-USE";
  const cloudflare = await f.provisionSecret("independent", "staging", "DEPLOY_TOKEN", secret);
  await f.json(
    "PUT",
    `${base}/secrets?environment=staging`,
    { name: "DEPLOY_TOKEN", binding: cloudflare.binding },
    admin,
  );
  const metadata = await f.json(
    "GET",
    `${base}/secrets?environment=staging`,
    undefined,
    admin,
  );
  assert.equal(JSON.stringify(metadata).includes(secret), false);
  assert.equal(metadata.secrets[0].version, 1);
  assert.equal(metadata.nextCleanupAt, null, "An unused vault has no wake-up alarm");
  assert.equal(
    (
      await f.json(
        "GET",
        `${base}/secrets?environment=production`,
        undefined,
        alice,
      )
    ).secrets.length,
    0,
  );
  const grant = await f.json(
      "POST",
      `${base}/secrets`,
      { names: ["DEPLOY_TOKEN"], ttlSeconds: 900 },
      admin,
    ),
    workload = { authorization: `Bearer ${grant.token}` };
  assert.equal(
    (await f.json("GET", `${base}/secrets`, undefined, admin)).nextCleanupAt,
    grant.expires,
    "The only scheduled wake-up expires the active grant",
  );
  assert.equal(
    (await f.request("GET", `${base}/secrets`, undefined, workload)).status,
    401,
  );
  assert.equal(
    (await f.request("POST", `${base}/secrets/read`, {}, agent)).status,
    403,
  );
  assert.deepEqual(
    (await f.json("POST", `${base}/secrets/read`, {}, workload)).values,
    { DEPLOY_TOKEN: secret },
  );
  assert.equal(
    (
      await f.request(
        "POST",
        `${base}/secrets/read?environment=production`,
        {},
        workload,
      )
    ).status,
    403,
  );
  await f.json("POST", "/api/trunks/other", { mode: "git" }, alice);
  assert.equal(
    (await f.request("POST", "/api/trunks/other/secrets/read", {}, workload))
      .status,
    403,
  );
  await cloudflare.update("rotated");
  await f.json(
    "PUT",
    `${base}/secrets`,
    { name: "DEPLOY_TOKEN", binding: cloudflare.binding },
    alice,
  );
  assert.equal(
    (await f.json("GET", `${base}/secrets`, undefined, alice)).secrets[0]
      .version,
    2,
  );
  assert.equal(
    (await f.json("POST", `${base}/secrets/read`, {}, workload)).values
      .DEPLOY_TOKEN,
    "rotated",
  );
  await f.json(
    "PATCH",
    `${base}/collaborators`,
    { userId: "codegraff:admin", role: "writer" },
    alice,
  );
  assert.equal(
    (await f.request("POST", `${base}/secrets/read`, {}, workload)).status,
    403,
    "Demoted issuers lose workload authority",
  );
  await f.json("DELETE", `${base}/secrets`, { grantId: grant.id }, alice);
  assert.equal(
    (await f.request("POST", `${base}/secrets/read`, {}, workload)).status,
    403,
  );
  const liveReader = await socketFor(bob),
    readerClosed = closes(liveReader.socket);
  await f.json(
    "PATCH",
    `${base}/collaborators`,
    { userId: "codegraff:writer", role: null },
    alice,
  );
  await f.json(
    "POST",
    `${base}/channel`,
    { body: "hidden-after-removal" },
    alice,
  );
  await readerClosed;
  assert.ok(
    !liveReader.frames.some((frame) => frame.includes("hidden-after-removal")),
  );
  for (const who of [bob, agent])
    assert.equal((await f.request("GET", base, undefined, who)).status, 404);
  assert.ok(
    !(await f.json("GET", "/api/trunks", undefined, bob)).some(
      (t) => t.name === "independent",
    ),
  );
  const ownerGrant = await f.json(
    "POST",
    `${base}/secrets`,
    { names: ["DEPLOY_TOKEN"], ttlSeconds: 60 },
    alice,
  );
  const ownerWorkload = { authorization: `Bearer ${ownerGrant.token}` };
  for (let i = 0; i < 100; i++)
    await f.json("POST", `${base}/secrets/read`, {}, ownerWorkload);
  assert.equal(
    (await f.request("POST", `${base}/secrets/read`, {}, ownerWorkload)).status,
    403,
    "Read budget enforced",
  );
  assert.equal(
    (await f.json("GET", `${base}/secrets`, undefined, alice)).nextCleanupAt,
    null,
    "Exhausting the last grant removes the wake-up alarm",
  );
  assert.equal(
    (await (await f.mf.getWorker("vault-test")).fetch("https://vault.invalid/"))
      .status,
    404,
    "Vault has no public API",
  );
  await f.restart();
  const files = await readdir(join(f.dir, "state"), {
    recursive: true,
    withFileTypes: true,
  });
  let checked = 0;
  for (const file of files)
    if (file.isFile() && !join(file.parentPath, file.name).includes("/secrets-store/")) {
      const content = await readFile(join(file.parentPath, file.name));
      assert.equal(
        [secret, "rotated"].some(value => content.includes(Buffer.from(value))),
        false,
        "Nanohub application storage contains no secret values",
      );
      checked++;
    }
  assert.ok(checked > 0);
  assert.equal(
    (await f.json("GET", `${base}/secrets`, undefined, alice)).secrets[0]
      .version,
    2,
  );
  assert.equal(await cloudflare.read(), "rotated", "Cloudflare retains values across application restarts");
  const disconnect = await f.json("DELETE", `${base}/secrets`, {name:"DEPLOY_TOKEN"}, alice);
  assert.equal(disconnect.valueRetainedByCloudflare, true);
  assert.equal(await cloudflare.read(), "rotated", "Disconnecting a reference does not delete the Cloudflare value");
  assert.equal((await f.request("PUT", `${base}/secrets`, {name:"DEPLOY_TOKEN",value:"must-not-be-accepted"}, alice)).status,400);
  // Independent invites cannot override a Codegraff room's membership boundary.
  await f.json("POST", `${base}/team`, { roomId: ROOM }, alice);
  assert.equal(
    (await f.json("GET", `${base}/collaborators`, undefined, alice))
      .managedExternally,
    true,
  );
  console.log(
    "PASS: invitations, roles, agent revocation, independent vault RPC, scope isolation, secret rotation and workload grant revocation",
  );
} finally {
  await f.close();
}
