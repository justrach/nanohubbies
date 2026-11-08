import test from "node:test";
import assert from "node:assert/strict";
import { createSandboxAccessPreflight } from "../../../tools/sandbox-access.mjs";

const tick = () => new Promise(resolve => setImmediate(resolve));

test("concurrent repository workers share one read-only access check and bounded success receipt", async () => {
  let checks = 0, release, clock = 1000;
  const blocked = new Promise(resolve => { release = resolve; });
  const verify = createSandboxAccessPreflight({ now: () => clock, ttlMs: 100,
    probe: async key => { checks++; assert.equal(key, "synthetic-account-key"); await blocked; return { accountInventory: "must-not-retain" }; } });
  const pending = Array.from({ length: 20 }, () => verify("synthetic-account-key"));
  await tick(); assert.equal(checks, 1); release();
  const results = await Promise.all(pending);
  assert.deepEqual(results[0], { sandboxAccessVerified: true, checkedAt: 1000, expiresAt: 1100 });
  assert.ok(results.every(result => result === results[0]));
  assert.equal(JSON.stringify(results).includes("must-not-retain"), false);
  assert.equal(JSON.stringify(results).includes("synthetic-account-key"), false);
  clock = 1099; await verify("synthetic-account-key"); assert.equal(checks, 1);
  clock = 1100; await verify("synthetic-account-key"); assert.equal(checks, 2);
});

test("key rotation and clock rollback cannot reuse another cached authorization", async () => {
  let clock = 1000; const checked = [];
  const verify = createSandboxAccessPreflight({ now: () => clock, probe: async key => checked.push(key) });
  await verify("first-key"); await verify("second-key"); await verify("first-key");
  assert.deepEqual(checked, ["first-key", "second-key"]);
  clock = 999; await verify("first-key"); assert.deepEqual(checked, ["first-key", "second-key", "first-key"]);
});

test("scope failures coalesce across workers, cache briefly and permit recovery after key repair", async () => {
  let checks = 0, clock = 1000, valid = false;
  const verify = createSandboxAccessPreflight({ now: () => clock, failureTtlMs: 50, probe: async () => {
    checks++; if (!valid) throw Object.assign(Error("Codegraff API key requires the sandbox scope for Actions"), { status: 403 });
  } });
  const failed = await Promise.allSettled(Array.from({ length: 8 }, () => verify("scoped-key")));
  assert.equal(checks, 1);
  for (const result of failed) {
    assert.equal(result.status, "rejected"); assert.equal(result.reason.code, "sandbox_scope_required");
    assert.equal(result.reason.status, 403); assert.match(result.reason.message, /no CI job was claimed/);
  }
  clock = 1049; await assert.rejects(verify("scoped-key")); assert.equal(checks, 1);
  valid = true; clock = 1050;
  assert.equal((await verify("scoped-key")).sandboxAccessVerified, true); assert.equal(checks, 2);
});

test("synchronous probe failure cannot leave a permanently rejected pending entry", async () => {
  let clock = 1000, checks = 0;
  const verify = createSandboxAccessPreflight({ now: () => clock, failureTtlMs: 1,
    probe: () => { if (++checks === 1) throw Error("private-provider-body"); } });
  await assert.rejects(verify("valid-key"), /could not be verified/);
  clock++;
  assert.equal((await verify("valid-key")).sandboxAccessVerified, true);
  assert.equal(checks, 2);
});

