import test from "node:test";
import assert from "node:assert/strict";
import { deployHeldFixturePhase, phaseDeploymentSnapshot } from "./phase-deploy.mjs";
import {retainedAssetPhaseConfiguration,assertRetainedAssetPhase} from './phase-assets.mjs';
import {fixturePlan,classes} from '../hosted-git-fixture/config.mjs';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const accountId = "a".repeat(32), runId = "mabcdefgh-0123456789";
const worker = `nh-vault-recovery-${runId}-app`;
const oldVersion = "11111111-1111-1111-1111-111111111111";
const newVersion = "22222222-2222-2222-2222-222222222222";
const observation = (version = oldVersion, phase = "verify") => ({
  version, metadata: { id: version, resources: {
    script: { etag: "fixture-code-hash" },
    script_runtime: { limits: { subrequests: 50000 }, compatibility_date: "2026-09-01" },
    bindings: [
      { name: "NANOHUB_RECOVERY_HOLD", type: "plain_text", text: "1" },
      { name: "HOSTED_REPO_RECOVERY", type: "plain_text", text: "1" },
      { name: "HOSTED_REPO_PHASE", type: "plain_text", text: phase },
      { name: "OBJECTS", type: "r2_bucket", bucket_name: "owned-bucket" },
    ],
  } },
});
const failure = () => ({ code: 1, stdout: "Starting asset upload...", stderr:
  `A request to the Cloudflare API (/accounts/${accountId}/workers/scripts/${worker}/assets-upload-session) failed.\nUnknown error [code: 10013]`, step: "049-deploy" });
const success = () => ({ code: 0, stdout: `Current Version ID: ${newVersion}`, stderr: "" });
const consumed = () => ({ code: 1, stdout: "Total Upload: 13149 KiB", stderr:
  `A request to the Cloudflare API (/accounts/${accountId}/workers/scripts/${worker}/versions) failed.\nCompletion token has already been consumed [code: 100312]`, step: "043-deploy" });
function fixture({ results = [failure(), success()], observations = [observation(), observation(newVersion, "frozen")] } = {}) {
  const calls = [], receipts = [], failures = [];
  let deployments = 0, reads = 0;
  const options = {
    accountId, runId, worker, purpose: "vault-recovery", phase: "frozen", previousPhase: "verify",
    previous: observation(),
    deployOnce: async () => { calls.push("deploy"); return results[deployments++]; },
    observe: async () => { calls.push("observe"); return observations[reads++]; },
    recordRetry: async receipt => { calls.push("receipt"); receipts.push(receipt); },
    recordFailure: async receipt => { calls.push("failure-receipt"); failures.push(receipt); },
    sleep: async ms => { assert.equal(ms, 1000); calls.push("backoff"); },
  };
  return { options, calls, receipts, failures };
}

test("one exact asset-session failure retries only after unchanged held metadata and a persisted proof", async () => {
  const f = fixture();
  const result = await deployHeldFixturePhase(f.options);
  assert.equal(result.version, newVersion);
  assert.equal(result.attempts, 2);
  assert.deepEqual(f.calls, ["deploy", "backoff", "observe", "receipt", "deploy", "observe"]);
  assert.equal(f.receipts.length, 1);
  assert.equal(f.receipts[0].failedStep, "049-deploy");
  assert.deepEqual(f.receipts[0].previous, f.receipts[0].observed);
  assert.equal(JSON.stringify(f.receipts).includes("owned-bucket"), false);
});

test("ordinary successful phase deployment still requires acknowledged active target phase", async () => {
  const f = fixture({ results: [success()], observations: [observation(newVersion, "frozen")] });
  assert.equal((await deployHeldFixturePhase(f.options)).attempts, 1);
  assert.deepEqual(f.calls, ["deploy", "observe"]);
  assert.equal(f.receipts.length, 0);
});

test("fingerprint covers the complete resource graph and canonicalizes binding/object order", () => {
  const before = observation(), reordered = observation();
  reordered.metadata.resources.bindings.reverse();
  reordered.metadata.resources.script_runtime = { compatibility_date: "2026-09-01", limits: { subrequests: 50000 } };
  const expected = phaseDeploymentSnapshot(before, "verify");
  assert.deepEqual(phaseDeploymentSnapshot(reordered, "verify"), expected);
  for (const mutate of [
    value => { value.metadata.resources.script.etag = "different-code"; },
    value => { value.metadata.resources.script_runtime.limits.subrequests = 1000; },
    value => { value.metadata.resources.bindings.at(-1).bucket_name = "other-bucket"; },
    value => { value.metadata.resources.assets = { unexpected: true }; },
  ]) {
    const changed = observation(); mutate(changed);
    assert.notEqual(phaseDeploymentSnapshot(changed, "verify").resourceSha256, expected.resourceSha256);
  }
});

