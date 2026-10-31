import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { teamFixture } from "./team/fixture.ts";
import { recoveryFixture } from "./team/recovery.ts";

const f = await teamFixture({}, { vault: true });
const recovery = recoveryFixture(f), exec = promisify(execFile);
const trunk = "cold-recovery", base = "/api/trunks/" + trunk;
const environment = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", NANOHUB_API_TOKEN: "" };
const bearer = (credential: { token: string }) => ({ authorization: "Bearer " + credential.token });
const basic = (credential: { token: string }) => ({ authorization: "Basic " + btoa("git:" + credential.token) });
const clients: Client[] = [];
let stage = "setup";
try {
  const owner = await f.login("owner", "101"), writer = await f.login("writer", "202");
  await f.json("POST", base, { mode: "git" }, owner);
  const archivedBase = "/api/trunks/cold-archived";
  await f.json("POST", archivedBase, { files: [{ path: "README.md", text: "Retained read-only repository\n" }] }, owner);
  const archive = await f.json("GET", archivedBase + "/archive", undefined, owner);
  await f.json("POST", archivedBase + "/archive", { archived: true, revision: archive.revision, confirmation: archive.confirmation }, owner);
  const archiveBefore = await f.json("GET", archivedBase + "/archive", undefined, owner);
  await f.json("POST", "/api/namespaces", { name: "recovery-owner" }, owner);
  await f.json("POST", "/api/repository-addresses/" + trunk, { namespace: "recovery-owner", name: "project" }, owner);
  const invitation = await f.json("POST", base + "/collaborators", { userId: "codegraff:writer", role: "writer" }, owner);
  await f.json("POST", "/api/invitations/accept", { trunk, token: invitation.token }, writer);
  const gitCredential = await f.json("POST", base + "/git-tokens", { label: "Cold restore Git seed" }, owner);
  const cliCredential = await f.json("POST", base + "/cli-credentials", { label: "Cold restore read", scopes: ["read", "contents:read"], days: 1 }, owner);
  const runner = await f.json("POST", base + "/ci/runners", { name: "cold-restore" }, owner);
  await f.json("POST", base + "/agents", { handle: "builder", type: "Any MCP client" }, owner);
  const agent = await f.json("POST", base + "/agents/builder/token", {}, owner);
  const source = join(f.dir, "source"); await mkdir(source);
  const git = async (directory: string, ...args: string[]) => (await exec("git", ["-C", directory, "-c", "user.name=Recovery fixture", "-c", "user.email=fixture@example.invalid", ...args], { env: environment })).stdout.trim();
  const remote = f.origin + "/git/recovery-owner/project.git";
  const transport = async (credential: { token: string }, ...args: string[]) => exec("git", ["-C", source, ...args], { env: { ...environment, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.extraHeader", GIT_CONFIG_VALUE_0: "Authorization: " + basic(credential).authorization } });
  await git(source, "init", "-b", "main");
  const binary = Buffer.alloc(1024 * 1024 + 17);
  for (let i = 0; i < binary.length; i++) binary[i] = (i * 37 + (i >> 8)) & 255;
  await writeFile(join(source, "README.md"), "Base\n");
  await writeFile(join(source, "asset.bin"), binary);
  await writeFile(join(source, "run.sh"), "#!/bin/sh\nprintf 'recovered\\n'\n");
  await chmod(join(source, "run.sh"), 0o755);
  await symlink("README.md", join(source, "readme-link"));
  await git(source, "add", "."); await git(source, "commit", "-m", "Recovery base");
  const anchor = await git(source, "rev-parse", "HEAD");
  await git(source, "tag", "-a", "v1.0.0", "-m", "Annotated recovery tag");
  await transport(gitCredential, "push", remote, "main", "refs/tags/v1.0.0");
  await git(source, "checkout", "-b", "検証/restore-🚀");
  await writeFile(join(source, "README.md"), "Candidate\nReview this hunk\n");
  await git(source, "commit", "-am", "Recovery candidate");
  const commit = await git(source, "rev-parse", "HEAD");
  await transport(gitCredential, "push", remote, "HEAD:refs/heads/検証/restore-🚀");
  const policy = { branch: "main", pullRequest: true, approvals: 1, checks: [], beforeOpen: [], preventForce: true, preventDelete: true, requireConversationResolution: true, successOnlyChecks: true };
  await f.json("PUT", base + "/protection", policy, owner);
  await f.json("PUT", base + "/protection", { ...policy, branch: "locked/*", locked: true }, owner);
  await f.json("POST", base + "/rulesets", { name: "Retain release tags", target: "tag", enforcement: "active", conditions: { ref_name: { include: ["~ALL"], exclude: [] } }, rules: [{ type: "deletion" }, { type: "non_fast_forward" }], bypass_actors: [] }, owner);
  await f.json("POST", base + "/pulls", { title: "Recovery review", head: "検証/restore-🚀" }, owner);
  const reviewerRequest={reviewers:['codegraff:writer'],revision:0,commit,anchor};
  await f.json('POST',base+'/pulls/1/requested-reviewers',reviewerRequest,{...owner,'If-Match':'"review-requests-0"'});
  await f.json("POST", base + "/pulls/1/reviews", { commit, anchor, verdict: "APPROVE", body: "Independent review retained" }, writer);
  const answeredRequest=await f.json('GET',base+'/pulls/1/requested-reviewers',undefined,owner);assert.equal(answeredRequest.requests[0].state,'reviewed');assert.equal(answeredRequest.revision,2);
  await f.json('POST',base+'/pulls/1/requested-reviewers',{...reviewerRequest,revision:2},{...owner,'If-Match':'"review-requests-2"'});
  await f.json("POST", base + "/pulls/1/comments", { id: "recovery-hunk", commit, anchor, path: "README.md", side: "RIGHT", startLine: 2, line: 2, body: "Keep this thread unresolved" }, writer);
  await f.json("POST", base + "/issues", { title: "Recovery issue", body: "Room metadata must survive" }, owner);
  const mcp = new Client({ name: "Cold recovery fixture", version: "1" }); clients.push(mcp);
  await mcp.connect(new StreamableHTTPClientTransport(new URL(f.origin + base + "/agents/builder/mcp"), { requestInit: { headers: bearer(agent) } }));
  const sessionId = crypto.randomUUID();
  assert.ok(!(await mcp.callTool({ name: "nanohub_start_work", arguments: { sessionId, title: "Retained agent attribution" } })).isError);
  await mcp.close();
  const secret = "synthetic-cloudflare-owned-recovery-value";
  const rotated = "synthetic-cloudflare-owned-newer-than-backup";
  const cloudflare = await f.provisionSecret(trunk, "staging", "DEPLOY_TOKEN", secret);
  await f.json("PUT", base + "/secrets", { name: "DEPLOY_TOKEN", binding: cloudflare.binding }, owner);
  const workload = await f.json("POST", base + "/secrets", { names: ["DEPLOY_TOKEN"], ttlSeconds: 900 }, owner);
  assert.equal((await f.request("GET", "/api/cli/trunks/" + trunk + "/branches", undefined, bearer(cliCredential))).status, 200);
  stage = "old snapshot";
  const old = await recovery.checkpoint();
  assert.equal(await old.contains(secret), false);
  const revoke = async () => {
    await f.json("DELETE", "/api/tokens/" + gitCredential.id, undefined, owner);
    await f.json("DELETE", "/api/tokens/" + agent.id, undefined, owner);
    await f.json("DELETE", "/api/cli/credentials/" + cliCredential.id, undefined, owner);
    await f.json("DELETE", base + "/ci/" + runner.id, undefined, owner);
    await f.json("DELETE", base + "/secrets", { grantId: workload.id }, owner);
    await f.json("PATCH", base + "/collaborators", { userId: "codegraff:writer", role: null }, owner);
  };
  const revoked = async () => {
    assert.equal((await f.request("GET", base + "/branches", undefined, writer)).status, 404);
    for (const credential of [gitCredential, agent])
      assert.equal((await f.request("GET", "/git/" + trunk + ".git/HEAD", undefined, basic(credential))).status, 401);
    assert.equal((await f.request("GET", "/api/cli/trunks/" + trunk + "/branches", undefined, bearer(cliCredential))).status, 401);
    assert.equal((await f.request("POST", base + "/ci/claim", {}, bearer(runner))).status, 403);
    assert.equal((await f.request("POST", base + "/secrets/read", {}, bearer(workload))).status, 403);
    assert.equal((await f.request("POST", base + "/agents/builder/mcp", {}, bearer(agent))).status, 401);
  };
  await revoke(); await revoked(); await cloudflare.update(rotated);
  const paths = ["/repository", "/branches", "/default-branch", "/protection", "/rulesets", "/repository/audit", "/issues", "/contributions", "/secrets", "/ci/runners", "/pulls/1/requested-reviewers"];
  const before = await Promise.all(paths.map(path => f.json("GET", base + path, undefined, owner)));
  const beforePull = await f.json("GET", base + "/pulls/1", undefined, owner);
  assert.equal(beforePull.reviews.length, 1);
  assert.equal(beforePull.discussion.comments.length, 1);
  assert.equal(beforePull.discussion.comments[0].body, "Keep this thread unresolved");
  assert.equal(beforePull.discussion.comments[0].resolved, false);
  assert.equal(beforePull.discussion.comments[0].commit, commit);
  assert.ok(JSON.stringify(before[paths.indexOf("/issues")]).includes("Recovery issue"));
  assert.equal(before[paths.indexOf("/contributions")].events[0].sessionId, sessionId);
  const authRows = async () => {
    const db = await f.mf.getD1Database("AUTH_DB");
    return {
      accounts: (await db.prepare('SELECT * FROM "account" ORDER BY "userId"').all()).results,
      credential: await db.prepare("SELECT * FROM cli_credentials WHERE id=?").bind(cliCredential.id).first(),
    };
  };
  const beforeAuth = await authRows();
  assert.equal(beforeAuth.accounts.length, 2);
  assert.ok(beforeAuth.credential?.revokedAt);
  const r2Inventory = async () => {
    const result = await (await f.mf.getR2Bucket("OBJECTS")).list();
    assert.equal(result.truncated, false, "The drill inventories every R2 object");
    return result.objects.map(object => ({ key: object.key, size: object.size }));
  };
  const beforeR2 = await r2Inventory();
  assert.ok(beforeR2.length > 0);
  const current = await recovery.checkpoint();
  assert.equal(await current.contains(secret), false); assert.equal(await current.contains(rotated), false);
  stage = "snapshot corruption refusal";
  const first = current.files.find(file => file.bytes > 0)!;
  const file = join(current.directory, first.path), bytes = await readFile(file);
  await writeFile(file, Buffer.concat([bytes, Buffer.from("corruption")]));
  await assert.rejects(current.restore(), /integrity mismatch/);
  await revoked();
  await writeFile(file, bytes);
  stage = "physical loss";
  await recovery.loseApplicationStorage();
  const missing = await f.request("GET", base + "/branches", undefined, owner);
  assert.equal(missing.status, 400);
  assert.equal((await missing.json() as { error: string }).error, "no such trunk");
  assert.equal((await (await f.mf.getD1Database("AUTH_DB")).prepare("SELECT name FROM sqlite_master WHERE name='account'").all()).results.length, 0);
  assert.deepEqual(await r2Inventory(), []);
  assert.equal((await f.request("GET", "/git/recovery-owner/project.git/HEAD", undefined, basic(cliCredential))).status, 404);
  assert.equal(await cloudflare.read(), rotated, "Cloudflare values remain outside application storage loss");
  stage = "full cold restore";
  await current.restore();
  await revoked();
  assert.deepEqual(await authRows(), beforeAuth, "D1 identity links and revoked CLI credential rows recovered exactly");
  assert.deepEqual(await r2Inventory(), beforeR2, "Every R2 object key and size is retained");
  assert.equal((await f.request("GET", base + "/branches")).status, 404, "Restored data remains private");
  assert.deepEqual(await f.json("GET", archivedBase + "/archive", undefined, owner), archiveBefore);
  assert.equal((await f.request("POST", archivedBase + "/issues", { title: "Must remain locked", body: "Recovery cannot reopen an archive" }, owner)).status, 403);
  const archiveFences = await f.json("GET", "/fixture/archive-state?trunk=cold-archived");
  for (const component of ["hub", "sequencer", "room"]) assert.equal(archiveFences[component].archived, true);
  const after = await Promise.all(paths.map(path => f.json("GET", base + path, undefined, owner)));
  assert.deepEqual(after, before, "Git graph, policies, audit, Room, agent work, vault references and runner state match the checkpoint");
  const afterPull = await f.json("GET", base + "/pulls/1", undefined, owner);
  for (const key of ["pull", "reviews", "discussion", "effectivePolicies", "reviewGate"]) {
    assert.ok(beforePull[key] !== undefined, "Checkpoint PR field exists: " + key);
    assert.deepEqual(afterPull[key], beforePull[key], "Retained PR field: " + key);
  }
  assert.equal(afterPull.reviewGate.approvals, 0, "Removed reviewer cannot regain approval authority");
  assert.match(afterPull.reviewGate.error, /review|conversation/i);
  const restoredGrant = await f.json("POST", base + "/secrets", { names: ["DEPLOY_TOKEN"], ttlSeconds: 900 }, owner);
  assert.equal((await f.json("POST", base + "/secrets/read", {}, bearer(restoredGrant))).values.DEPLOY_TOKEN, rotated);
  await f.json("DELETE", base + "/secrets", { grantId: restoredGrant.id }, owner);
  assert.equal((await f.json("GET", base + "/secrets", undefined, owner)).nextCleanupAt, null);
  const fresh = await f.json("POST", base + "/git-tokens", { label: "Post-recovery verification only" }, owner);
  const clone = join(f.dir, "restored-clone"); await transport(fresh, "clone", "--mirror", remote, clone);
  await git(clone, "fsck", "--strict");
  for (const args of [["for-each-ref", "--format=%(refname) %(objectname)"], ["rev-list", "--objects", "--all"], ["ls-tree", "-r", anchor]])
    assert.equal(await git(clone, ...args), await git(source, ...args));
  const restoredBinary = await exec("git", ["-C", clone, "show", anchor + ":asset.bin"], { env: environment, encoding: "buffer", maxBuffer: 2 * 1024 * 1024 });
  assert.deepEqual(restoredBinary.stdout, binary);
  await assert.rejects(transport(fresh, "push", remote, "HEAD:refs/heads/main"), /reviewed pull request/);
  await assert.rejects(transport(fresh, "push", remote, "HEAD:refs/heads/locked/recovery"), /locked/i);
  await assert.rejects(transport(fresh, "push", remote, ":refs/tags/v1.0.0"), /delet/i);
  assert.equal((await f.request("POST", base + "/pulls/1/merge", { commit, anchor }, owner)).status, 400);
  stage = "older-checkpoint revocation hazard";
  // This intentionally exposes the rollback hazard only inside an isolated
  // loopback fixture. An old backup is not authority to reopen production.
  await f.setRecoveryHold("1");
  await old.restore();
  const heldRequests: [string, string, unknown, Record<string, string>?][] = [
    ["GET", base + "/branches", undefined, writer],
    ["GET", base + "/protection", undefined, owner],
    ["GET", "/git/" + trunk + ".git/HEAD", undefined, basic(gitCredential)],
    ["GET", "/api/cli/trunks/" + trunk + "/branches", undefined, bearer(cliCredential)],
    ["POST", base + "/ci/claim", {}, bearer(runner)],
    ["POST", base + "/secrets/read", {}, bearer(workload)],
    ["POST", base + "/agents/builder/mcp", {}, bearer(agent)],
    ["GET", base + "/live", undefined, owner],
    ["GET", "/api/auth/signin/codegraff", undefined],
    ["GET", "/api/agent-help", undefined],
  ];
  for (const [method, path, body, headers] of heldRequests) {
    const response = await f.request(method, path, body, headers);
    assert.equal(response.status, 503, path);
    assert.equal((await response.json() as { code: string }).code, "recovery_hold");
  }
  await f.restart();
  assert.equal((await f.request("GET", base + "/branches", undefined, owner)).status, 503);
  // Release only this already isolated loopback fixture to demonstrate the
  // hazard and reconcile through owner APIs. A public recovery stays closed.
  await f.setRecoveryHold("0");
  assert.equal((await f.request("GET", base + "/branches", undefined, writer)).status, 200);
  assert.equal((await f.request("GET", "/git/" + trunk + ".git/HEAD", undefined, basic(gitCredential))).status, 200);
  assert.equal((await f.request("GET", "/api/cli/trunks/" + trunk + "/branches", undefined, bearer(cliCredential))).status, 200);
  assert.equal((await f.request("POST", base + "/secrets/read", {}, bearer(workload))).status, 200);
  assert.equal((await f.request("POST", base + "/ci/claim", {}, bearer(runner))).status, 200);
  const restoredMcp = new Client({ name: "Old backup hazard probe", version: "1" }); clients.push(restoredMcp);
  await restoredMcp.connect(new StreamableHTTPClientTransport(new URL(f.origin + base + "/agents/builder/mcp"), { requestInit: { headers: bearer(agent) } }));
  assert.equal((await restoredMcp.listTools()).tools.length, 5);
  await restoredMcp.close();
  assert.equal(await cloudflare.read(), rotated, "Restoring application metadata cannot rewind Cloudflare values");
  stage = "reconcile before reopening";
  await revoke(); await revoked();
  await f.restart(); await revoked();
  console.log(JSON.stringify({
    kind: "nanohub-local-cold-recovery", version: 1, completedAt: new Date().toISOString(),
    scope: "isolated Miniflare DO/D1/R2; Cloudflare Secrets Store simulated separately",
    liveCloudflareRestore: false, productionTrafficReadinessEstablished: false,
    checkpoint: { files: current.files.length, bytes: current.files.reduce((n, file) => n + file.bytes, 0), resources: ["do", "d1", "r2"], providerValuesIncluded: false },
    verified: { physicalLoss: true, checksumRefusalBeforeMutation: true, exactGitGraphAndBytes: true, policiesAndLocks: true, archiveFences: true, reviewsAndHunks: true, roomAndAgentHistory: true, d1IdentityAndCliRows: true, asOfCheckpointRevocations: true, laterCloudflareRotationRetained: true, idleVaultAlarmAbsent: true, requestHoldSurvivesOlderRestoreAndRestart: true, olderCheckpointResurrectsAuthority: true, explicitReconciliationAndRestartDeniesAgain: true },
  }));
  console.log("PASS: cold DO/D1/R2 loss and checksum-verified restore; exact Git refs/objects/binary/modes/tag, policies/locks, Room/PR/hunk/audit/agent metadata; as-of-checkpoint revocations, fresh-role review denial; Cloudflare-owned values excluded and later rotation retained; unused vault has no alarm; demonstrated older-backup authority resurrection and explicit reconciliation/restart denial");
} catch (error) {
  console.error("Recovery acceptance failed at:", stage);
  throw error;
} finally {
  for (const client of clients) await client.close().catch(() => {});
  await f.close();
}