test("provider bodies, credentials and transport errors are excluded from safe failures", async () => {
  for (const failure of [
    Object.assign(Error("private-provider-body"), { status: 401 }),
    Object.assign(Error("private-provider-body"), { status: 403 }),
    Object.assign(Error("private-provider-body"), { status: 429 }),
    Object.assign(Error("private-provider-body"), { status: 503 }),
    Object.assign(Error("private-provider-body"), { code: "ECONNRESET" }),
    SyntaxError("private-provider-body"),
  ]) {
    const verify = createSandboxAccessPreflight({ probe: async () => { throw failure; } });
    await assert.rejects(verify("private-key-value"), error => {
      assert.equal(error.code, "sandbox_access_unverified");
      assert.match(error.message, /no CI job was claimed/);
      assert.equal(String(error).includes("private-provider-body"), false);
      assert.equal(String(error).includes("private-key-value"), false);
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});

test("missing, malformed and oversized keys never reach the provider", async () => {
  let checks = 0;
  const verify = createSandboxAccessPreflight({ probe: async () => { checks++; } });
  for (const key of [undefined, null, "", "bad\nvalue", "bad value", "bad\x7fvalue", "x".repeat(4097)])
    await assert.rejects(verify(key), /valid single-line/);
  assert.equal(checks, 0);
});

test("cache retention and configuration bounds are explicit", async () => {
  let checks = 0;
  const verify = createSandboxAccessPreflight({ maxEntries: 1, probe: async () => { checks++; } });
  await verify("first"); await verify("second"); await verify("first"); assert.equal(checks, 3);
  for (const options of [{ ttlMs: 0 }, { ttlMs: 300001 }, { failureTtlMs: 5001 }, { maxEntries: 0 }, { maxEntries: 17 }])
    assert.throws(() => createSandboxAccessPreflight(options), /cache bounds/);
});
test('list failures and explicit owned-resource probes have separate cache identities without fallback',async()=>{
 const calls=[],verify=createSandboxAccessPreflight({probe:async(key,{sandboxId})=>{calls.push([key,sandboxId??null]);if(!sandboxId)throw Object.assign(Error('private list failure'),{status:503});}});
 await assert.rejects(verify('one-key'),/could not be verified/);
 await verify('one-key',{sandboxId:'owned-one'});await verify('one-key',{sandboxId:'owned-one'});
 await assert.rejects(verify('one-key'),/could not be verified/);
 await verify('one-key',{sandboxId:'owned-two'});await verify('other-key',{sandboxId:'owned-one'});
 assert.deepEqual(calls,[['one-key',null],['one-key','owned-one'],['one-key','owned-two'],['other-key','owned-one']]);
});
test('invalid owned-resource paths never reach the provider',async()=>{
 let calls=0;const verify=createSandboxAccessPreflight({probe:async()=>calls++});
 for(const sandboxId of ['',null,1,'https://private.invalid/','../other','owned?all=1','owned/other','owned%2fother','x'.repeat(161)])await assert.rejects(verify('synthetic-key',{sandboxId}),/trusted sandbox ID/);
 assert.equal(calls,0);
});
test('owned-resource access uses a single scope-enforced read and discards provider metadata',async()=>{
 const original=globalThis.fetch,calls=[],sandboxId='cnd_'+'a'.repeat(40);
 try{
  globalThis.fetch=async(url,options)=>{calls.push([String(url),options.method]);assert.equal(options.headers.Authorization,'Bearer synthetic-owned-key');return Response.json({id:sandboxId,state:'destroyed',privateInventory:'must-not-retain'});};
  const result=await createSandboxAccessPreflight()('synthetic-owned-key',{sandboxId});assert.equal(result.sandboxAccessVerified,true);assert.ok(!JSON.stringify(result).includes('must-not-retain'));assert.ok(!JSON.stringify(result).includes('synthetic-owned-key'));
  assert.deepEqual(calls,[['https://gateway.codegraff.com/v1/sandboxes/'+sandboxId,'GET']]);
 }finally{globalThis.fetch=original;}
});
test('foreign, malformed, missing and denied owned-resource reads cannot verify access or fall back to listing',async()=>{
 const original=globalThis.fetch,sandboxId='cnd_'+'b'.repeat(40);
 try{
  for(const [status,body] of [[200,{id:'foreign',state:'destroyed'}],[200,{id:sandboxId}],[200,{id:sandboxId,state:'x'.repeat(33)}],[401,{error:'private-detail'}],[403,{error:{type:'insufficient_scope',message:'private-detail'}}],[404,{error:'private-detail'}],[503,{error:'private-detail'}]]){
   let calls=0;globalThis.fetch=async(url)=>{calls++;assert.equal(String(url),'https://gateway.codegraff.com/v1/sandboxes/'+sandboxId);return Response.json(body,{status});};
   await assert.rejects(createSandboxAccessPreflight()('synthetic-owned-key',{sandboxId}),error=>{assert.ok(!String(error).includes('private-detail'));assert.match(error.message,/no CI job was claimed/);if(status===403)assert.equal(error.code,'sandbox_scope_required');return true;});assert.equal(calls,1);
  }
 }finally{globalThis.fetch=original;}
});
test('default sandbox listing verifies documented array shapes and rejects other successful JSON bodies',async()=>{
 const original=globalThis.fetch;
 try{
  for(const body of [[],{sandboxes:[]}]){globalThis.fetch=async()=>Response.json(body);assert.equal((await createSandboxAccessPreflight()('synthetic-list-key')).sandboxAccessVerified,true);}
  for(const body of [{error:'private-error'},'private-error',null]){globalThis.fetch=async()=>Response.json(body);await assert.rejects(createSandboxAccessPreflight()('synthetic-list-key'),/could not be verified/);}
 }finally{globalThis.fetch=original;}
});
