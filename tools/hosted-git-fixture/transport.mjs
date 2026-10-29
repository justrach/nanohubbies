import { createHash } from "node:crypto";
const paths = new Set(["/__fixture/health", "/__fixture/recovery", "/__fixture/repository",
  "/__fixture/repository-session", "/__fixture/purge", "/__fixture/purge-status"]);
const operations = new Set(["phase", "checkpoint", "schedule", "restart", "read", "inspect",
  "lose", "lose-inspect", "inventory", "object-get", "object-put", "object-delete",
  "database-state", "database-lose", "vault-recovery", "account-proof", "account-forget"]);
const bindings = new Set(["SEQUENCER", "AGENT", "ROOM", "DRIVER", "HUB", "IMPORT_JOB",
  "ACCOUNT", "LANE", "PACKER", "VAULTS", "OBJECTS", "AUTH_DB"]);
const codes = new Set(["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "ABORT_ERR"]);

/** No URL query, credential, body value or arbitrary upstream message escapes. */
export function fixtureTransportFailure(error, { method = "GET", path, body } = {}) {
  const verb = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(method) ? method : "OTHER";
  const route = paths.has(path) ? path : typeof path === "string" && path.startsWith("/git/") ? "Git" : "application";
  const context = [verb, route];
  for (const field of ["op", "operation"]) if (operations.has(body?.[field])) context.push(body[field]);
  if (bindings.has(body?.binding)) context.push(body.binding);
  if (typeof body?.id === "string" && /^[a-f0-9]{64}$/.test(body.id))
    context.push("object:" + createHash("sha256").update(body.id).digest("hex").slice(0, 16));
  let code = "unclassified", cursor = error;
  for (let depth = 0; depth < 4 && cursor; depth++, cursor = cursor.cause) {
    if (codes.has(cursor.code)) { code = cursor.code; break; }
    if (cursor.name === "TimeoutError" || cursor.name === "AbortError") { code = cursor.name; break; }
  }
  const failure = new Error("Fixture transport failed: " + context.join(" ") + " (" + code + ")", { cause: { code } });
  failure.name = "FixtureTransportError";
  return failure;
}
