import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseWorkflow } from "../../../tools/actions-workflow.mjs";
import {
  Codegraff,
  sandboxJob,
  executeActions,
  allocateSandbox,
} from "../../../tools/codegraff-actions.mjs";
import { runProcess } from "../../../tools/ci-runner.mjs";
import { semaphore } from "../../../tools/runner-pool.mjs";
const workflow = `name: Checks
on: push
permissions:
  contents: read
jobs:
  test:
    runs-on: codegraff
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
      - run: bun run test
  build:
    runs-on: ubuntu-latest
    needs: test
    steps:
      - run: bun run build
`;
const run = {
  id: "run-id",
  attempt: 1,
  branch: "feature",
  head: "a".repeat(40),
  base: "b".repeat(40),
  leaseUntil: Date.now() + 600000,
};
const image = "registry.invalid/toolchain@sha256:" + "c".repeat(64);
test('push filters distinguish branches and tags, including same-named refs',()=>{
 const tagged=workflow.replace('on: push','on:\n  push:\n    tags: [v*]');
 assert.equal(parseWorkflow(tagged,'.github/workflows/check.yml','v1','refs/tags/v1').length,2);
 assert.equal(parseWorkflow(tagged,'.github/workflows/check.yml','v1','refs/heads/v1').length,0);
 const branches=workflow.replace('on: push','on:\n  push:\n    branches: [v*]');assert.equal(parseWorkflow(branches,'.github/workflows/check.yml','v1','refs/tags/v1').length,0);
 const ignored=workflow.replace('on: push','on:\n  push:\n    tags-ignore: [v1]');assert.equal(parseWorkflow(ignored,'.github/workflows/check.yml','v1','refs/tags/v1').length,0);assert.equal(parseWorkflow(ignored,'.github/workflows/check.yml','v2','refs/tags/v2').length,2);
 assert.throws(()=>parseWorkflow(tagged.replace('tags: [v*]','tags: [v*]\n    tags-ignore: [old]'),'.github/workflows/check.yml','v1','refs/tags/v1'),/Choose tags/);
 assert.throws(()=>parseWorkflow(tagged,'.github/workflows/check.yml','v1','refs/tags/other'),/source ref/);
});
function mockClient({
  exitCode = 0,
  failClone = false,
  failLogs = false,
  failDelete = false,
} = {}) {
  const calls = [],
    uploads = [];
  let created = 0;
  return {
    calls,
    uploads,
    sleep: async () => {},
    async api(path, body) {
      calls.push({ path, body });
      assert.equal(path, "/sandboxes");
      return { id: "box-" + ++created };
    },
    async ready(id) {
      calls.push({ ready: id });
    },
    async upload(id, path, bytes) {
      uploads.push({ id, path, bytes: Buffer.from(bytes) });
    },
    async exec(id, command) {
      calls.push({ id, command });
      if (command.startsWith("cat ") && failClone)
        throw Error("wrong candidate");
      if (command.startsWith("docker inspect"))
        return JSON.stringify({ Running: false, ExitCode: exitCode });
      if (command.startsWith("docker logs")) {
        if (failLogs) throw Error("logs unavailable");
        return "test output";
      }
      return "";
    },
    async destroy(id) {
      calls.push({ destroy: id });
      if (failDelete) throw Error("cleanup unavailable");
    },
  };
}
test('tag jobs retain exact checkout identity and typed reserved ref variables without requiring the current base as an ancestor',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nanohub-tag-job-'));
 try{const client=mockClient(),tag={...run,ref:'refs/tags/feature',refTarget:'d'.repeat(40)},job=parseWorkflow(workflow,'.github/workflows/check.yml','feature','refs/tags/feature')[0];
  const result=await sandboxJob({client,job,run:tag,bundle:Buffer.from('synthetic tag bundle'),image,artifacts:dir,artifactOrigin:'https://logs.invalid/run/',repository:'alice/repo'});assert.equal(result.state,'success');const commands=client.calls.map(c=>c.command??'').join('\n');assert.match(commands,/GITHUB_REF=refs\/tags\/feature/);assert.match(commands,/GITHUB_REF_TYPE=tag/);assert.match(commands,/GITHUB_REF_NAME=feature/);assert.match(commands,/rev-parse HEAD/);assert.ok(!commands.includes('merge-base --is-ancestor'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test("workflow dependencies and built-ins compile; unsupported/unsafe semantics fail closed", () => {
  const jobs = parseWorkflow(
    workflow,
    ".github/workflows/check.yml",
    "feature",
  );
  assert.deepEqual(
    jobs.map((j) => j.name),
    ["check/test", "check/build"],
  );
  assert.deepEqual(jobs[1].needs, ["test"]);
  assert.match(jobs[0].script, /git rev-parse HEAD/);
  for (const text of [
    workflow.replace("on: push", "on: pull_request"),
    workflow.replace("bun run test", "echo ${{ secrets.KEY }}"),
    workflow.replace("codegraff", "windows-latest"),
    workflow.replace("actions/checkout@v4", "unknown/action@main"),
    workflow.replace("    needs: test", "    needs: build"),
    workflow.replace("    steps:", "    strategy: { matrix: {} }\n    steps:"),
    workflow.replace(
      "      - run: bun run test",
      "      - run: bun run test\n        working-directory: ../escape",
    ),
  ])
    assert.throws(() =>
      parseWorkflow(text, ".github/workflows/check.yml", "feature"),
    );
  assert.equal(
    parseWorkflow(
      workflow.replace("on: push", "on:\n  push:\n    branches: [main]"),
      ".github/workflows/check.yml",
      "feature",
    ).length,
    0,
  );
});
test("Codegraff authenticates only gateway control requests, refuses redirects and redacts response errors", async () => {
  const calls = [];
  const client = new Codegraff("synthetic-gateway-key", {
    fetcher: async (url, init) => {
      calls.push({ url, init });
      return new Response('{"id":"box"}', { status: 200 });
    },
  });
  await client.api("/sandboxes", { provider: "fleet" });
  assert.equal(
    calls[0].init.headers.Authorization,
    "Bearer synthetic-gateway-key",
  );
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[0].init.headers["User-Agent"], "nanohub-actions/1.0");
  const bad = new Codegraff("key", {
    fetcher: async () =>
      new Response("do not echo credentials", { status: 403 }),
  });
  await assert.rejects(
    bad.api("/sandboxes"),
    (e) => !e.message.includes("credentials"),
  );
  const scope = new Codegraff("key", {
    fetcher: async () => new Response(JSON.stringify({error:{type:"insufficient_scope",message:"do not echo credentials"}}), {status:403}),
  });
  await assert.rejects(scope.api("/sandboxes"), (e) => e.message.includes("sandbox scope") && !e.message.includes("credentials"));
});
for (const condition of [
  "success",
  "failed tests",
  "wrong clone",
  "logs unavailable",
  "cleanup unavailable",
])
  test(`sandbox job: ${condition}; exact identity, no control credentials, cleanup receipt`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "nanohub-cg-test-"));
    try {
      const client = mockClient({
          exitCode: condition === "failed tests" ? 1 : 0,
          failClone: condition === "wrong clone",
          failLogs: condition === "logs unavailable",
          failDelete: condition === "cleanup unavailable",
        }),
        job = parseWorkflow(
          workflow,
          ".github/workflows/check.yml",
          "feature",
        )[0];
      const result = await sandboxJob({
        client,
        job,
        run,
        bundle: Buffer.from("synthetic Git bundle"),
        image,
        artifacts: dir,
        artifactOrigin: "https://logs.invalid/run/",
        repository: "alice/repo",
      });
      assert.equal(
        result.state,
        condition === "success" ? "success" : "failure",
      );
      assert.equal(result.execution.provider, "codegraff");
      assert.ok(client.calls.some((c) => c.destroy));
      const serialized =
        JSON.stringify(client.calls) +
        client.uploads.map((u) => u.bytes.toString()).join("");
      assert.ok(!serialized.includes("synthetic-gateway-key"));
      assert.ok(!serialized.includes("nhci_"));
      assert.ok(!serialized.includes("nhread_"));
      if (condition === "success") {
        assert.match(serialized, /--network=none/);
        assert.match(serialized, /--security-opt=no-new-privileges/);
        assert.match(serialized, /checkout --detach/);
        assert.match(serialized, /rev-parse HEAD/);
      }
      const receipt = JSON.parse(
        await readFile(join(dir, "check-test.sandbox.json"), "utf8"),
      );
      assert.equal(receipt.cleanupNeeded, condition === "cleanup unavailable");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
test("dispatcher uses accepted base workflow, transfers a real credential-free bundle and allocates one VM per job", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nanohub-cg-source-"));
  try {
    const git = async (...args) => {
      const r = await runProcess("git", [
        "-C",
        dir,
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=test@example.invalid",
        ...args,
      ]);
      assert.equal(r.code, 0, r.output);
      return r.output.trim();
    };
    await git("init", "-b", "main");
    await mkdir(join(dir, ".github/workflows"), { recursive: true });
    await writeFile(join(dir, ".github/workflows/check.yml"), workflow);
    await git("add", ".");
    await git("commit", "-m", "Base workflow");
    const base = await git("rev-parse", "HEAD");
    await git("checkout", "-b", "feature");
    await writeFile(
      join(dir, ".github/workflows/check.yml"),
      "invalid candidate workflow must not replace base",
    );
    await git("add", ".");
    await git("commit", "-m", "Candidate");
    const head = await git("rev-parse", "HEAD");
    const artifacts = join(dir, "private-logs");
    await mkdir(artifacts);
    const client = mockClient();
    const result = await executeActions(
      {
        run: { ...run, head, base },
        source: dir,
        artifacts,
        artifactOrigin: "https://logs.invalid/",
      },
      { image, repository: "alice/repo" },
      { client },
    );
    assert.equal(result.results.length, 2);
    assert.ok(result.results.every((r) => r.state === "success"));
    assert.equal(client.calls.filter((c) => c.path === "/sandboxes").length, 2);
    const chunks = client.uploads.filter(
      (u) => u.id === "box-1" && u.path.includes("bundle-"),
    );
    const transferred = join(dir, "transferred.bundle");
    await writeFile(transferred, Buffer.concat(chunks.map((u) => u.bytes)));
    await git("bundle", "verify", transferred);
    assert.ok(
      !client.uploads.some(
        (u) =>
          u.bytes.includes(
            Buffer.from("invalid candidate workflow must not replace base"),
          ) && u.path.endsWith("job.sh"),
      ),
    );
    assert.ok(
      !client.calls.some((c) => JSON.stringify(c).includes("api.github.com")),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("revoked leases cancel sandbox execution", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nanohub-cg-cancel-"));
  try {
    const client = mockClient(),
      job = parseWorkflow(
        workflow,
        ".github/workflows/check.yml",
        "feature",
      )[0];
    const result = await sandboxJob({
      client,
      job,
      run,
      bundle: Buffer.from("bundle"),
      image,
      artifacts: dir,
      artifactOrigin: "https://logs.invalid/",
      repository: "alice/repo",
      active: async () => false,
    });
    assert.equal(result.state, "cancelled");
    assert.ok(!client.calls.some((c) => c.path === "/sandboxes"),"revocation before allocation creates no VM");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('capacity responses retry without retrying uncertain allocations or exhausted/revoked leases',async()=>{
 let calls=0,sleeps=0;
 const client={api:async()=>{if(++calls<3)throw Object.assign(Error('capacity'),{status:503,retryAfterMs:1000});return{id:'box'};},sleep:async()=>{sleeps++;}};
 assert.equal((await allocateSandbox(client,{},Date.now()+60000)).id,'box');assert.equal(calls,3);assert.equal(sleeps,2);
 calls=0;
 await assert.rejects(allocateSandbox({...client,api:async()=>{calls++;throw Error('network timeout');}},{},Date.now()+60000),/timeout/);assert.equal(calls,1);
 await assert.rejects(allocateSandbox(client,{},Date.now()+60000,async()=>false),/no longer active/);
 const delays=[];let tries=0;
 await allocateSandbox({api:async()=>{if(!tries++)throw Object.assign(Error('rate limited'),{status:429,retryAfterMs:90000});return{id:'ready'};},sleep:async ms=>{delays.push(ms);}},{},Date.now()+120000);
 assert.deepEqual(delays,[30000,30000,30000],'honor Retry-After without sending requests early');
});

test('the repository workflow runs all suites in parallel before the stable check/check gate',async()=>{
 const jobs=parseWorkflow(await readFile(new URL('../../../.github/workflows/check.yml',import.meta.url),'utf8'),'.github/workflows/check.yml','main');
 const gate=jobs.find(j=>j.id==='check');
 assert.deepEqual(new Set(gate.needs),new Set(['unit','repository','cli','access','hosting','build']));
 for(const id of gate.needs)assert.deepEqual(jobs.find(j=>j.id===id).needs,[]);
 assert.match(jobs.find(j=>j.id==='unit').script,/bun run --filter @swarm\/api test:unit/);assert.match(jobs.find(j=>j.id==='cli').script,/bun run test:cli/);assert.match(gate.script,/bun run check/);
});

test('independent jobs overlap within the shared cap, dependencies wait and failed prerequisites skip dependents',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nanohub-dag-'));
 try {
  const git=async(...args)=>{const r=await runProcess('git',['-C',dir,'-c','user.name=Fixture','-c','user.email=f@example.invalid',...args]);assert.equal(r.code,0,r.output);return r.output.trim();};
  const yaml=`on: push\njobs:\n  a:\n    runs-on: codegraff\n    steps: [{run: 'exit 7'}]\n  b:\n    runs-on: codegraff\n    steps: [{run: 'echo b'}]\n  c:\n    runs-on: codegraff\n    steps: [{run: 'echo c'}]\n  dependent:\n    runs-on: codegraff\n    needs: [a, b]\n    steps: [{run: 'echo must-not-run'}]\n`;
  await git('init','-b','main');await mkdir(join(dir,'.github/workflows'),{recursive:true});await writeFile(join(dir,'.github/workflows/check.yml'),yaml);await git('add','.');await git('commit','-m','DAG');
  const head=await git('rev-parse','HEAD'),client=mockClient(),scripts=new Map();let active=0,peak=0;
  const api=client.api,upload=client.upload,exec=client.exec,destroy=client.destroy;
  client.api=async(...args)=>{const r=await api(...args);active++;peak=Math.max(peak,active);return r;};
  client.upload=async(id,path,bytes)=>{if(path.endsWith('job.sh'))scripts.set(id,bytes.toString());return upload(id,path,bytes);};
  client.exec=async(id,command)=>{if(command.startsWith('docker inspect')){await new Promise(resolve=>setImmediate(resolve));return JSON.stringify({Running:false,ExitCode:scripts.get(id).includes('exit 7')?7:0});}return exec(id,command);};
  client.destroy=async id=>{await destroy(id);active--;};
  const artifacts=join(dir,'logs');await mkdir(artifacts);
  const result=await executeActions({run:{...run,head,base:head},source:dir,artifacts,artifactOrigin:'https://logs.invalid/'},{image,jobConcurrency:8},{client,sandboxLimit:semaphore(2)});
  assert.equal(peak,2);assert.equal(active,0);
  assert.deepEqual(result.results.map(r=>[r.name,r.state]),[['check/a','failure'],['check/b','success'],['check/c','success'],['check/dependent','skipped']]);
  assert.equal(client.calls.filter(c=>c.destroy).length,3);assert.ok(![...scripts.values()].some(s=>s.includes('must-not-run')));
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('job deadline reports timed_out and still destroys the sandbox',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nanohub-cg-deadline-'));
 try{
  const client=mockClient(),job={...parseWorkflow(workflow,'.github/workflows/check.yml','feature')[0],timeoutMs:10000};
  let time=Date.now();client.ready=async()=>{time+=15000;};
  const result=await sandboxJob({client,job,run:{...run,leaseUntil:time+120000},bundle:Buffer.from('bundle'),image,artifacts:dir,artifactOrigin:'https://logs.invalid/',repository:'alice/repo',now:()=>time});
  assert.equal(result.state,'timed_out');assert.equal(client.calls.filter(call=>call.destroy).length,1);
  assert.match(await readFile(join(dir,job.name.replaceAll('/','-')+'.log'),'utf8'),/timed out/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('Actions use trusted default workflows even when the exact candidate is a sibling with replacement workflows',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nanohub-cg-default-'));
 try {
  const git=async(...args)=>{const r=await runProcess('git',['-C',dir,'-c','user.name=Fixture','-c','user.email=f@example.invalid',...args]);assert.equal(r.code,0,r.output);return r.output.trim();};
  await git('init','-b','trunk');await mkdir(join(dir,'.github/workflows'),{recursive:true});await writeFile(join(dir,'.github/workflows/check.yml'),'on: push\njobs:\n  trusted:\n    runs-on: codegraff\n    steps: [{run: "echo TRUSTED_DEFAULT"}]\n');await git('add','.');await git('commit','-m','Seed');
  await git('switch','-c','feature');await writeFile(join(dir,'.github/workflows/check.yml'),'on: push\njobs:\n  replaced:\n    runs-on: codegraff\n    steps: [{run: "echo UNTRUSTED_REPLACEMENT"}]\n');await git('commit','-am','Candidate');const head=await git('rev-parse','HEAD');
  await git('switch','trunk');await writeFile(join(dir,'default.txt'),'Independent default tip');await git('add','.');await git('commit','-m','Default moved');const base=await git('rev-parse','HEAD');await git('switch','--detach',head);
  assert.notEqual((await runProcess('git',['-C',dir,'merge-base','--is-ancestor',base,head])).code,0);
  const artifacts=join(dir,'logs');await mkdir(artifacts);const client=mockClient();const result=await executeActions({run:{...run,head,base},source:dir,artifacts,artifactOrigin:'https://logs.invalid/'},{image},{client});
  assert.deepEqual(result.results.map(r=>r.name),['check/trusted']);const script=client.uploads.find(u=>u.path.endsWith('job.sh')).bytes.toString();assert.match(script,/TRUSTED_DEFAULT/);assert.doesNotMatch(script,/UNTRUSTED_REPLACEMENT/);assert.equal(client.calls.filter(c=>c.destroy).length,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('real client confirms deletion through absent or destroyed records, and never treats stopped/running as cleaned up',async()=>{
 for(const state of ['destroyed','deleted','expired',null]){
  const calls=[],client=new Codegraff('synthetic-key',{sleep:async()=>{},fetcher:async(url,init)=>{calls.push({url,init});return init.method==='DELETE'?Response.json({ok:true}):state===null?new Response('',{status:404}):Response.json({state});}});
  await client.destroy('fixture-sandbox');assert.deepEqual(calls.map(c=>c.init.method),['DELETE','GET']);assert.ok(calls.every(c=>c.init.redirect==='error'));
 }
 for(const state of ['stopped','started','stopping',undefined]){
  let gets=0,waits=0;const client=new Codegraff('synthetic-key',{sleep:async()=>{waits++;},fetcher:async(_url,init)=>{if(init.method==='GET')gets++;return Response.json(init.method==='DELETE'?{ok:true}:{state});}});
  await assert.rejects(client.destroy('fixture-sandbox'),/deletion could not be confirmed/);assert.equal(gets,5);assert.equal(waits,4);
 }
 const states=['stopping','destroyed'];const client=new Codegraff('synthetic-key',{sleep:async()=>{},fetcher:async(_url,init)=>Response.json(init.method==='DELETE'?{}:{state:states.shift()})});await client.destroy('fixture-sandbox');assert.equal(states.length,0);
});

test('snapshot toolchain configuration requires a local immutable image ID and cannot silently use a registry/tag fallback',async()=>{
 const {toolchain}=await import('../../../tools/toolchain.mjs'),local='sha256:'+'d'.repeat(64),snapshot='snp_fixture';
 assert.deepEqual(toolchain(image),{image,snapshot:false});assert.deepEqual(toolchain(local,snapshot),{image:local,imageSnapshot:snapshot,snapshot:true});
 for(const [value,id]of[[local,undefined],[image,snapshot],['node:24',snapshot],[local,'https://other.invalid/snapshot'],[local,'cnd_other'],['sha256:bad',snapshot]])assert.throws(()=>toolchain(value,id));
 const archive='/workspace/nanohub-toolchain/image.tar';assert.deepEqual(toolchain(local,snapshot,archive),{image:local,imageSnapshot:snapshot,snapshot:true,imageArchive:archive});
 for(const args of [[image,undefined,archive],[local,snapshot,'/tmp/image.tar'],[local,snapshot,'/workspace/../image.tar'],[local,snapshot,true]])assert.throws(()=>toolchain(...args));
});

test('large trusted image loads launch once and observe the same exit file through completion, failure and cancellation',async()=>{
 const archive='/workspace/nanohub-toolchain/image.tar';
 for(const terminal of ['0','1','unexpected']){
  const client=new Codegraff('synthetic-key',{sleep:async()=>{}}),uploads=[],commands=[],states=['running',terminal];
  client.upload=async(_id,path,bytes)=>uploads.push({path,script:bytes.toString()});client.exec=async(_id,command)=>{commands.push(command);return command.startsWith('nohup')?'':states.shift();};
  const work=client.loadImage('vm',archive,Date.now()+10000);if(terminal==='0')await work;else await assert.rejects(work,/image load failed/);
  assert.equal(uploads.length,1);assert.match(uploads[0].script,/docker load --input/);assert.equal(commands.filter(c=>c.startsWith('nohup')).length,1);assert.equal(states.length,0);
 }
 const never=new Codegraff('key',{fetcher:async()=>{throw Error('Unexpected dispatch');}});await assert.rejects(never.loadImage('vm',archive,Date.now()-1),/cancelled before/);await assert.rejects(never.loadImage('vm','/other/image.tar',Date.now()+10000),/Invalid trusted/);
 let live=0,launched=0;const revoked=new Codegraff('key');revoked.upload=async()=>{};revoked.exec=async()=>{launched++;return '';};await assert.rejects(revoked.loadImage('vm',archive,Date.now()+10000,async()=>++live===1),/lease is no longer active/);assert.equal(launched,1);
});

test('archive snapshots load then verify before candidate upload and refuse failed loads with cleanup',async()=>{
 for(const failed of [false,true]){
  const dir=await mkdtemp(join(tmpdir(),'nanohub-archive-image-'));
  try{const client=mockClient(),events=[],local='sha256:'+'d'.repeat(64),original=client.exec;
   client.restore=async()=>events.push('restore');client.loadImage=async()=>{events.push('load');if(failed)throw Error('image load failed');};client.exec=async(id,command)=>{if(command.startsWith('docker image inspect')){events.push('verify');return local;}return original(id,command);};client.upload=async()=>events.push('candidate');
   const job=parseWorkflow(workflow,'.github/workflows/check.yml','feature')[0],result=await sandboxJob({client,job,run,bundle:Buffer.from('bundle'),image:local,imageSnapshot:'snp_fixture',imageArchive:'/workspace/nanohub-toolchain/image.tar',artifacts:dir,artifactOrigin:'https://logs.invalid/',repository:'alice/repo'});
   assert.equal(result.state,failed?'failure':'success');assert.deepEqual(events.slice(0,failed?2:4),failed?['restore','load']:['restore','load','verify','candidate']);if(failed)assert.ok(!events.includes('candidate'));assert.equal(client.calls.filter(c=>c.destroy).length,1);
   const receipt=JSON.parse(await readFile(join(dir,'check-test.sandbox.json'),'utf8'));assert.equal(receipt.imageArchive,'/workspace/nanohub-toolchain/image.tar');assert.equal(receipt.cleanupNeeded,false);
  }finally{await rm(dir,{recursive:true,force:true});}
 }
});
test('snapshot restore uses authenticated control calls, polls its exact handle and stops on failure or stale lease',async()=>{
 const calls=[],states=['restoring','done'];const client=new Codegraff('synthetic-key',{sleep:async()=>{},fetcher:async(url,init)=>{calls.push({url,init});return Response.json(init.method==='POST'?{restoreId:'rst_fixture',state:'restoring'}:{state:states.shift()});}});
 await client.restore('fixture-vm','snp_fixture',Date.now()+30000);assert.deepEqual(calls.map(c=>c.init.method),['POST','GET','GET']);assert.equal(JSON.parse(calls[0].init.body).snapshotId,'snp_fixture');assert.ok(calls[1].url.endsWith('/sandboxes/fixture-vm/restore/rst_fixture'));assert.ok(calls.every(c=>c.init.redirect==='error'&&c.init.headers.Authorization==='Bearer synthetic-key'));
 for(const state of ['failed','ready','',undefined]){const bad=new Codegraff('key',{fetcher:async(_url,init)=>Response.json(init.method==='POST'?{restoreId:'rst_fixture'}:{state})});await assert.rejects(bad.restore('vm','snp_fixture',Date.now()+10000),/did not complete/);}
 const unused=new Codegraff('key',{fetcher:async()=>{throw Error('Must not dispatch');}});await assert.rejects(unused.restore('vm','snp_fixture',Date.now()-1),/cancelled before/);await assert.rejects(unused.restore('vm','snp_fixture',Date.now()+10000,async()=>false),/cancelled before/);
});
test('snapshot jobs restore and verify the image before candidate transfer, enforce pull-never and retain image provenance',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nanohub-snapshot-job-')),local='sha256:'+'d'.repeat(64),snapshot='snp_fixture';
 try{
  const client=mockClient(),events=[],originalExec=client.exec,originalUpload=client.upload;
  client.restore=async(_id,snap)=>{assert.equal(snap,snapshot);events.push('restore');};client.exec=async(id,command)=>{if(command.startsWith('docker image inspect')){events.push('inspect');return local;}return originalExec(id,command);};client.upload=async(...args)=>{events.push('upload');return originalUpload(...args);};
  const job=parseWorkflow(workflow,'.github/workflows/check.yml','feature')[0];
  const result=await sandboxJob({client,job,run,bundle:Buffer.from('bundle'),image:local,imageSnapshot:snapshot,artifacts:dir,artifactOrigin:'https://logs.invalid/',repository:'alice/repo'});assert.equal(result.state,'success');assert.deepEqual(events.slice(0,3),['restore','inspect','upload']);assert.match(client.calls.find(c=>c.command?.startsWith('docker run')).command,/--pull=never/);assert.ok(client.uploads.every(u=>!u.bytes.toString().includes(snapshot)));
  const receipt=JSON.parse(await readFile(join(dir,job.name.replaceAll('/','-')+'.sandbox.json'),'utf8'));assert.equal(receipt.image,local);assert.equal(receipt.imageSnapshot,snapshot);assert.equal(receipt.cleanupNeeded,false);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('failed restore or mismatched image prevents candidate transfer and still destroys the allocated VM',async()=>{
 for(const mode of ['restore-failed','wrong-image']){
  const dir=await mkdtemp(join(tmpdir(),'nanohub-snapshot-failure-'));try{const client=mockClient(),local='sha256:'+'e'.repeat(64);client.restore=async()=>{if(mode==='restore-failed')throw Error('Restore failed');};client.exec=async()=> 'sha256:'+'f'.repeat(64);const job=parseWorkflow(workflow,'.github/workflows/check.yml','feature')[0];const result=await sandboxJob({client,job,run,bundle:Buffer.from('bundle'),image:local,imageSnapshot:'snp_fixture',artifacts:dir,artifactOrigin:'https://logs.invalid/',repository:'alice/repo'});assert.equal(result.state,'failure');assert.equal(client.uploads.length,0);assert.equal(client.calls.filter(c=>c.destroy).length,1);assert.equal(JSON.parse(await readFile(join(dir,job.name.replaceAll('/','-')+'.sandbox.json'),'utf8')).cleanupNeeded,false);}finally{await rm(dir,{recursive:true,force:true});}
 }
});

test('large Git bundles cross the preview upload limit as bounded base64-safe chunks without losing bytes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nanohub-large-transfer-'));try{
  const client=mockClient(),bundle=Buffer.alloc(1100000,0x7f),job=parseWorkflow(workflow,'.github/workflows/check.yml','feature')[0];
  const result=await sandboxJob({client,job,run,bundle,image,artifacts:dir,artifactOrigin:'https://logs.invalid/',repository:'alice/repo'});
  assert.equal(result.state,'success');const chunks=client.uploads.filter(u=>/\/bundle-\d{5}$/.test(u.path));assert.equal(chunks.length,3);assert.ok(chunks.every(u=>JSON.stringify({path:u.path,contentBase64:u.bytes.toString('base64')}).length<1000000));assert.deepEqual(Buffer.concat(chunks.map(u=>u.bytes)),bundle);
 }finally{await rm(dir,{recursive:true,force:true});}
});
