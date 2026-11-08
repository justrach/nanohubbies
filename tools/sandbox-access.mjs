/** Trusted dispatcher startup gate. Probe sandbox access without claiming a
 * candidate or allocating a VM. Account access is distinct from job acceptance. */
import { createHash } from "node:crypto";

const httpStatus = status => Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
export function validateSandboxAccessProbeId(value){
  if(value!==undefined&&(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(value)))throw Error('Use a trusted sandbox ID for sandboxAccessProbeId');
  return value;
}
function accessError(error) {
  const status = httpStatus(error?.status);
  const insufficientScope = status === 403 && error?.message === "Codegraff API key requires the sandbox scope for Actions";
  const message = insufficientScope
    ? "Codegraff API key requires the sandbox scope for Actions; no CI job was claimed"
    : status === 401 || status === 403
      ? `Codegraff sandbox access was denied (${status}); no CI job was claimed`
      : "Codegraff sandbox access could not be verified; no CI job was claimed";
  return Object.assign(Error(message), {
    code: insufficientScope ? "sandbox_scope_required" : "sandbox_access_unverified",
    ...(status ? { status } : {}),
  });
}

/** Single flight across repository workers. Cache only a key fingerprint and
 * bounded safe receipts/errors, never account inventory or a credential value.
 * Recheck success after five minutes and failures after five seconds; replacing
 * the configured key always selects a new entry. Revocation can occur between
 * any two requests, so normal per-request provider authorization still applies. */
export function createSandboxAccessPreflight({
  probe = async (key,{sandboxId}={}) => {
    const { Codegraff } = await import("./codegraff-actions.mjs");
    const response=await new Codegraff(key).api(sandboxId?'/sandboxes/'+sandboxId:'/sandboxes', undefined, "GET", 20000);
    if(sandboxId){
      if(response?.id!==sandboxId||typeof response.state!=='string'||!/^[a-z][a-z_-]{0,31}$/.test(response.state))throw Error('Unverifiable sandbox access probe');
    }else if(!Array.isArray(response)&&!Array.isArray(response?.sandboxes))throw Error('Unverifiable sandbox-list response');
  },
  now = Date.now,
  ttlMs = 300000,
  failureTtlMs = 5000,
  maxEntries = 16,
} = {}) {
  if (typeof probe !== "function" || typeof now !== "function" ||
      !Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 300000 ||
      !Number.isSafeInteger(failureTtlMs) || failureTtlMs < 1 || failureTtlMs > 5000 ||
      !Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 16)
    throw Error("Invalid sandbox preflight cache bounds");
  const cache = new Map();
  return async function verify(key,{sandboxId}={}) {
    if (typeof key !== "string" || !key || key.length > 4096 || /[^\x21-\x7e]/.test(key))
      throw Error("Configure a valid single-line CODEGRAFF_API_KEY before claiming cloud jobs");
    validateSandboxAccessProbeId(sandboxId);
    // An explicit owned-resource probe neither falls back from list failure
    // nor shares authorization with another key/probe target.
    const fingerprint = createHash("sha256").update(key+'\0'+(sandboxId??'')).digest("hex");
    const timestamp = now();
    const existing = cache.get(fingerprint);
    if (existing?.pending) return existing.pending;
    if (existing && timestamp >= existing.checkedAt && timestamp < existing.expiresAt) {
      if (existing.error) throw existing.error;
      return existing.receipt;
    }
    const entry = {};
    // Eviction cannot invalidate an in-flight check's caller. It only prevents
    // unbounded retention across key rotations in this trusted process.
    cache.delete(fingerprint);
    if (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
    cache.set(fingerprint, entry);
    entry.pending = (async () => {
      try {
        await Promise.resolve().then(() => probe(key,{sandboxId}));
        entry.checkedAt = now();
        entry.expiresAt = entry.checkedAt + ttlMs;
        entry.receipt = { sandboxAccessVerified: true, checkedAt: entry.checkedAt, expiresAt: entry.expiresAt };
        return entry.receipt;
      } catch (error) {
        entry.checkedAt = now();
        entry.expiresAt = entry.checkedAt + failureTtlMs;
        entry.error = accessError(error);
        throw entry.error;
      } finally {
        delete entry.pending;
      }
    })();
    return entry.pending;
  };
}

export const verifySandboxAccess = createSandboxAccessPreflight();
