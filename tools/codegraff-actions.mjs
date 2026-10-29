/** Trusted dispatcher: Codegraff API credentials stay in this process.
 * Every Actions job gets a disposable Codegraff VM. Only credential-free Git
 * objects enter it; the candidate container cannot reach the VM control API. */
import { readFile, writeFile, stat, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID,createHash } from "node:crypto";
import { parseWorkflow, quote } from "./actions-workflow.mjs";
import { runProcess } from "./ci-runner.mjs";
import { semaphore, positiveInteger } from "./runner-pool.mjs";
import {sourceRef} from './ci-ref.mjs';
import {toolchain,archiveDownload} from './toolchain.mjs';
import {cloudflarePullCredentials} from './cloudflare-registry.mjs';
const id = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Live Fleet probes accept 64 KiB binary payloads while 512 KiB uploads time
// out. This is a conservative transport size, not a claimed provider maximum.
const uploadChunkBytes=64*1024;
const retryableTransferError=error=>error.status===undefined||[408,429,500,502,503,504].includes(error.status);
export class Codegraff {
  constructor(key, { fetcher = fetch, sleep = pause } = {}) {
    if (!key)
      throw Error("CODEGRAFF_API_KEY is required in the trusted dispatcher");
    // Fetch header-validation errors can echo an invalid value. Reject it
    // generically before constructing a request or writing a candidate log.
    if (typeof key !== "string" || key.length > 4096 || /[^\x21-\x7e]/.test(key))
      throw Error("CODEGRAFF_API_KEY must be a valid single-line credential");
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
  async upload(sandbox, path, bytes, {recover=false}={}) {
    bytes=Buffer.from(bytes);
    if(bytes.length>uploadChunkBytes) {
      const temporary='/tmp/nanohub-upload-'+randomUUID();
      await this.exec(sandbox,`mkdir -m 700 ${quote(temporary)}`);
      for(let offset=0,part=0;offset<bytes.length;offset+=uploadChunkBytes,part++)
        await this.upload(sandbox,temporary+'/part-'+String(part).padStart(8,'0'),bytes.subarray(offset,offset+uploadChunkBytes),{recover});
      const digest=createHash('sha256').update(bytes).digest('hex');
      // Only the fresh private staging directory is globbed. Per-part recovery
      // is explicit; the final assembled-file move is never blindly retried.
      await this.exec(sandbox,`LC_ALL=C cat ${quote(temporary)}/part-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9] > ${quote(temporary+'/complete')} && printf '%s  %s\\n' ${quote(digest)} ${quote(temporary+'/complete')} | sha256sum -c - && chmod 644 ${quote(temporary+'/complete')} && mv -f ${quote(temporary+'/complete')} ${quote(path)} && rm -rf ${quote(temporary)}`);
      return;
    }
    if(recover)return this.uploadVerifiedPart(sandbox,path,bytes);
    await this.api(`/sandboxes/${sandbox}/upload`, {
      path,
      contentBase64: bytes.toString("base64"),
    });
  }
  async readTransfer(sandbox,command) {
    let last;for(let n=0;n<3;n++){try{return await this.exec(sandbox,command);}catch(error){last=error;if(!retryableTransferError(error))throw error;if(n<2)await this.sleep(250);}}throw last;
  }
  /** Staging paths are unique. After an unconfirmed write, observe its hash;
   * an unverified copy is abandoned and never selected by the source manifest. */
  async stageUpload(sandbox,path,bytes) {
    bytes=Buffer.from(bytes);if(bytes.length>uploadChunkBytes)throw Error('Stage at most 64 KiB at a time');
    const digest=createHash('sha256').update(bytes).digest('hex');
    let last;
    for(let attempt=0;attempt<3;attempt++) {
      const staging=path+'.nh-upload-'+randomUUID();
      try {await this.api(`/sandboxes/${sandbox}/upload`,{path:staging,contentBase64:bytes.toString('base64')});}
      catch(error){
        if(!retryableTransferError(error))throw error;
        last=error;
        const observed=await this.readTransfer(sandbox,`if test -f ${quote(staging)}; then sha256sum ${quote(staging)}; else printf missing; fi`);
        if(observed.trim().split(/\s/)[0]!==digest){if(attempt<2)await this.sleep(Number.isFinite(error.retryAfterMs)?Math.max(1000,Math.min(30000,error.retryAfterMs)):1000);continue;}
      }
      return staging;
    }
    throw last??Error('Source upload could not be verified');
  }
  /** Only credential-free source/job files opt into reconciliation. Registry
   * and deployment control files keep fail-closed, single-request uploads. */
  async uploadVerifiedPart(sandbox,path,bytes) {
    const digest=createHash('sha256').update(bytes).digest('hex');
    const staging=await this.stageUpload(sandbox,path,bytes),publication=staging+'.publish';
    // A persistent operation lock makes publication idempotent even when an
    // exec response is lost. A verified copy uses a different inode from the
    // upload, so a delayed upload cannot rewrite the published destination.
    const done=publication+'/done',failed=publication+'/failed',copy=publication+'/content';
    const publish=`if mkdir -m 700 ${quote(publication)} 2>/dev/null; then if cp ${quote(staging)} ${quote(copy)} && printf '%s  %s\\n' ${quote(digest)} ${quote(copy)} | sha256sum -c - && chmod 644 ${quote(copy)} && mv -f ${quote(copy)} ${quote(path)} && printf '%s' ${quote(digest)} > ${quote(done)}; then :; else printf failed > ${quote(failed)}; exit 1; fi; elif test -f ${quote(done)}; then test "$(cat ${quote(done)})" = ${quote(digest)}; else exit 75; fi`;
    const observe=`if test -f ${quote(failed)}; then printf failed; elif test -f ${quote(done)} && test "$(cat ${quote(done)})" = ${quote(digest)}; then sha256sum ${quote(path)}; else printf waiting; fi`;
    let last;for(let n=0;n<3;n++){
      try{await this.exec(sandbox,publish);return;}catch(error){
        last=error;if(!retryableTransferError(error))throw error;
        const observed=await this.readTransfer(sandbox,observe);if(observed.trim().split(/\s/)[0]===digest)return;
        if(observed.trim()==='failed')throw error;if(n<2)await this.sleep(250);
      }
    }
    throw last;
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
    const status='/tmp/nanohub-image-load-'+randomUUID()+'.exit',log='/tmp/nanohub-image-load.log';
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
  async downloadImage(sandbox,input,deadline,active=async()=>true) {
    const archive=archiveDownload(input);
    if(!id(sandbox))throw Error('Invalid sandbox ID');
    if(Date.now()>=deadline||!await active()||Date.now()>=deadline)throw Error('Toolchain download cancelled before dispatch');
    const seconds=Math.max(1,Math.min(600,Math.floor((deadline-Date.now())/1000)));
    const status='/tmp/nanohub-image-download-'+randomUUID()+'.exit',log='/tmp/nanohub-image-download.log';
    // The URL can carry a private, expiring read capability. It remains in
    // an owner-only control script, never in candidate files, logs or provenance.
    // A pipe bounds disk writes even when the server omits Content-Length.
    const script=`set -euo pipefail
umask 077
mkdir -p /workspace/nanohub-toolchain
part=/workspace/nanohub-toolchain/image.part
archive=/workspace/nanohub-toolchain/image.tar
headers=/workspace/nanohub-toolchain/image.headers
rm -f "$part" "$archive" "$headers"
curl --fail --silent --show-error --proto '=https' --max-time ${seconds} --max-filesize ${archive.bytes} --dump-header "$headers" ${quote(archive.url)} | head -c ${archive.bytes+1} > "$part"
awk '/^HTTP\\// {sub(/\\r$/,"",$0);code=$2} END {exit code!="200"}' "$headers"
test "$(wc -c < "$part")" -eq ${archive.bytes}
printf '%s  %s\\n' ${quote(archive.sha256)} "$part" | sha256sum --check --status
mv "$part" "$archive"
rm -f "$headers"
`;
    const launcher=`umask 077; bash /tmp/nanohub-image-download.sh > ${log} 2>&1; code=$?; rm -f /tmp/nanohub-image-download.sh; printf '%s\\n' "$code" > ${status}`;
    await this.upload(sandbox,'/tmp/nanohub-image-download.sh',Buffer.from(script));
    await this.exec(sandbox,'chmod 600 /tmp/nanohub-image-download.sh');
    await this.exec(sandbox,`nohup sh -c ${quote(launcher)} > /tmp/nanohub-image-download-launch.log 2>&1 < /dev/null &`);
    while(Date.now()<deadline) {
      if(!await active())throw Error('Toolchain download cancelled: candidate lease is no longer active');
      const result=(await this.exec(sandbox,`if test -f ${status}; then cat ${status}; else printf running; fi`)).trim();
      if(result==='0')return;
      if(result!=='running')throw Error('Trusted toolchain archive download or digest verification failed');
      await this.sleep(2000);
    }
    throw Error('Trusted toolchain archive download timed out');
  }
  async pullImage(sandbox,image,credentials,deadline,active=async()=>true) {
    if(!id(sandbox)||typeof image!=='string'||!/^registry\.cloudflare\.com\/[a-f0-9]{32}\/[a-z0-9]+(?:[._-][a-z0-9]+)*@sha256:[a-f0-9]{64}$/.test(image))throw Error('Invalid private registry image');
    if(credentials?.username!=='v1'||typeof credentials.password!=='string'||credentials.password.length<1||credentials.password.length>16384||/[^\x21-\x7e]/.test(credentials.password)||!Number.isSafeInteger(credentials.expiresAt))throw Error('Invalid private registry pull credential');
    if(Date.now()>=deadline||credentials.expiresAt<=Date.now()+30000||!await active()||Date.now()>=deadline||credentials.expiresAt<=Date.now()+30000)throw Error('Private registry pull cancelled before dispatch');
    const token=randomUUID(),directory='/tmp/nanohub-registry-'+token,status='/tmp/nanohub-image-pull-'+token+'.exit';
    // Only this private Docker config receives the short-lived account pull
    // credential. It is removed before success is reported or source uploaded.
    await this.exec(sandbox,`umask 077; mkdir -m 700 ${directory}`);
    await this.upload(sandbox,directory+'/config.json',Buffer.from(JSON.stringify({auths:{'registry.cloudflare.com':{auth:Buffer.from(credentials.username+':'+credentials.password).toString('base64')}}})));
    await this.exec(sandbox,`chmod 600 ${directory}/config.json`);
    const seconds=Math.max(1,Math.min(600,Math.floor((Math.min(deadline,credentials.expiresAt)-Date.now())/1000)));
    const script=`umask 077; timeout ${seconds}s docker --config ${directory} pull ${quote(image)} > /tmp/nanohub-image-pull.log 2>&1; code=$?; if ! rm -rf ${directory}; then code=1; fi; if test -e ${directory}; then code=1; fi; printf '%s\\n' "$code" > ${status}`;
    await this.exec(sandbox,`nohup sh -c ${quote(script)} > /tmp/nanohub-image-pull-launch.log 2>&1 < /dev/null &`);
    while(Date.now()<deadline) {
      if(!await active())throw Error('Private registry pull cancelled: candidate lease is no longer active');
      const result=(await this.exec(sandbox,`if test -f ${status}; then cat ${status}; else printf running; fi`)).trim();
      if(result==='0')return;
      if(result!=='running')throw Error('Private registry toolchain pull or credential cleanup failed');
      await this.sleep(2000);
    }
    throw Error('Private registry toolchain pull timed out');
  }
}
/** Retry only explicit capacity/preparation responses, which allocate no VM.
 * Network timeouts have an unknown outcome and must not allocate duplicates. */
export async function allocateSandbox(client,spec,deadline,active=async()=>true,hooks={}) {
  for(;;){
    if(!await active())throw Error('Candidate lease is no longer active');
    await hooks.beforeCreate?.();
    try{return await client.api('/sandboxes',spec);}catch(error){
      if([429,503].includes(error.status))hooks.notCreated?.();
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
  imageDownload,
  imageRegistry,
  registryCredentials = cloudflarePullCredentials,
  prepare = "",
  network = "none",
  artifacts,
  artifactOrigin,
  repository,
  receipt = writeFile,
  capacity,
  active = async () => true,
  now = Date.now,
}) {
  const selected=toolchain(image,imageSnapshot,imageArchive,imageDownload,imageRegistry);
  const provenance=selected.registry?{image,registryProvider:'cloudflare'}:selected.download?{image,imageDownload:{sha256:selected.download.sha256,bytes:selected.download.bytes}}:selected.snapshot?{image,imageSnapshot,...(imageArchive?{imageArchive}:{})}:{};
  if(!["none", "bridge"].includes(network))throw Error("Use an explicit network policy");
  const deadline = Math.min(now() + job.timeoutMs, run.leaseUntil - 30000);
  const ensureTransferActive=async()=>{
    if(now()>=deadline)throw Object.assign(Error('Job timed out during source transfer'),{code:'job_deadline'});
    if(!await active())throw Object.assign(Error('Candidate lease is no longer active during source transfer'),{code:'ci_cancelled'});
  };
  if (deadline <= now()) throw Error("CI lease exhausted");
  if(!await active()) {
    const file=job.name.replaceAll('/','-')+'.log',command='Cancelled before allocation: candidate lease is no longer active';
    await writeFile(join(artifacts,file),command+'\n');
    return{name:job.name,state:'cancelled',command,log:new URL(file,artifactOrigin).href,artifacts:[]};
  }
  const slot=capacity?await capacity.acquire(job):null;
  let allocationUncertain=false,allocated;
  try {
    if(slot&&(now()>=deadline||!await active()))throw Error('Candidate lease is no longer active before allocation');
    allocated = await allocateSandbox(client, {
      provider: "fleet",
      cpu: 4,
      memory: 16,
      disk: 60,
      autoStopMinutes: Math.min(
        120,
        Math.ceil((deadline - now()) / 60000) + 10,
      ),
    },Math.min(deadline,now()+5*60000),active,{
      beforeCreate:async()=>{await slot?.allocating();allocationUncertain=true;},
      notCreated:()=>{allocationUncertain=false;},
    });
  }catch(error){if(slot&&!allocationUncertain)await slot.released();throw error;}
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
        ...provenance,
      }),
    );
    await slot?.attached(sandbox);
    await client.ready(sandbox, Math.min(deadline, now() + 5 * 60000));
    if(selected.registry) {
      if(now()>=deadline||!await active()||now()>=deadline)throw Error('Candidate lease is no longer active before registry preparation');
      let credentials;
      // Trusted issuers can include provider output in their exception. Never
      // copy that text into a candidate log or hosted callback.
      try {credentials=await registryCredentials(image,selected.registry);}
      catch {throw Error('Private registry credential issuance failed');}
      await client.pullImage(sandbox,image,credentials,Math.min(deadline,now()+10*60000),active);
      const digests=JSON.parse((await client.exec(sandbox,`docker image inspect --format '{{json .RepoDigests}}' ${quote(image)}`)).trim());
      if(!Array.isArray(digests)||!digests.includes(image))throw Error('Private toolchain does not match its configured registry digest');
      if(now()>=deadline||!await active()||now()>=deadline)throw Error('Candidate lease is no longer active after toolchain preparation');
    } else if(selected.snapshot) {
      await client.restore(sandbox,imageSnapshot,Math.min(deadline,now()+5*60000),active);
      if(imageArchive)await client.loadImage(sandbox,imageArchive,Math.min(deadline,now()+5*60000),active);
    } else if(selected.download) {
      await client.downloadImage(sandbox,selected.download,Math.min(deadline,now()+10*60000),active);
      await client.loadImage(sandbox,'/workspace/nanohub-toolchain/image.tar',Math.min(deadline,now()+5*60000),active);
    }
    if(selected.snapshot||selected.download) {
      const actual=(await client.exec(sandbox,`docker image inspect --format '{{.Id}}' ${quote(image)}`)).trim();
      if(actual!==image)throw Error('Trusted toolchain image is missing or differs from its configured SHA-256 ID');
      if(now()>=deadline||!await active()||now()>=deadline)throw Error('Candidate lease is no longer active after toolchain preparation');
    }
    const transfer='/workspace/nanohub/transfer-'+randomUUID();
    await client.exec(sandbox, `mkdir -p /workspace/nanohub && mkdir -m 700 ${quote(transfer)}`);
    const chunks = [];
    const chunkBytes=uploadChunkBytes;
    for (let offset = 0; offset < bundle.length; offset += chunkBytes) {
      await ensureTransferActive();
      const part =
        transfer+"/bundle-" + String(chunks.length).padStart(5, "0");
      const bytes=bundle.subarray(offset, offset + chunkBytes);
      let selected=part;
      if(typeof client.stageUpload==='function')selected=await client.stageUpload(sandbox,part,bytes);
      else await client.upload(sandbox,part,bytes);
      if(typeof selected!=='string'||!selected.startsWith(transfer+'/')||!/^bundle-\d{5}(?:\.nh-upload-[a-f0-9-]{36})?$/.test(selected.slice(transfer.length+1)))throw Error('Invalid staged source path');
      chunks.push(selected.slice(transfer.length+1));
    }
    await ensureTransferActive();
    const manifest=transfer+'/selected-paths';
    await client.upload(sandbox,manifest,Buffer.from(chunks.join('\n')+'\n'),{recover:true});
    await client.exec(
      sandbox,
      `(cd ${quote(transfer)} && while IFS= read -r part; do cat "$part" || exit 1; done < selected-paths) > /workspace/nanohub/source.bundle && printf '%s  %s\\n' ${quote(createHash('sha256').update(bundle).digest('hex'))} /workspace/nanohub/source.bundle | sha256sum -c - && git clone --no-checkout /workspace/nanohub/source.bundle /workspace/nanohub/source && git -C /workspace/nanohub/source checkout --detach ${quote(run.head)} && test "$(git -C /workspace/nanohub/source rev-parse HEAD)" = ${quote(run.head)}`,
    );
    const script = `set -e\ncp -R /source /tmp/work\ncd /tmp/work\n${prepare}\n${job.script}`;
    await client.upload(
      sandbox,
      "/workspace/nanohub/job.sh",
      Buffer.from(script),
      {recover:true},
    );
    await ensureTransferActive();
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
    const command = `docker run --detach ${selected.registry||selected.snapshot||selected.download?'--pull=never ':''}--name ${name} --cap-drop=ALL --security-opt=no-new-privileges --network=${network} --memory=8g --cpus=4 --pids-limit=512 --user=1000:1000 --tmpfs /tmp:rw,exec,size=8g --mount type=bind,src=/workspace/nanohub/source,dst=/source,readonly --mount type=bind,src=/workspace/nanohub/job.sh,dst=/job.sh,readonly ${Object.entries(
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
    state = error.code==='job_deadline'?'timed_out':error.code==='ci_cancelled'?'cancelled':"failure";
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
    if(!cleanupError) {
      try {await slot?.released(sandbox);}catch(error){cleanupError=error;}
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
        ...provenance,
      }),
    );
  }
  if (cleanupError) {
    state = "failure";
    output +=
      "\nSandbox cleanup or shared capacity release failed; inspect the saved receipts before retrying";
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
    registryCredentials = cloudflarePullCredentials,
    capacity,
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
            return await sandboxJob({client,job,run,bundle,image:config.image,imageSnapshot:config.imageSnapshot,imageArchive:config.imageArchive,imageDownload:config.imageDownload,imageRegistry:config.imageRegistry,registryCredentials,prepare:config.prepare,network:config.network??'none',artifacts,artifactOrigin,repository:config.repository??config.trunk,active:context.active,capacity});
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