test("unowned workers, accounts, purposes and malformed baselines fail before any deployment", async () => {
  for (const overrides of [
    { worker: "production-app" }, { worker: worker.replace(runId, "manotherx-0123456789") },
    { accountId: "invalid" }, { runId: "invalid" }, { purpose: "git-import" }, { phase: "open" },
    { previousPhase: "open" }, { recordRetry: undefined }, { recordFailure: undefined },
  ]) {
    const f = fixture();
    await assert.rejects(() => deployHeldFixturePhase({ ...f.options, ...overrides }));
    assert.deepEqual(f.calls, []);
  }
  for (const mutate of [
    value => { value.version = "invalid"; },
    value => { value.metadata.id = newVersion; },
    value => { value.metadata.resources.bindings[0].text = "0"; },
    value => { value.metadata.resources.bindings.push(value.metadata.resources.bindings[0]); },
    value => { delete value.metadata.resources.script_runtime; },
  ]) {
    const f = fixture(); mutate(f.options.previous);
    await assert.rejects(() => deployHeldFixturePhase(f.options));
    assert.deepEqual(f.calls, []);
  }
});

test("ambiguous, authenticated, post-upload and unrelated failures never retry", async () => {
  const variants = [
    { stderr: "fetch failed" }, { stderr: "Unknown error [code: 10013]" },
    { timedOut: true }, { executionUncertain: true },
    ...["Uploaded app", "Deployed triggers", `Current Version ID: ${oldVersion}`, "[code: 10000]", "401", "403", "authentication failed", "permission denied", "ECONNRESET", "fetch failed", "timed out"].map(extra => ({ stdout: extra })),
    { stderr: failure().stderr.replace(accountId, "b".repeat(32)) },
    { stderr: failure().stderr.replace(worker, "production-app") },
    { stderr: failure().stderr.replace("assets-upload-session", "versions") },
    { stderr: failure().stderr.replace("10013", "10000") },
    { stderr: failure().stderr + "\n" + failure().stderr },
  ];
  for (const overrides of variants) {
    const f = fixture({ results: [{ ...failure(), ...overrides }] });
    await assert.rejects(() => deployHeldFixturePhase(f.options));
    assert.deepEqual(f.calls, ["deploy"], JSON.stringify(overrides));
    assert.deepEqual(f.receipts, []);
  }
});

test("version, binding, runtime and phase drift refuse a second deployment", async () => {
  const changes = [
    observation(newVersion),
    observation(oldVersion, "frozen"),
    observation(), observation(), observation(),
  ];
  changes[2].metadata.resources.bindings.at(-1).bucket_name = "other-bucket";
  changes[3].metadata.resources.script_runtime.limits.subrequests = 100;
  changes[4].metadata.resources.bindings[0].text = "0";
  for (const changed of changes) {
    const f = fixture({ observations: [changed] });
    await assert.rejects(() => deployHeldFixturePhase(f.options));
    assert.deepEqual(f.calls, ["deploy", "backoff", "observe"]);
    assert.equal(f.receipts.length, 0);
  }
});

test("failed provider observation or proof persistence prevents retry", async () => {
  for (const operation of ["observe", "recordRetry", "sleep"]) {
    const f = fixture();
    f.options[operation] = async () => { throw Error("injected failure"); };
    await assert.rejects(() => deployHeldFixturePhase(f.options), /injected failure/);
    assert.equal(f.calls.filter(value => value === "deploy").length, 1);
  }
});

test("at most two deployment attempts even when the exact failure recurs", async () => {
  const f = fixture({ results: [failure(), failure()] });
  await assert.rejects(() => deployHeldFixturePhase(f.options), /Phase deployment failed/);
  assert.deepEqual(f.calls, ["deploy", "backoff", "observe", "receipt", "deploy"]);
  assert.equal(f.receipts.length, 1);
});

