/** Trusted dispatcher: Codegraff API credentials stay in this process.
 * Every Actions job gets a disposable Codegraff VM. Only credential-free Git
 * objects enter it; the candidate container cannot reach the VM control API. */
import { readFile, writeFile, stat, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseWorkflow, quote } from "./actions-workflow.mjs";
import { runProcess } from "./ci-runner.mjs";
import { semaphore, positiveInteger } from "./runner-pool.mjs";
import {sourceRef} from './ci-ref.mjs';
import {toolchain} from './toolchain.mjs';
const id = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export class Codegraff {
  constructor(key, { fetcher = fetch, sleep = pause } = {}) {
    if (!key)
      throw Error("CODEGRAFF_API_KEY is required in the trusted dispatcher");
    this.key = key;
    this.fetcher = fetcher;
    this.sleep = sleep;
  }
  async api(path, body, method = body ? "POST" : "GET",timeoutMs=60000) {
    const response = await this.fetcher(
      "https://gateway.codegraff.com/v1" + path,
      {
        method,
        headers: {
          Authorization: `Bearer ${this.key}`,
          "Content-Type": "application/json",
          "User-Agent": "nanohub-actions/1.0",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
      },
    );
    if (method === "DELETE" && response.status === 404) return {};
    if (!response.ok) {
      const error=Error(`Codegraff ${method} request failed (${response.status})`);
      if(response.status===403) {
        // Expose only a known scope diagnosis, never the gateway's raw body.
        const diagnosis=await response.json().catch(()=>null);
        if(diagnosis?.error?.type==='insufficient_scope')
          error.message="Codegraff API key requires the sandbox scope for Actions";
      }
      error.status=response.status;
      const retry=response.headers.get('retry-after');
      const seconds=Number(retry);
      error.retryAfterMs=retry?(Number.isFinite(seconds)?seconds*1000:Date.parse(retry)-Date.now()):2000;
      throw error;
    }
    return response.status === 204 ? {} : response.json();
  }
  async exec(sandbox, command) {
    const r = await this.api(`/sandboxes/${sandbox}/exec`, {
      command,
      timeoutSeconds: 30,
    });
    if (r.exitCode !== 0)
      throw Error("Codegraff sandbox control command failed");
    return String(r.result ?? "");
  }
  async ready(sandbox, deadline) {
    while (Date.now() < deadline) {
      const r = await this.api(`/sandboxes/${sandbox}`);
      if (r.state === "started") return;
      if (["failed", "stopped", "deleted", "expired"].includes(r.state))
        throw Error("Codegraff sandbox did not start");
      await this.sleep(2000);
    }
    throw Error("Codegraff sandbox startup timed out");
  }
  async upload(sandbox, path, bytes) {
    await this.api(`/sandboxes/${sandbox}/upload`, {
      path,
      contentBase64: Buffer.from(bytes).toString("base64"),
    });
  }
  async destroy(sandbox) {
    if (!id(sandbox)) throw Error("Invalid sandbox ID");
    await this.api(`/sandboxes/${sandbox}`, undefined, "DELETE");
    // Fleet retains a destroyed tombstone. A successful request or a stopped
    // VM alone does not prove deletion; keep the recovery receipt until confirmed.
    for(let attempt=0;attempt<5;attempt++) {
      try {
        const current=await this.api(`/sandboxes/${sandbox}`,undefined,'GET',5000);
        if(['destroyed','deleted','expired'].includes(current.state))return {};
      }catch(error){if(error.status===404)return {};throw error;}
      if(attempt<4)await this.sleep(1000);
    }
    throw Error('Codegraff sandbox deletion could not be confirmed');
  }
  async restore(sandbox,snapshot,deadline,active=async()=>true) {
    if(!id(sandbox)||!/^snp_[A-Za-z0-9_-]{1,156}$/.test(snapshot))throw Error('Invalid sandbox or toolchain snapshot ID');
    if(Date.now()>=deadline||!await active())throw Error('Toolchain restore cancelled before dispatch');
    const requested=await this.api(`/sandboxes/${sandbox}/restore`,{snapshotId:snapshot});
    if(!id(requested.restoreId))throw Error('Codegraff returned an invalid restore ID');
    while(Date.now()<deadline) {
      if(!await active())throw Error('Toolchain restore cancelled: candidate lease is no longer active');
      const current=await this.api(`/sandboxes/${sandbox}/restore/${requested.restoreId}`,undefined,'GET',20000);
      if(current.state==='done')return;
      if(current.state!=='restoring')throw Error('Codegraff toolchain restore did not complete');
      await this.sleep(2000);
    }
    throw Error('Codegraff toolchain restore timed out');
  }
  async loadImage(sandbox,archive,deadline,active=async()=>true) {
    if(!id(sandbox)||archive!=='/workspace/nanohub-toolchain/image.tar')throw Error('Invalid trusted image archive');
    const status='/tmp/nanohub-image-load.exit',log='/tmp/nanohub-image-load.log';
    if(Date.now()>=deadline||!await active())throw Error('Toolchain image load cancelled before dispatch');
    // Loading a large cache can outlast the control API command timeout. Launch
    // it once and observe its exit file; an observation timeout never restarts it.
    const script=`docker load --input ${quote(archive)} > ${log} 2>&1; code=$?; printf '%s\\n' "$code" > ${status}`;
    await this.upload(sandbox,'/tmp/nanohub-image-load.sh',Buffer.from(script));
    await this.exec(sandbox,`nohup sh /tmp/nanohub-image-load.sh > /tmp/nanohub-image-launch.log 2>&1 < /dev/null &`);
    while(Date.now()<deadline) {
      if(!await active())throw Error('Toolchain image load cancelled: candidate lease is no longer active');
      const result=(await this.exec(sandbox,`if test -f ${status}; then cat ${status}; else printf running; fi`)).trim();
      if(result==='0')return;
      if(result!=='running')throw Error('Trusted toolchain image load failed');
      await this.sleep(2000);
    }
    throw Error('Trusted toolchain image load timed out');
  }
}
/** Retry only explicit capacity/preparation responses, which allocate no VM.
 * Network timeouts have an unknown outcome and must not allocate duplicates. */
export async function allocateSandbox(client,spec,deadline,active=async()=>true) {
  for(;;){
    if(!await active())throw Error('Candidate lease is no longer active');
    try{return await client.api('/sandboxes',spec);}catch(error){
      const delay=Math.max(1000,Number.isFinite(error.retryAfterMs)?error.retryAfterMs:2000);
      if(![429,503].includes(error.status)||Date.now()+delay>=deadline)throw error;
      for(let remaining=delay;remaining>0;remaining-=30000){
        await client.sleep(Math.min(30000,remaining));
        if(!await active())throw Error('Candidate lease is no longer active');
      }
    }
  }
}
export async function sandboxJob({
  client,
  job,
  run,
  bundle,
  image,
  imageSnapshot,
  imageArchive,
  prepare = "",
  network = "none",
  artifacts,
  artifactOrigin,
  repository,
  receipt = writeFile,
  active = async () => true,
  now = Date.now,
}) {
  const selected=toolchain(image,imageSnapshot,imageArchive);
  if(!["none", "bridge"].includes(network))throw Error("Use an explicit network policy");
  const deadline = Math.min(now() + job.timeoutMs, run.leaseUntil - 30000);
  if (deadline <= now()) throw Error("CI lease exhausted");
  if(!await active()) {
    const file=job.name.replaceAll('/','-')+'.log',command='Cancelled before allocation: candidate lease is no longer active';
    await writeFile(join(artifacts,file),command+'\n');
    return{name:job.name,state:'cancelled',command,log:new URL(file,artifactOrigin).href,artifacts:[]};
  }
  const allocated = await allocateSandbox(client, {
    provider: "fleet",
    cpu: 4,
    memory: 16,
    disk: 60,
    autoStopMinutes: Math.min(
      120,
      Math.ceil((deadline - now()) / 60000) + 10,
    ),
  },Math.min(deadline,now()+5*60000),active);
  if (!id(allocated.id))
    throw Error("Codegraff returned an invalid sandbox ID");
  const sandbox = allocated.id,
    name = "nanohub-job",
    path = join(artifacts, job.name.replaceAll("/", "-") + ".sandbox.json");
  let output = "",
    state = "failure",
    cleanupError = null;
  try {
    await receipt(
      path,
      JSON.stringify({
        sandboxId: sandbox,
        provider: "codegraff",
        runId: run.id,
        attempt: run.attempt,
        job: job.name,
        head: run.head,
        cleanupNeeded: true,
        ...(selected.snapshot?{image,imageSnapshot,...(imageArchive?{imageArchive}:{})}:{}),
      }),
    );
    await client.ready(sandbox, Math.min(deadline, now() + 5 * 60000));
    if(selected.snapshot) {
      await client.restore(sandbox,imageSnapshot,Math.min(deadline,now()+5*60000),active);
      if(imageArchive)await client.loadImage(sandbox,imageArchive,Math.min(deadline,now()+5*60000),active);
      const actual=(await client.exec(sandbox,`docker image inspect --format '{{.Id}}' ${quote(image)}`)).trim();
      if(actual!==image)throw Error('Trusted toolchain image is missing or differs from its configured SHA-256 ID');
    }
    await client.exec(sandbox, "mkdir -p /workspace/nanohub");
    const chunks = [];
    // Gateway preview uploads are capped at 1 MB. Leave room for base64/JSON
    // overhead instead of sending a full 1 MiB binary chunk.
    const chunkBytes=512*1024;
    for (let offset = 0; offset < bundle.length; offset += chunkBytes) {
      const part =
        "/workspace/nanohub/bundle-" + String(chunks.length).padStart(5, "0");
      await client.upload(
        sandbox,
        part,
        bundle.subarray(offset, offset + chunkBytes),
      );
      chunks.push(part);
    }
    await client.exec(
      sandbox,
      `cat ${chunks.map(quote).join(" ")} > /workspace/nanohub/source.bundle && git clone --no-checkout /workspace/nanohub/source.bundle /workspace/nanohub/source && git -C /workspace/nanohub/source checkout --detach ${quote(run.head)} && test "$(git -C /workspace/nanohub/source rev-parse HEAD)" = ${quote(run.head)}`,
    );
    const script = `set -e\ncp -R /source /tmp/work\ncd /tmp/work\n${prepare}\n${job.script}`;
    await client.upload(
      sandbox,
      "/workspace/nanohub/job.sh",
      Buffer.from(script),
    );
    const variables = {
      CI: "true",
      GITHUB_ACTIONS: "true",
      NANOHUB: "true",
      GITHUB_SHA: run.head,
      GITHUB_REF: sourceRef(run).ref,
      GITHUB_REF_NAME: sourceRef(run).name,
      GITHUB_REF_TYPE: sourceRef(run).type,
      GITHUB_REPOSITORY: repository,
      GITHUB_WORKSPACE: "/tmp/work",
    };
    const command = `docker run --detach ${selected.snapshot?'--pull=never ':''}--name ${name} --cap-drop=ALL --security-opt=no-new-privileges --network=${network} --memory=8g --cpus=4 --pids-limit=512 --user=1000:1000 --tmpfs /tmp:rw,exec,size=8g --mount type=bind,src=/workspace/nanohub/source,dst=/source,readonly --mount type=bind,src=/workspace/nanohub/job.sh,dst=/job.sh,readonly ${Object.entries(
      variables,
    )
      .map(([k, v]) => `--env ${quote(k + "=" + v)}`)
      .join(" ")} ${quote(image)} bash /job.sh`;
    await client.exec(sandbox, command);
    let completed = false,
      lastLeaseCheck = 0,
      cancelled = false;
    while (now() < deadline) {
      if (now() - lastLeaseCheck > 10000) {
        lastLeaseCheck = now();
        if (!(await active())) {
          state = "cancelled";
          cancelled = true;
          break;
        }
      }
      const current = JSON.parse(
        (
          await client.exec(
            sandbox,
            `docker inspect --format '{{json .State}}' ${name}`,
          )
        ).trim(),
      );
      if (current.Running === false) {
        state = current.ExitCode === 0 ? "success" : "failure";
        completed = true;
        break;
      }
      await client.sleep(2000);
    }
    // The gateway bounds exec output. Bound the tail remotely so a long suite
    // retains its terminal failure/pass context instead of losing the ending.
    output = await client.exec(sandbox, `docker logs --tail 3000 ${name} > /tmp/nanohub-job-tail.log 2>&1 && tail -c 16384 /tmp/nanohub-job-tail.log`);
    if (!completed && !cancelled) {
      state = "timed_out";
      output += "\nJob or CI lease timed out";
    }
  } catch (error) {
    state = "failure";
    output += "\n" + String(error);
  } finally {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await client.destroy(sandbox);
        cleanupError = null;
        break;
      } catch (error) {
        cleanupError = error;
      }
    }
    await receipt(
      path,
      JSON.stringify({
        sandboxId: sandbox,
        provider: "codegraff",
        runId: run.id,
        attempt: run.attempt,
        job: job.name,
        head: run.head,
        cleanupNeeded: !!cleanupError,
        ...(selected.snapshot?{image,imageSnapshot,...(imageArchive?{imageArchive}:{})}:{}),
      }),
    );
  }
  if (cleanupError) {
    state = "failure";
    output +=
      "\nSandbox cleanup failed; use the saved receipt to retry deletion";
  }
  const file = job.name.replaceAll("/", "-") + ".log";
  await writeFile(join(artifacts, file), output.slice(-(2 << 20)));
  return {
    name: job.name,
    state,
    command: `Codegraff sandbox; ${job.workflow}; workflow at ${run.base}`,
    log: new URL(file, artifactOrigin).href,
    artifacts: [],
    execution: {
      provider: "codegraff",
      sandboxId: sandbox,
      workflow: job.workflow,
      job: job.id,
    },
  };
}
export async function executeActions(
  context,
  config,
  {
    client = new Codegraff(process.env.CODEGRAFF_API_KEY),
    processRunner = runProcess,
    sandboxLimit = work => work(),
  } = {},
) {
  const { run, source, artifacts, artifactOrigin } = context;
  const git = async (...args) => {
    const result = await processRunner("git", ["-C", source, ...args], {
      env: {
        PATH: process.env.PATH,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
      },
    });
    if (result.code) throw Error("Cannot read pinned workflow or bundle");
    return result.output.trim();
  };
  // The observed base is trusted. A contributor cannot replace a required
  // workflow in their feature branch with a job that unconditionally succeeds.
  const entries = (
    await git(
      "ls-tree",
      "-r",
      "--name-only",
      run.base,
      "--",
      ".github/workflows",
    )
  )
    .split("\n")
    .filter((p) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p));
  if (!entries.length || entries.length > 16)
    throw Error(
      "Commit 1–16 Actions workflows to the default branch before dispatch",
    );
  const jobs = [];
  for (const file of entries)
    jobs.push(
      ...parseWorkflow(
        await git("show", `${run.base}:${file}`),
        file,
        run.branch,
        sourceRef(run).ref,
      ),
    );
  if (jobs.length > 29) throw Error("At most 29 jobs per candidate");
  if (
    new Set(jobs.map((j) => j.name.replaceAll("/", "-"))).size !== jobs.length
  )
    throw Error(
      "Workflow/job names produce colliding log names; rename the workflow or job",
    );
  const temporary = await mkdtemp(join(tmpdir(), "nanohub-bundle-")),
    bundlePath = join(temporary, "candidate.bundle");
  try {
    await git("bundle", "create", bundlePath, "HEAD");
    if ((await stat(bundlePath)).size > 64 * 1024 * 1024)
      throw Error("Candidate bundle exceeds 64 MiB runner transfer limit");
    const bundle = await readFile(bundlePath), pending = new Map();
    const jobLimit=semaphore(positiveInteger(config.jobConcurrency??4,'Job concurrency'));
    const stopped=async(job,state,command)=>{
      const file=job.name.replaceAll('/','-')+'.log';
      await writeFile(join(artifacts,file),command+'\n');
      return{name:job.name,state,command,log:new URL(file,artifactOrigin).href,artifacts:[]};
    };
    for (const job of jobs) {
      const dependencies=job.needs.map(dep=>pending.get(job.workflow+'#'+dep));
      const result=(async()=>{
        const required=await Promise.all(dependencies);
        if(required.some(r=>r.state!=='success'))return stopped(job,'skipped','Skipped because a prerequisite job did not succeed');
        return jobLimit(()=>sandboxLimit(async()=>{
          if(context.active && !await context.active())return stopped(job,'cancelled','Cancelled before allocation: candidate lease is no longer active');
          try {
            return await sandboxJob({client,job,run,bundle,image:config.image,imageSnapshot:config.imageSnapshot,imageArchive:config.imageArchive,prepare:config.prepare,network:config.network??'none',artifacts,artifactOrigin,repository:config.repository??config.trunk,active:context.active});
          }catch(error){return stopped(job,'failure','Sandbox allocation or dispatch failed: '+String(error));}
        }));
      })();
      pending.set(job.workflow+'#'+job.id,result);
    }
    // Never remove the bundle or return while a sibling VM still needs cleanup.
    const settled=await Promise.allSettled(pending.values());
    const failed=settled.find(r=>r.status==='rejected');if(failed)throw failed.reason;
    return { results:settled.map(r=>r.value), staging: null };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
