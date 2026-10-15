import assert from "node:assert/strict";
import test from "node:test";
import { importWithAccess } from "../src/github/import-access.ts";

test("private imports use the signed-in credential", async () => {
  const result = await importWithAccess(async () => "user-token", "server-token", async (token) => {
    assert.equal(token, "user-token");
    return ["file"];
  });
  assert.deepEqual(result, { imported: ["file"], token: "user-token" });
});

test("a rejected private credential never becomes a misleading sign-in error", async () => {
  await assert.rejects(importWithAccess(
    async () => { throw new Error("GitHub refused access for the connected installation."); },
    null,
    async () => { throw new Error("not found; sign in"); },
  ), (error) => {
    assert.match(error.message, /You are signed in/);
    assert.match(error.message, /connected installation/);
    assert.doesNotMatch(error.message, /not found; sign in/);
    return true;
  });
});

test("public repositories still import if credential issuance is unavailable", async () => {
  const result = await importWithAccess(
    async () => { throw new Error("connection unavailable"); }, null,
    async (token) => { assert.equal(token, null); return "public files"; },
  );
  assert.equal(result.imported, "public files");
});

test("download failures after successful authentication retain their cause", async () => {
  await assert.rejects(importWithAccess(async () => "token", null, async () => {
    throw new Error("repository exceeds size limit");
  }), /repository exceeds size limit/);
});

test("anonymous import retains anonymous access behavior", async () => {
  await assert.rejects(importWithAccess(null, null, async () => {
    throw new Error("not found; sign in");
  }), /not found; sign in/);
});