test("a thrown deploy or success without one valid acknowledgement cannot retry", async () => {
  for (const stdout of ["", "Current Version ID: bad", `Current Version ID: ${newVersion}x`, `Current Version ID: ${newVersion}\nCurrent Version ID: ${newVersion}`]) {
    const f = fixture({ results: [{ code: 0, stdout, stderr: "" }] });
    await assert.rejects(() => deployHeldFixturePhase(f.options), /not acknowledged/);
    assert.deepEqual(f.calls, ["deploy"]);
  }
  const f = fixture();
  f.options.deployOnce = async () => { f.calls.push("deploy"); throw Error("unknown mutation outcome"); };
  await assert.rejects(() => deployHeldFixturePhase(f.options), /unknown mutation outcome/);
  assert.deepEqual(f.calls, ["deploy"]);
});

test("a successful command with inactive version or wrong target phase stays closed", async () => {
  for (const observed of [observation(oldVersion, "frozen"), observation(newVersion, "verify")]) {
    const f = fixture({ results: [success()], observations: [observed] });
    await assert.rejects(() => deployHeldFixturePhase(f.options));
    assert.deepEqual(f.calls, ["deploy", "observe"]);
  }
});

test("a consumed version-upload token records the held active version but never retries or accepts it", async () => {
  const states = [observation(), observation(newVersion, "frozen"), observation(newVersion, "seed")];
  states[2].metadata.resources.script.etag = "unexpected-code";
  for (const state of states) {
    const f = fixture({ results: [consumed()], observations: [state] });
    await assert.rejects(() => deployHeldFixturePhase(f.options), /completion is uncertain \(100312\)/);
    assert.deepEqual(f.calls, ["deploy", "observe", "failure-receipt"]);
    assert.equal(f.receipts.length, 0);
    assert.equal(f.failures.length, 1);
    const proof = f.failures[0];
    assert.equal(proof.reason, "owned-version-upload-completion-token-consumed-100312");
    assert.equal(proof.failedStep, "043-deploy");
    assert.equal(proof.commandAttempts, 1);
    assert.equal(proof.observation, "verified-held-version");
    assert.equal(proof.active.version, state.version);
    assert.equal(proof.active.phase, state.metadata.resources.bindings[2].text);
    assert.match(proof.active.resourceSha256, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(proof).includes("owned-bucket"), false);
    assert.equal(JSON.stringify(proof).includes("unexpected-code"), false);
  }
});

test("failed or invalid active-version reads retain uncertainty without leaking their errors", async () => {
  const invalid = observation(); invalid.metadata.resources.bindings[0].text = "0";
  const unknownPhase = observation(); unknownPhase.metadata.resources.bindings[2].text = "private-data";
  for (const state of [undefined, invalid, unknownPhase]) {
    const f = fixture({ results: [consumed()], observations: [state] });
    if (state === undefined) f.options.observe = async () => { f.calls.push("observe"); throw Error("secret-bearing upstream message"); };
    await assert.rejects(() => deployHeldFixturePhase(f.options), /completion is uncertain/);
    assert.deepEqual(f.calls, ["deploy", "observe", "failure-receipt"]);
    assert.equal(f.failures[0].observation, "unavailable-or-invalid");
    assert.equal(f.failures[0].active, null);
    assert.doesNotMatch(JSON.stringify(f.failures), /secret-bearing|private-data/);
  }
});

test("a failed uncertainty receipt stops without another deployment or observation", async () => {
  const f = fixture({ results: [consumed()] });
  f.options.recordFailure = async () => { f.calls.push("failure-receipt"); throw Error("disk unavailable"); };
  await assert.rejects(() => deployHeldFixturePhase(f.options), /disk unavailable/);
  assert.deepEqual(f.calls, ["deploy", "observe", "failure-receipt"]);
});

test("completion-token diagnostics require the exact owned error without uncertain or contradictory output", async () => {
  for (const overrides of [
    { timedOut: true }, { executionUncertain: true },
    { stderr: consumed().stderr.replace(accountId, "b".repeat(32)) },
    { stderr: consumed().stderr.replace(worker, "production-app") },
    { stderr: consumed().stderr.replace("versions", "assets-upload-session") },
    { stderr: consumed().stderr.replace("100312", "10000") },
    { stderr: consumed().stderr.replace("Completion token has already been consumed", "Other error") },
    { stderr: consumed().stderr + "\n[code: 10013]" },
    ...["fetch failed", "ECONNRESET", "authentication failed", `Current Version ID: ${newVersion}`].map(stdout => ({ stdout })),
  ]) {
    const f = fixture({ results: [{ ...consumed(), ...overrides }] });
    await assert.rejects(() => deployHeldFixturePhase(f.options), /Phase deployment failed/);
    assert.deepEqual(f.calls, ["deploy"]);
    assert.equal(f.failures.length, 0);
  }
});

