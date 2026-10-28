import { createHash } from "node:crypto";

const versionId = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const phases = new Set(["seed", "frozen", "verify", "reconcile"]);
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    : value;

/** Fingerprint complete immutable version resources without retaining binding
 * values in the retry receipt. Callers also validate the owned binding graph. */
export function phaseDeploymentSnapshot(observation, phase) {
  const { version, metadata } = observation ?? {};
  const resources = metadata?.resources;
  const bindings = resources?.bindings;
  if (!phases.has(phase) || !versionId.test(version ?? "") || metadata?.id !== version ||
      !resources?.script || !resources?.script_runtime || !Array.isArray(bindings) ||
      bindings.some(binding => !binding || typeof binding.name !== "string") ||
      new Set(bindings.map(binding => binding.name)).size !== bindings.length ||
      bindings.find(binding => binding.name === "NANOHUB_RECOVERY_HOLD")?.text !== "1" ||
      bindings.find(binding => binding.name === "HOSTED_REPO_RECOVERY")?.text !== "1" ||
      bindings.find(binding => binding.name === "HOSTED_REPO_PHASE")?.text !== phase)
    throw Error("Unconfirmed held fixture deployment; keep recovery closed");
  return {
    version,
    resourceSha256: createHash("sha256").update(JSON.stringify(canonical({
      ...resources,
      bindings: [...bindings].sort((a, b) => a.name.localeCompare(b.name)),
    }))).digest("hex"),
  };
}

function assetSessionFailure(result, accountId, worker) {
  if (!Number.isSafeInteger(result?.code) || result.code === 0 || result.timedOut || result.executionUncertain) return false;
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  const endpoint = `/accounts/${accountId}/workers/scripts/${worker}/assets-upload-session`;
  const failedRequest = `A request to the Cloudflare API (${endpoint}) failed.`;
  // An exact pre-code-upload endpoint failure only. Unknown outcomes, upload or
  // deployment acknowledgements, auth errors and transport failures cannot retry.
  const codes = [...output.matchAll(/\[code:\s*(\d+)\]/g)];
  return output.split(failedRequest).length === 2 && codes.length === 1 && codes[0][1] === "10013" &&
    !/\b(?:Uploaded|Deployed|10000|10006|10007|401|403)\b|Current Version ID|unauthori[sz]ed|authentication|permission denied|fetch failed|timed?\s*out|ECONN|ETIMEDOUT|UND_ERR_/i.test(output);
}

/** Only the already-existing, privately owned recovery app's phase deploy may
 * retry once, after an exact asset-session rejection and unchanged provider
 * state. This is not a generic deploy/mutation retry or a recovery-write retry. */
export async function deployHeldFixturePhase({
  accountId, runId, purpose, worker, phase, previousPhase, previous,
  deployOnce, observe, recordRetry,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
}) {
  const prefix = purpose === "vault-recovery" ? "nh-vault-recovery-"
    : purpose === "repository-recovery" ? "nh-repo-recovery-" : null;
  if (!prefix || !/^[a-f0-9]{32}$/.test(accountId) ||
      !/^[a-z0-9]{8,12}-[a-f0-9]{10}$/.test(runId) ||
      worker !== `${prefix}${runId}-app` || !phases.has(phase) ||
      typeof recordRetry !== "function")
    throw Error("Phase deployment requires an owned recovery fixture");
  const baseline = phaseDeploymentSnapshot(previous, previousPhase);
  let result = await deployOnce();
  let attempts = 1;
  if (assetSessionFailure(result, accountId, worker)) {
    await sleep(1000);
    const unchanged = phaseDeploymentSnapshot(await observe(), previousPhase);
    if (unchanged.version !== baseline.version || unchanged.resourceSha256 !== baseline.resourceSha256)
      throw Error("Phase deployment outcome changed provider state; keep recovery closed");
    // Persist proof before another mutation. A receipt failure prevents retry.
    await recordRetry({
      reason: "owned-assets-upload-session-10013-before-code-upload",
      worker, phase, previousPhase, previous: baseline, observed: unchanged,
      failedStep: result.step ?? null, retry: 1,
    });
    result = await deployOnce();
    attempts++;
  }
  if (result.code) throw Error("Phase deployment failed; inspect its private log");
  const acknowledgements = [...String(result.stdout ?? "").matchAll(/Current Version ID:[ \t]*([^\s]+)/g)];
  if (acknowledgements.length !== 1 || !versionId.test(acknowledgements[0][1]))
    throw Error("Phase deployment version not acknowledged; keep recovery closed");
  const observed = await observe();
  const deployed = phaseDeploymentSnapshot(observed, phase);
  if (deployed.version !== acknowledgements[0][1])
    throw Error("Phase deployment acknowledgement is not the active version; keep recovery closed");
  return { ...observed, attempts };
}
