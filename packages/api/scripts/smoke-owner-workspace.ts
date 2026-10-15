import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { teamFixture, ROOM } from "./team/fixture.ts";

const f = await teamFixture();
const exec = promisify(execFile);
const base = "/api/trunks/owner-workspace";
try {
  const alice = await f.login("owner-alice", "101");
  const bob = await f.login("owner-bob", "202");
  await f.json("POST", base, {
    visibility: "private", files: [{path:"README.md",text:"Private source\n"}],
  }, alice);
  const access = await f.json("GET", `${base}/team`, undefined, alice);
  assert.equal(access.team.kind, "owner");
  assert.equal(access.verification.method, "owner_session");
  assert.equal(access.canConnect, true);
  // Warming private content must never bypass the next caller's access check.
  for (const path of ["/tree", "/blob?path=README.md", "/commits", "/commit/1", "/compare"]) {
    assert.equal((await f.request("GET", base+path, undefined, alice)).status, 200);
    const warm = await f.request("GET", base+path, undefined, alice);
    assert.equal(warm.headers.get("x-browse-cache"), "memory");
    assert.equal((await f.request("GET", base+path)).status, 404);
    assert.equal((await f.request("GET", base+path, undefined, bob)).status, 404);
  }
  for (const path of ["", "/bootstrap", "/repo", "/tree", "/raw?path=README.md", "/room", "/agents", "/channel", "/issues", "/brief", "/live"]) {
    assert.equal((await f.request("GET", base+path)).status, 404, path);
    assert.equal((await f.request("GET", base+path, undefined, bob)).status, 404, path);
  }
  assert.equal((await f.request("GET", "/git/owner-workspace.git/HEAD")).status, 401);
  assert.deepEqual(await f.json("GET", "/api/trunks"), []);
  assert.deepEqual(await f.json("GET", "/api/trunks", undefined, bob), []);
  assert.equal((await f.json("GET", "/api/trunks", undefined, alice)).length, 1);
  await f.json("POST", `${base}/agents`, {handle:"first-agent",type:"Codex"}, alice);
  const issued = await f.json("POST", `${base}/agents/first-agent/token`, {}, alice);
  const startup = await f.json("GET", `${base}/bootstrap`, undefined, alice);
  assert.equal(startup.session.user.id, "codegraff:owner-alice");
  assert.equal(startup.info.head.version, 1);
  assert.equal(startup.workspace.name, "owner-workspace");
  assert.equal(startup.job, null);
  assert.equal(startup.tokens.length, 1);
  assert.ok(!JSON.stringify(startup).includes(issued.token), "startup must not serialize credential secrets");
  assert.equal((await f.request("GET", `${base}/bootstrap`, undefined, bob)).status, 404);
  const credential = {authorization:`Basic ${btoa(`first-agent:${issued.token}`)}`};
  const agentStartup = await f.json("GET", `${base}/bootstrap`, undefined, credential);
  assert.equal(agentStartup.session.user, null);
  assert.deepEqual(agentStartup.tokens, []);
  const raw = await f.request("GET", `${base}/raw?path=README.md`, undefined, credential);
  assert.equal(raw.status, 200);
  assert.equal(await raw.text(), "Private source\n");
  assert.match(raw.headers.get("cache-control")!, /private/);
  const heartbeat = await f.json("POST", `${base}/agents/first-agent/heartbeat`, {status:"working", task:"First private task"}, credential);
  assert.equal(heartbeat.status, "working");
  // The real git transport must use the same owner boundary as JSON reads.
  const remote = `${f.origin.replace("://", `://first-agent:${issued.token}@`)}/git/owner-workspace.git`;
  const clone = join(f.dir, "clone");
  await exec("git", ["clone", remote, clone]);
  await exec("git", ["config", "user.name", "first-agent"], {cwd:clone});
  await exec("git", ["config", "user.email", "first-agent@example.invalid"], {cwd:clone});
  await writeFile(join(clone, "README.md"), "Private source\nFirst agent landed here.\n");
  await exec("git", ["commit", "-am", "First private change"], {cwd:clone});
  await exec("git", ["push", "origin", "HEAD:refs/for/main"], {cwd:clone});
  assert.equal((await f.json("GET", base, undefined, alice)).version, 2);
  // Owner privacy can be deliberately shared with an owned Codegraff room.
  await f.json("POST", `${base}/team`, {roomId:ROOM}, alice);
  assert.equal((await f.request("GET", base, undefined, bob)).status, 200);
  // No implicit relaxation: policy survives deletion and name reuse.
  await f.json("DELETE", base, undefined, alice);
  assert.equal((await f.request("POST", base, {files:[]}, bob)).status, 403);
  await f.json("POST", base, {files:[{path:"README.md",text:"Replacement contents\n"}]}, alice);
  const replaced = await f.json("GET", `${base}/blob?path=README.md`, undefined, alice);
  assert.equal(replaced.text, "Replacement contents\n");
  console.log("PASS: private creation, hidden lists, scoped heartbeat, real git landing, deliberate team sharing, retained boundary");
} finally { await f.close(); }