test("a consumed token after the permitted pre-upload retry cannot cause a third command", async () => {
  const f = fixture({ results: [failure(), consumed()], observations: [observation(), observation(newVersion, "frozen")] });
  await assert.rejects(() => deployHeldFixturePhase(f.options), /completion is uncertain/);
  assert.deepEqual(f.calls, ["deploy", "backoff", "observe", "receipt", "deploy", "observe", "failure-receipt"]);
  assert.equal(f.receipts.length, 1);
  assert.equal(f.failures.length, 1);
  assert.equal(f.failures[0].commandAttempts, 2);
});

function assetFixture(root='/tmp/nanohub-phase-tests',purpose='vault-recovery') {
 const plan=fixturePlan({root,accountId,runId,deadline:Date.now()+600000,purpose});
 const previous=observation(oldVersion,'seed');
 previous.metadata.resources.bindings=[
  ...Object.entries(plan.api.vars).map(([name,text])=>({name,type:'plain_text',text})),
  {name:'ASSETS',type:'assets'}, {name:'CF_VERSION_METADATA',type:'version_metadata'},
  {name:'AUTH_DB',type:'d1',id:plan.databaseId},
  {name:'OBJECTS',type:'r2_bucket',bucket_name:plan.bucket},
  ...classes.map(([name,class_name])=>({name,type:'durable_object_namespace',class_name,namespace_id:'owned-'+name})),
  ...(plan.api.services??[]).map(({binding:name,...service})=>({name,type:'service',...service})),
 ];
 previous.metadata.resources.script_runtime.assets={raw_run_worker_first:true,serve_directly:false,base_path:'/'};
 return {plan,previous};
}

test('owned phase configuration retains provider assets without an upload directory or completion JWT',()=>{
 for(const purpose of ['vault-recovery','repository-recovery']){
  const {plan,previous}=assetFixture(undefined,purpose),before=structuredClone(plan);
  const config=retainedAssetPhaseConfiguration(plan,previous,'frozen');
  assert.equal(config.assets,undefined);
  assert.deepEqual(config.unsafe,{bindings:[{name:'ASSETS',type:'assets'}],metadata:{keep_assets:true,assets:{config:{run_worker_first:true}}}});
  assert.deepEqual(config.vars,{...plan.api.vars,HOSTED_REPO_PHASE:'frozen'});
  const {assets,...original}=structuredClone(plan.api),{unsafe,...actual}=structuredClone(config);actual.vars.HOSTED_REPO_PHASE='seed';assert.deepEqual(actual,original);
  assert.deepEqual(plan,before);assert.equal(JSON.stringify(config).includes('jwt'),false);
 }
});

test('retained assets reject foreign apps, arbitrary metadata, missing assets and unverified routing',()=>{
 for(const mutate of [
  f=>{f.plan.purpose='git-import';}, f=>{f.plan.apiName='nanohub-swarm';},
  f=>{f.plan.api.name='foreign-worker';}, f=>{f.plan.api.account_id='b'.repeat(32);},
  f=>{f.plan.api.unsafe={metadata:{bindings:[]}};},f=>{delete f.plan.api.assets;},
  f=>{f.plan.api.assets.directory='relative';},f=>{f.plan.api.assets.run_worker_first=false;},
  f=>{f.plan.api.assets.html_handling='none';},
  f=>{f.plan.api.vars.NANOHUB_RECOVERY_HOLD='0';},f=>{f.plan.api.vars.DEV_LOGIN='1';},
  f=>{f.plan.api.r2_buckets[0].bucket_name='foreign';},f=>{f.plan.api.services[0].service='production';},
  f=>{f.plan.api.workers_dev=true;},f=>{f.plan.api.main='/tmp/another-worker.ts';},
  f=>{f.previous.metadata.resources.bindings.find(x=>x.name==='HOSTED_FIXTURE_EXPIRES').text='1';},
  f=>{f.previous.metadata.resources.bindings=f.previous.metadata.resources.bindings.filter(x=>x.name!=='ASSETS');},
  f=>{f.previous.metadata.resources.bindings.find(x=>x.name==='ASSETS').type='service';},
  f=>{f.previous.metadata.resources.bindings.find(x=>x.name==='OBJECTS').bucket_name='other';},
  f=>{f.previous.metadata.resources.script_runtime.assets.raw_run_worker_first=false;},
  f=>{f.previous.metadata.resources.bindings.find(x=>x.name==='NANOHUB_RECOVERY_HOLD').text='0';},
 ]){const f=assetFixture();mutate(f);assert.throws(()=>retainedAssetPhaseConfiguration(f.plan,f.previous,'frozen'));}
 const f=assetFixture();assert.throws(()=>retainedAssetPhaseConfiguration(f.plan,f.previous,'open'));
});

