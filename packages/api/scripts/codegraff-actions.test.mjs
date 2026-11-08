import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, mkdir, writeFile,access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {createHash,randomBytes} from 'node:crypto';
import { parseWorkflow } from "../../../tools/actions-workflow.mjs";
import {
  Codegraff,
  sandboxJob,
  executeActions,
  allocateSandbox,
} from "../../../tools/codegraff-actions.mjs";
import { runProcess } from "../../../tools/ci-runner.mjs";
import { semaphore } from "../../../tools/runner-pool.mjs";
import {sandboxCapacity} from '../../../tools/sandbox-capacity.mjs';
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
      if (command.includes("git clone --no-checkout") && failClone)
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
test('shared capacity is reserved before provider allocation and released only after confirmed VM destruction',async()=>{
 for(const mode of ['success','destroy-failed','create-unknown','attach-lost','release-lost']) {
  const dir=await mkdtemp(join(tmpdir(),'nanohub-capacity-job-'));
  try {
   const client=mockClient({failDelete:mode==='destroy-failed'}),events=[],records=[];
   const provider=client.api;client.api=async(...args)=>{events.push('allocate');assert.equal(records.at(-1).state,'allocation-pending');if(mode==='create-unknown')throw Error('unknown provider response');return provider(...args);};
   const destroy=client.destroy;client.destroy=async sandbox=>{events.push('destroy');return destroy(sandbox);};
   const api=async(path,body)=>{
    events.push(path);
    if(path.endsWith('reserve'))return {admitted:true,reservation:{...body,state:'reserved',sandboxId:null}};
    if(path.endsWith('attach')){if(mode==='attach-lost')throw Error('lost attach response');return {...body,state:'allocated'};}
    assert.equal(events.at(-2),'destroy');if(mode==='release-lost')throw Error('lost release response');return {...body,state:'released'};
   };
   const capacity=sandboxCapacity(api,run,dir,{receipt:async(_,record)=>records.push({...record})}),job=parseWorkflow(workflow,'.github/workflows/check.yml','feature')[0];
   const execute=()=>sandboxJob({client,job,run,bundle:Buffer.from('bundle'),image,artifacts:dir,artifactOrigin:'https://logs.invalid/',repository:'alice/repo',capacity});
   if(mode==='create-unknown'){await assert.rejects(execute(),/unknown provider/);assert.deepEqual(events,['/capacity/reserve','allocate']);assert.equal(records.at(-1).state,'allocation-pending');continue;}
   const result=await execute();assert.equal(result.state,mode==='success'?'success':'failure');
   if(mode==='destroy-failed'){assert.ok(!events.includes('/capacity/release'));assert.equal(records.at(-1).state,'allocated');}
   else if(mode==='release-lost')assert.equal(records.at(-1).state,'release-pending');
   else assert.equal(records.at(-1).state,'released');
   if(mode==='attach-lost')assert.equal(client.uploads.length,0);
  }finally{await rm(dir,{recursive:true,force:true});}
 }
});
test('cancellation before creation and explicit provider capacity rejection release an unused shared slot',async()=>{
 for(const mode of ['cancel','provider-capacity']) {
  const dir=await mkdtemp(join(tmpdir(),'nanohub-unused-capacity-'));
  try {
   const client=mockClient(),events=[];let reserved=false;
   const capacity={acquire:async()=>{reserved=true;return {allocating:async()=>events.push('allocating'),released:async sandbox=>{assert.equal(sandbox,undefined);events.push('released');}};}};
   client.api=async()=>{throw Object.assign(Error('provider capacity'),{status:429,retryAfterMs:600000});};
   const job=parseWorkflow(workflow,'.github/workflows/check.yml','feature')[0];
   await assert.rejects(sandboxJob({client,job,run,bundle:Buffer.from('bundle'),image,artifacts:dir,artifactOrigin:'https://logs.invalid/',repository:'alice/repo',capacity,active:async()=>mode==='cancel'?!reserved:true}),mode==='cancel'?/no longer active/:/provider capacity/);
   assert.equal(events.at(-1),'released');assert.ok(!client.calls.some(call=>call.destroy));
  }finally{await rm(dir,{recursive:true,force:true});}
 }
});
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
  for (const key of [123, {}, "synthetic-private-key\n", "synthetic-private-key ", "x".repeat(4097)])
    assert.throws(() => new Codegraff(key), error => !error.message.includes("synthetic-private-key") && /single-line credential/.test(error.message));
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
      { image, repository: "alice/repo",sourceTransferConcurrency:4,maxSourceBundleBytes:1024*1024 },
      { client },
    );
    assert.equal(result.results.length, 2);
    assert.ok(result.results.every((r) => r.state === "success"));
    const sourceReceipt=JSON.parse(await readFile(join(artifacts,'check-test.sandbox.json'),'utf8'));assert.equal(sourceReceipt.sourceBundle.transferConcurrency,4);
    const capped=mockClient();await assert.rejects(executeActions({run:{...run,head,base},source:dir,artifacts,artifactOrigin:'https://logs.invalid/'},{image,repository:'alice/repo',maxSourceBundleBytes:1},{client:capped}),/configured runner source limit/);assert.equal(capped.calls.length,0);
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
    const localImage='sha256:'+'d'.repeat(64),imageDownload={url:'https://images.invalid/toolchain?cap=synthetic-private-read',sha256:'e'.repeat(64),bytes:100},archiveClient=mockClient(),downloads=[],originalExec=archiveClient.exec;
    archiveClient.downloadImage=async(_id,value)=>downloads.push(value);archiveClient.loadImage=async()=>{};archiveClient.exec=async(id,command)=>command.startsWith('docker image inspect')?localImage:originalExec(id,command);
    const archived=await executeActions({run:{...run,head,base},source:dir,artifacts,artifactOrigin:'https://logs.invalid/'},{image:localImage,imageDownload,repository:'alice/repo'},{client:archiveClient});
    assert.equal(archived.results.length,2);assert.ok(archived.results.every(result=>result.state==='success'));assert.deepEqual(downloads,[imageDownload,imageDownload]);
    assert.ok(!JSON.stringify([archiveClient.calls,archiveClient.uploads,archived]).includes('synthetic-private-read'));
    const privateImage='registry.cloudflare.com/'+'a'.repeat(32)+'/nanohub-ci@sha256:'+'c'.repeat(64),imageRegistry={provider:'cloudflare',config:'/etc/nanohub/wrangler.jsonc'},privateClient=mockClient(),privateExec=privateClient.exec,pulls=[];
    let issued=0;privateClient.pullImage=async(_id,value,credential)=>{assert.equal(value,privateImage);pulls.push(credential.password);};privateClient.exec=async(id,command)=>command.startsWith('docker image inspect')?JSON.stringify([privateImage]):privateExec(id,command);
    const privateResult=await executeActions({run:{...run,head,base},source:dir,artifacts,artifactOrigin:'https://logs.invalid/'},{image:privateImage,imageRegistry,repository:'alice/repo'},{client:privateClient,registryCredentials:async()=>({username:'v1',password:'synthetic-per-job-'+ ++issued,expiresAt:Date.now()+900000})});
    assert.equal(privateResult.results.length,2);assert.ok(privateResult.results.every(result=>result.state==='success'));assert.deepEqual(pulls,['synthetic-per-job-1','synthetic-per-job-2']);assert.ok(!JSON.stringify([privateClient.calls,privateClient.uploads,privateResult]).includes('synthetic-per-job'));
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
 assert.deepEqual(new Set(gate.needs),new Set(['unit','repository','cli','access','hosting','fixtures','build']));
 for(const id of gate.needs)assert.deepEqual(jobs.find(j=>j.id===id).needs,[]);
 assert.match(jobs.find(j=>j.id==='unit').script,/bun run --filter @swarm\/api test:unit/);assert.match(jobs.find(j=>j.id==='cli').script,/bun run test:cli/);assert.match(gate.script,/bun run check/);
 assert.match(jobs.find(j=>j.id==='fixtures').script,/bun run test:hosted-fixture/);
 assert.match(jobs.find(j=>j.id==='fixtures').script,/bun run test:hosted-recovery/);
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
  assert.equal(result.state,'success');const chunks=client.uploads.filter(u=>/\/bundle-\d{5}$/.test(u.path));assert.ok(chunks.length>3);assert.ok(chunks.every(u=>u.bytes.length<=65536&&JSON.stringify({path:u.path,contentBase64:u.bytes.toString('base64')}).length<100000));assert.deepEqual(Buffer.concat(chunks.map(u=>u.bytes)),bundle);const assemble=client.calls.find(c=>c.command?.includes('git clone --no-checkout')).command;assert.ok(assemble.length<2048);assert.match(assemble,/sha256sum -c -/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('parallel source uploads preserve manifest byte order despite out-of-order completions and retain exact provenance',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nanohub-parallel-source-'));
 try{
  const client=mockClient(),bundle=randomBytes(340003),job=parseWorkflow(workflow,'.github/workflows/check.yml','feature')[0],finished=[],parts=new Map();let active=0,peak=0;
  client.stageUpload=async(id,path,bytes)=>{
   const index=Number(path.match(/bundle-(\d+)$/)[1]);active++;peak=Math.max(peak,active);
   try{await new Promise(resolve=>setTimeout(resolve,index===0?30:2));const selected=path+'.nh-upload-11111111-1111-4111-8111-111111111111';parts.set(selected.split('/').at(-1),Buffer.from(bytes));finished.push(index);return selected;}finally{active--;}
  };
  const upload=client.upload;client.upload=async(id,path,bytes)=>{
   if(path.endsWith('/selected-paths')){const names=bytes.toString().trim().split('\n');assert.deepEqual(Buffer.concat(names.map(name=>parts.get(name))),bundle);assert.deepEqual(names.map(name=>Number(name.match(/bundle-(\d+)/)[1])),[0,1,2,3,4,5]);assert.equal(active,0);}
   return upload(id,path,bytes);
  };
  const result=await sandboxJob({client,job,run,bundle,image,artifacts:dir,artifactOrigin:'https://logs.invalid/',repository:'alice/repo',maxSourceBundleBytes:512*1024*1024,sourceTransferConcurrency:4});
  assert.equal(result.state,'success');assert.equal(peak,4);assert.notEqual(finished[0],0);
  const receipt=JSON.parse(await readFile(join(dir,'check-test.sandbox.json'),'utf8'));assert.deepEqual(receipt.sourceBundle,{bytes:bundle.length,sha256:createHash('sha256').update(bundle).digest('hex'),transferConcurrency:4});
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('parallel upload failure drains issued parts before VM destruction and never publishes a partial manifest or executes candidate code',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nanohub-parallel-failed-source-'));
 try{
  const client=mockClient(),job=parseWorkflow(workflow,'.github/workflows/check.yml','feature')[0],issued=[];let pending=0,settled=0;
  client.stageUpload=async(_id,path)=>{
   const index=Number(path.match(/bundle-(\d+)$/)[1]);issued.push(index);pending++;
   try{await new Promise(resolve=>setTimeout(resolve,index===0?1:25));if(index===0)throw Error('synthetic source failure');return path;}finally{pending--;settled++;}
  };
  const destroy=client.destroy;client.destroy=async id=>{assert.equal(pending,0);assert.equal(settled,4);return destroy(id);};
  const result=await sandboxJob({client,job,run,bundle:Buffer.alloc(1000000),image,artifacts:dir,artifactOrigin:'https://logs.invalid/',repository:'alice/repo',sourceTransferConcurrency:4});
  assert.equal(result.state,'failure');assert.deepEqual(issued,[0,1,2,3]);assert.ok(!client.uploads.some(part=>part.path.endsWith('selected-paths')));assert.ok(!client.calls.some(call=>call.command?.includes('git clone --no-checkout')||call.command?.startsWith('docker run')));assert.equal(client.calls.filter(call=>call.destroy).length,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('source size limits are enforced before VM allocation even for direct job execution',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nanohub-source-limit-'));
 try{
  const client=mockClient(),job=parseWorkflow(workflow,'.github/workflows/check.yml','feature')[0];
  await assert.rejects(sandboxJob({client,job,run,bundle:Buffer.alloc(101),maxSourceBundleBytes:100,image,artifacts:dir,artifactOrigin:'https://logs.invalid/',repository:'alice/repo'}),/configured runner source limit/);
  assert.equal(client.calls.length,0);assert.equal(client.uploads.length,0);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('large file uploads use bounded API payloads and checksum-verified atomic assembly, with no retry after unknown writes',async()=>{
 for(const mode of ['success','corrupt','unknown']){
  const dir=await mkdtemp(join(tmpdir(),'nanohub-file-transfer-')),temporary=new Set(),calls=[];
  try {
   const target=join(dir,"file's $(touch SENTINEL).bin"),bytes=Buffer.alloc(190003,0xab);await writeFile(target,'original');
   const client=new Codegraff('synthetic-unused-key');client.api=async(path,body)=>{assert.ok(path.endsWith('/upload'));calls.push(body);assert.ok(Buffer.byteLength(JSON.stringify(body))<100000);const chunk=Buffer.from(body.contentBase64,'base64');assert.ok(chunk.length<=65536);if(mode==='corrupt'&&calls.length===1)chunk[0]^=1;await writeFile(body.path,chunk);if(mode==='unknown'&&calls.length===2)throw Error('unknown write outcome');return {ok:true};};
   client.exec=async(_id,command)=>{for(const path of command.match(/\/tmp\/nanohub-upload-[a-f0-9-]+/g)??[])temporary.add(path);assert.ok(command.length<2048);const result=await runProcess('sh',['-c',command],{timeoutMs:5000,cwd:dir});if(result.code)throw Error('Checksum or assembly failed');return result.output;};
   if(mode==='success'){await client.upload('owned-fixture',target,bytes);assert.equal(createHash('sha256').update(await readFile(target)).digest('hex'),createHash('sha256').update(bytes).digest('hex'));}
   else {await assert.rejects(client.upload('owned-fixture',target,bytes));assert.equal(await readFile(target,'utf8'),'original');if(mode==='unknown')assert.equal(calls.length,2);}
   await assert.rejects(access(join(dir,'SENTINEL')));
  }finally{for(const path of temporary)await rm(path,{recursive:true,force:true});await rm(dir,{recursive:true,force:true});}
 }
});
test('revocation during a multi-chunk source transfer stops uploads before candidate execution and still destroys the VM',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nanohub-cancel-transfer-'));
 try {const client=mockClient(),upload=client.upload;let active=true;client.upload=async(...args)=>{await upload(...args);active=false;};const job=parseWorkflow(workflow,'.github/workflows/check.yml','feature')[0];const result=await sandboxJob({client,job,run,bundle:Buffer.alloc(200000),image,artifacts:dir,artifactOrigin:'https://logs.invalid/',repository:'alice/repo',active:async()=>active});assert.equal(result.state,'cancelled');assert.equal(client.uploads.length,1);assert.ok(!client.calls.some(call=>call.command?.startsWith('docker run')));assert.equal(client.calls.filter(call=>call.destroy).length,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('credential-free upload reconciliation uses isolated paths and one publication across lost responses without weakening authorization',async()=>{
 for(const mode of ['ack-lost','not-sent','publish-ack-lost','publish-not-sent','all-unknown','forbidden','corrupt']){
  const dir=await mkdtemp(join(tmpdir(),'nanohub-verified-upload-'));
  try {
   const target=join(dir,"owned's payload.bin"),bytes=Buffer.alloc(10037,0xca),calls=[],commands=[];let publicationDispatches=0,publicationExecutions=0,publish;
   await writeFile(target,'original');const client=new Codegraff('synthetic-unused-key',{sleep:async()=>{}});
   client.api=async(path,body)=>{assert.ok(path.endsWith('/upload'));calls.push(body);if(mode==='forbidden')throw Object.assign(Error('forbidden'),{status:403});if(mode==='all-unknown'||mode==='not-sent'&&calls.length===1)throw TypeError('request outcome unknown');const value=Buffer.from(body.contentBase64,'base64');if(mode==='corrupt')value[0]^=1;await writeFile(body.path,value);if(mode==='ack-lost'&&calls.length===1)throw TypeError('upload response lost');return {ok:true};};
   client.exec=async(_id,command)=>{commands.push(command);const publication=command.startsWith('if mkdir -m 700');if(publication){publicationDispatches++;publish=command;if(mode==='publish-not-sent'&&publicationDispatches===1)throw TypeError('publication request outcome unknown');publicationExecutions++;}const result=await runProcess('sh',['-c',command],{cwd:dir,timeoutMs:5000});if(result.code)throw Error('publication or inspection failed');if(publication&&mode==='publish-ack-lost'&&publicationDispatches===1)throw TypeError('publication response lost');return result.output;};
   if(['all-unknown','forbidden','corrupt'].includes(mode)){
    await assert.rejects(client.upload('owned-fixture',target,bytes,{recover:true}));assert.equal(await readFile(target,'utf8'),'original');assert.equal(calls.length,mode==='all-unknown'?3:1);if(mode==='forbidden')assert.equal(commands.length,0);
   }else {
    await client.upload('owned-fixture',target,bytes,{recover:true});assert.deepEqual(await readFile(target),bytes);assert.equal(publicationExecutions,1);assert.equal(calls.length,mode==='not-sent'?2:1);
    if(mode==='not-sent'){assert.notEqual(calls[0].path,calls[1].path);await writeFile(calls[0].path,'delayed abandoned upload');assert.deepEqual(await readFile(target),bytes);}
    // A delayed duplicate finalizer cannot overwrite a later generation.
    await writeFile(target,'later generation');const late=await runProcess('sh',['-c',publish],{cwd:dir,timeoutMs:5000});assert.equal(late.code,0);assert.equal(await readFile(target,'utf8'),'later generation');
   }
   assert.equal(new Set(calls.map(call=>call.path)).size,calls.length);
  }finally{await rm(dir,{recursive:true,force:true});}
 }
});
test('parallel selected source manifests exclude abandoned uploads and reconstruct an exact real Git bundle before execution',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nanohub-selected-source-'));
 try {
  const source=join(dir,'source');await mkdir(source);const binary=randomBytes(180003);await writeFile(join(source,'asset.bin'),binary);
  const git=async(...args)=>{const result=await runProcess('git',['-C',source,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args]);assert.equal(result.code,0,result.output);return result.output.trim();};
  await git('init','-b','main');await git('add','.');await git('commit','-m','Synthetic source');const head=await git('rev-parse','HEAD'),bundlePath=join(dir,'source.bundle');await git('bundle','create',bundlePath,'HEAD');
  const remote=join(dir,'remote'),map=path=>path.replaceAll('/workspace/nanohub',remote),client=new Codegraff('synthetic-unused-key',{sleep:async()=>{}});let abandoned,lateWritten=false,destroyed=false;
  client.ready=async()=>{};client.destroy=async()=>{destroyed=true;};client.api=async(path,body)=>{if(path==='/sandboxes')return{id:'owned-source-fixture'};assert.ok(path.endsWith('/upload'));if(body.path.includes('/bundle-')&&!abandoned){abandoned=body;throw TypeError('upload delivery unknown');}if(body.path.includes('/selected-paths.nh-upload-')&&!lateWritten){await writeFile(map(abandoned.path),'wrong delayed abandoned content');lateWritten=true;}await writeFile(map(body.path),Buffer.from(body.contentBase64,'base64'));return{ok:true};};
  client.exec=async(_id,command)=>{if(command.startsWith('docker run'))return'container';if(command.startsWith('docker inspect'))return JSON.stringify({Running:false,ExitCode:0});if(command.startsWith('docker logs'))return'synthetic container result';const result=await runProcess('sh',['-c',map(command)],{cwd:dir,timeoutMs:5000,env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});if(result.code)throw Error(result.output);return result.output;};
  const job=parseWorkflow(workflow,'.github/workflows/check.yml','feature')[0],result=await sandboxJob({client,job,run:{...run,head,base:head},bundle:await readFile(bundlePath),image,artifacts:dir,artifactOrigin:'https://logs.invalid/',repository:'alice/repo',sourceTransferConcurrency:4});assert.equal(result.state,'success');assert.equal(lateWritten,true);assert.equal(destroyed,true);assert.deepEqual(await readFile(join(remote,'source','asset.bin')),binary);const verified=await runProcess('git',['-C',join(remote,'source'),'fsck','--strict']);assert.equal(verified.code,0,verified.output);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('download toolchains pin archive bytes and Docker identity, reject mixed modes and redact invalid delivery configuration',async()=>{
 const {toolchain,archiveDownload}=await import('../../../tools/toolchain.mjs'),local='sha256:'+'a'.repeat(64),download={url:'https://images.invalid/toolchain.tar.gz?cap=synthetic-private-read',sha256:'b'.repeat(64),bytes:12345};
 assert.deepEqual(toolchain(local,undefined,undefined,download),{image:local,snapshot:false,download});
 for(const changed of [{url:'http://images.invalid/archive'},{url:'https://user:password@images.invalid/archive'},{url:'https://images.invalid/archive#fragment'},{url:'https://images.invalid/archive\n'},{url:'not-a-url'},{url:null},{url:'https://images.invalid/'+('a'.repeat(8200))},{bytes:0},{bytes:1.5},{bytes:2**31+1},{sha256:'bad'},{value:'forbidden'}])assert.throws(()=>archiveDownload({...download,...changed}),error=>!error.message.includes('synthetic-private-read')&&!error.message.includes('password'));
 for(const args of [[image,undefined,undefined,download],[local,'snp_fixture',undefined,download],[local,undefined,'/workspace/nanohub-toolchain/image.tar',download]])assert.throws(()=>toolchain(...args));
 await assert.rejects((await import('../../../tools/ci-runner.mjs')).runOnce({origin:'https://host.invalid',repository:'alice/repo',backend:'docker',image:local,imageDownload:download,artifacts:'/tmp/synthetic-artifacts'},'synthetic'),/downloads require the Codegraff backend/);
});

test('archive download launches once, caps streaming bytes, validates HTTP and SHA, and observes unique completion markers',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nanohub-download-script-'));
 try{
  const client=new Codegraff('synthetic-control-key',{sleep:async()=>{}}),uploads=[],commands=[],download={url:"https://images.invalid/archive?cap=synthetic'$(touch${IFS}SENTINEL)",sha256:'b'.repeat(64),bytes:12345};
  let states=['running','0'];client.upload=async(_id,path,bytes)=>uploads.push({path,script:bytes.toString()});client.exec=async(_id,command)=>{commands.push(command);return command.startsWith('if test')?states.shift():'';};
  await client.downloadImage('vm',download,Date.now()+10000);
  assert.equal(uploads.length,1);assert.equal(commands.filter(c=>c.startsWith('nohup')).length,1);assert.equal(states.length,0);assert.ok(commands.some(c=>c==='chmod 600 /tmp/nanohub-image-download.sh'));assert.ok(commands.every(c=>!c.includes('synthetic\'')));
  const script=uploads[0].script;assert.match(script,/set -euo pipefail/);assert.match(script,/--proto '=https'/);assert.match(script,/--max-filesize 12345/);assert.match(script,/head -c 12346/);assert.match(script,/sha256sum --check --status/);assert.match(script,/exit code!="200"/);assert.ok(!script.includes('--location')&&!script.includes('--insecure')&&!script.includes('synthetic-control-key'));
  const file=join(dir,'download.sh');await writeFile(file,script);const syntax=await runProcess('bash',['-n',file]);assert.equal(syntax.code,0,syntax.output);
  const first=commands.find(c=>c.startsWith('if test'));states=['0'];await client.downloadImage('vm',download,Date.now()+10000);const polls=commands.filter(c=>c.startsWith('if test'));assert.notEqual(first,polls.at(-1),'Earlier successful download markers cannot complete a later request');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('download failure, cancellation and expiry do not expose capabilities or relaunch a transfer',async()=>{
 const download={url:'https://images.invalid/image?cap=synthetic-private-read',sha256:'b'.repeat(64),bytes:100};
 for(const terminal of ['1','unexpected']){const client=new Codegraff('key',{sleep:async()=>{}}),commands=[];client.upload=async()=>{};client.exec=async(_id,command)=>{commands.push(command);return command.startsWith('if test')?terminal:'';};await assert.rejects(client.downloadImage('vm',download,Date.now()+10000),error=>/digest verification failed/.test(error.message)&&!error.message.includes('synthetic-private-read'));assert.equal(commands.filter(c=>c.startsWith('nohup')).length,1);}
 const unused=new Codegraff('key');unused.upload=async()=>{throw Error('Must not upload');};await assert.rejects(unused.downloadImage('vm',download,Date.now()-1),/cancelled before/);await assert.rejects(unused.downloadImage('vm',download,Date.now()+10000,async()=>false),/cancelled before/);
 let checks=0;const cancelled=new Codegraff('key');cancelled.upload=async()=>{};const commands=[];cancelled.exec=async(_id,command)=>{commands.push(command);return '';};await assert.rejects(cancelled.downloadImage('vm',download,Date.now()+10000,async()=>++checks===1),/lease is no longer active/);assert.equal(commands.filter(c=>c.startsWith('nohup')).length,1);assert.equal(commands.filter(c=>c.startsWith('if test')).length,0);
});

test('download jobs verify the loaded image before candidate transfer and keep private URLs out of provenance and candidate execution',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nanohub-download-job-'));
 try{
  const client=mockClient(),events=[],local='sha256:'+'d'.repeat(64),download={url:'https://images.invalid/archive?cap=synthetic-private-read',sha256:'e'.repeat(64),bytes:100},exec=client.exec,upload=client.upload;
  client.downloadImage=async(_id,value)=>{assert.deepEqual(value,download);events.push('download');};client.loadImage=async(_id,path)=>{assert.equal(path,'/workspace/nanohub-toolchain/image.tar');events.push('load');};client.exec=async(id,command)=>{if(command.startsWith('docker image inspect')){events.push('verify');return local;}return exec(id,command);};client.upload=async(...args)=>{events.push('candidate');return upload(...args);};
  const job=parseWorkflow(workflow,'.github/workflows/check.yml','feature')[0],result=await sandboxJob({client,job,run,bundle:Buffer.from('candidate bundle'),image:local,imageDownload:download,artifacts:dir,artifactOrigin:'https://logs.invalid/',repository:'alice/repo'});
  assert.equal(result.state,'success');assert.deepEqual(events.slice(0,4),['download','load','verify','candidate']);assert.match(client.calls.find(c=>c.command?.startsWith('docker run')).command,/--pull=never/);assert.match(client.calls.find(c=>c.command?.startsWith('docker run')).command,/--network=none/);
  const receipt=JSON.parse(await readFile(join(dir,'check-test.sandbox.json'),'utf8'));assert.deepEqual(receipt.imageDownload,{sha256:download.sha256,bytes:download.bytes});assert.equal(receipt.image,local);assert.equal(receipt.cleanupNeeded,false);
  for(const value of [receipt,result,client.uploads,client.calls,await readFile(join(dir,'check-test.log'),'utf8')])assert.ok(!JSON.stringify(value).includes('synthetic-private-read'));
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('failed download/load, wrong identity or a lease revoked during preparation prevents candidate uploads and still confirms cleanup',async()=>{
 for(const mode of ['download','load','identity','cancel','expired']){const dir=await mkdtemp(join(tmpdir(),'nanohub-download-denial-'));try{
  const client=mockClient(),local='sha256:'+'d'.repeat(64),download={url:'https://images.invalid/archive?cap=synthetic-private-read',sha256:'e'.repeat(64),bytes:100};
  let live=true,clock=Date.now();client.downloadImage=async()=>{if(mode==='download')throw Error('Archive digest verification failed');};client.loadImage=async()=>{if(mode==='load')throw Error('Image load failed');};client.exec=async()=>{if(mode==='cancel')live=false;if(mode==='expired')clock=run.leaseUntil;return mode==='identity'?'sha256:'+'f'.repeat(64):local;};
  const job=parseWorkflow(workflow,'.github/workflows/check.yml','feature')[0],result=await sandboxJob({client,job,run,bundle:Buffer.from('candidate'),image:local,imageDownload:download,artifacts:dir,artifactOrigin:'https://logs.invalid/',repository:'alice/repo',active:async()=>live,now:()=>clock});
  assert.equal(result.state,'failure');assert.equal(client.uploads.length,0);assert.equal(client.calls.filter(c=>c.destroy).length,1);const receipt=JSON.parse(await readFile(join(dir,'check-test.sandbox.json'),'utf8'));assert.equal(receipt.cleanupNeeded,false);assert.ok(!JSON.stringify(receipt).includes('synthetic-private-read'));
 }finally{await rm(dir,{recursive:true,force:true});}}
});

test('private registry preparation launches one pinned pull and removes its isolated auth directory before reporting success',async()=>{
 const client=new Codegraff('synthetic-gateway',{sleep:async()=>{}}),commands=[],uploads=[],states=['running','0'];
 client.exec=async(_id,command)=>{commands.push(command);return command.startsWith('if test')?states.shift():'';};client.upload=async(_id,path,bytes)=>uploads.push({path,bytes:Buffer.from(bytes)});
 const pinned='registry.cloudflare.com/'+'a'.repeat(32)+'/nanohub-ci@sha256:'+'c'.repeat(64),credentials={username:'v1',password:'synthetic-pull-only',expiresAt:Date.now()+900000};
 await client.pullImage('vm',pinned,credentials,Date.now()+10000);
 assert.equal(uploads.length,1);const auth=JSON.parse(uploads[0].bytes);assert.equal(Buffer.from(auth.auths['registry.cloudflare.com'].auth,'base64').toString(),'v1:synthetic-pull-only');
 assert.ok(commands[0].includes('mkdir -m 700'));assert.ok(commands.some(command=>command.startsWith('chmod 600')));const launch=commands.find(command=>command.startsWith('nohup'));assert.ok(launch.includes(pinned));assert.ok(launch.includes('timeout '));assert.ok(launch.indexOf('rm -rf')<launch.indexOf('printf'));assert.ok(launch.includes('if test -e'));assert.equal(commands.filter(command=>command.startsWith('nohup')).length,1);
 assert.ok(!JSON.stringify(commands).includes('synthetic-pull-only'));assert.ok(!JSON.stringify(uploads).includes('synthetic-gateway'));const marker=commands.find(command=>command.startsWith('if test'));states.push('0');await client.pullImage('vm',pinned,credentials,Date.now()+10000);assert.notEqual(marker,commands.filter(command=>command.startsWith('if test')).at(-1));
 const dir=await mkdtemp(join(tmpdir(),'nanohub-pull-syntax-'));try{const file=join(dir,'launch.sh');await writeFile(file,launch);const syntax=await runProcess('sh',['-n',file]);assert.equal(syntax.code,0,syntax.output);}finally{await rm(dir,{recursive:true,force:true});}
});

test('private registry pull rejects expired credentials, inactive leases and terminal failures without relaunching',async()=>{
 const pinned='registry.cloudflare.com/'+'a'.repeat(32)+'/nanohub-ci@sha256:'+'c'.repeat(64),credential={username:'v1',password:'synthetic-pull-only',expiresAt:Date.now()+900000};
 const unused=new Codegraff('key');unused.exec=async()=>{throw Error('Must not dispatch');};
 await assert.rejects(unused.pullImage('vm',pinned,{...credential,expiresAt:Date.now()},Date.now()+10000),/cancelled before/);await assert.rejects(unused.pullImage('vm',pinned,credential,Date.now()-1),/cancelled before/);await assert.rejects(unused.pullImage('vm',pinned,credential,Date.now()+10000,async()=>false),/cancelled before/);
 const expiresDuringCheck={...credential};await assert.rejects(unused.pullImage('vm',pinned,expiresDuringCheck,Date.now()+10000,async()=>{expiresDuringCheck.expiresAt=Date.now();return true;}),/cancelled before/);
 for(const terminal of ['1','unexpected']){const client=new Codegraff('key'),commands=[];client.upload=async()=>{};client.exec=async(_id,command)=>{commands.push(command);return command.startsWith('if test')?terminal:'';};await assert.rejects(client.pullImage('vm',pinned,credential,Date.now()+10000),/pull or credential cleanup failed/);assert.equal(commands.filter(command=>command.startsWith('nohup')).length,1);}
});

test('private jobs prepare and verify the pinned digest before source transfer; issuance, pull, mismatch and cancellation fail closed',async()=>{
 const pinned='registry.cloudflare.com/'+'a'.repeat(32)+'/nanohub-ci@sha256:'+'c'.repeat(64),imageRegistry={provider:'cloudflare',config:'/etc/nanohub/wrangler.jsonc'};
 for(const mode of ['success','issue','pull','identity','cancel','expired']){
 const dir=await mkdtemp(join(tmpdir(),'nanohub-private-job-'));try{
   const client=mockClient(),events=[],exec=client.exec,upload=client.upload;let live=true,clock=Date.now();
   client.pullImage=async(_id,value,credentials)=>{events.push('pull');assert.equal(value,pinned);assert.equal(credentials.password,'synthetic-pull-only');if(mode==='pull')throw Error('Private pull failed');};
   client.exec=async(id,command)=>{if(command.startsWith('docker image inspect')){events.push('verify');if(mode==='cancel')live=false;if(mode==='expired')clock=run.leaseUntil;return JSON.stringify(mode==='identity'?[]:[pinned]);}return exec(id,command);};client.upload=async(...args)=>{events.push('candidate');return upload(...args);};
   const registryCredentials=async()=>{events.push('issue');if(mode==='issue')throw Error('synthetic-pull-only');return {username:'v1',password:'synthetic-pull-only',expiresAt:Date.now()+900000};};
   const job=parseWorkflow(workflow,'.github/workflows/check.yml','feature')[0],result=await sandboxJob({client,job,run,bundle:Buffer.from('candidate'),image:pinned,imageRegistry,registryCredentials,artifacts:dir,artifactOrigin:'https://logs.invalid/',repository:'alice/repo',active:async()=>live,now:()=>clock});
   assert.equal(result.state,mode==='success'?'success':'failure');assert.equal(client.calls.filter(call=>call.destroy).length,1);
   if(mode==='success'){assert.deepEqual(events.slice(0,4),['issue','pull','verify','candidate']);const command=client.calls.find(call=>call.command?.startsWith('docker run')).command;assert.match(command,/--pull=never/);assert.match(command,/--network=none/);}else assert.equal(client.uploads.length,0);
   const receipt=JSON.parse(await readFile(join(dir,'check-test.sandbox.json'),'utf8')),log=await readFile(join(dir,'check-test.log'),'utf8');assert.equal(receipt.registryProvider,'cloudflare');assert.equal(receipt.image,pinned);assert.equal(receipt.cleanupNeeded,false);assert.ok(!JSON.stringify([result,receipt,log,client.calls,client.uploads]).includes('synthetic-pull-only'));assert.ok(!JSON.stringify(receipt).includes('/etc/nanohub'));
 }finally{await rm(dir,{recursive:true,force:true});}}
});