test('phase-only provider proof rejects code, binding, namespace, budget and routing drift',()=>{
 const {previous}=assetFixture();
 const next=()=>{const value=structuredClone(previous);value.version=newVersion;value.metadata.id=newVersion;value.metadata.resources.bindings.find(x=>x.name==='HOSTED_REPO_PHASE').text='frozen';return value;};
 const valid=next();valid.metadata.resources.bindings.reverse();assert.equal(assertRetainedAssetPhase(previous,valid,'seed','frozen').phaseOnly,true);
 for(const mutate of [
  v=>{v.metadata.resources.script.etag='other-code';},
  v=>{v.metadata.resources.script_runtime.limits.subrequests=1000;},
  v=>{v.metadata.resources.script_runtime.assets.raw_run_worker_first=false;},
  v=>{v.metadata.resources.bindings.find(x=>x.name==='AUTH_DB').id='foreign-database';},
  v=>{v.metadata.resources.bindings.find(x=>x.name==='HUB').namespace_id='replaced';},
  v=>{v.metadata.resources.bindings.find(x=>x.name==='VAULT').service='production';},
  v=>{v.metadata.resources.bindings.find(x=>x.name==='HOSTED_REPO_PHASE').text='verify';},
 ]){const value=next();mutate(value);assert.throws(()=>assertRetainedAssetPhase(previous,value,'seed','frozen'));}
});

test('actual Wrangler dry-run multipart retains assets and routing with no completion token',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'nh-retained-assets-'));
 try {
  const {plan,previous}=assetFixture(directory),config=retainedAssetPhaseConfiguration(plan,previous,'frozen');
  await mkdir(join(directory,'tools/hosted-recovery-fixture'),{recursive:true});
  await writeFile(config.main,classes.map(([,name])=>`export class ${name} {}`).join('\n')+'\nexport default {fetch(){return new Response("held");}};');
  const path=join(directory,'phase.json'),bundle=join(directory,'worker.multipart');await writeFile(path,JSON.stringify(config));
  const wrangler=resolve(import.meta.dirname,'../../node_modules/wrangler/bin/wrangler.js');
  const {stdout}=await promisify(execFile)(process.execPath,[wrangler,'deploy','--dry-run','--outfile',bundle,'--config',path],{cwd:directory,env:{PATH:process.env.PATH,HOME:directory,CI:'true',WRANGLER_SEND_METRICS:'false',NO_COLOR:'1'},timeout:60000,maxBuffer:4<<20});
  assert.match(stdout,/--dry-run: exiting now/);assert.doesNotMatch(stdout,/Starting asset upload|assets-upload-session/);
  const bytes=await readFile(bundle),boundary=bytes.subarray(0,bytes.indexOf('\r\n')).toString().slice(2);
  const form=await new Response(bytes,{headers:{'Content-Type':'multipart/form-data; boundary='+boundary}}).formData(),metadata=JSON.parse(form.get('metadata'));
  assert.equal(metadata.keep_assets,true);assert.deepEqual(metadata.assets,{config:{run_worker_first:true}});assert.equal(metadata.assets.jwt,undefined);
  assert.equal(metadata.bindings.filter(x=>x.name==='ASSETS'&&x.type==='assets').length,1);
  assert.equal(metadata.bindings.find(x=>x.name==='HOSTED_REPO_PHASE').text,'frozen');
  assert.equal(metadata.bindings.find(x=>x.name==='NANOHUB_RECOVERY_HOLD').text,'1');
  assert.equal(metadata.bindings.find(x=>x.name==='OBJECTS').bucket_name,plan.bucket);
  assert.equal(metadata.limits.subrequests,50000);assert.ok(form.get(metadata.main_module));
 }finally{await rm(directory,{recursive:true,force:true});}
});
