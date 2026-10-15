import { createHash } from "node:crypto";
import type { ChangeRequest } from "./types";

/** Stable across JSON property order and RPC/JSON byte representations. Array
 *  order is significant: changing the order of edits changes the request. */
export function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function canonical(value: unknown): unknown {
  if (value instanceof Uint8Array) return Array.from(value);
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)]));
  }
  return value;
}

export function encodeRequest(request: ChangeRequest): string {
  return JSON.stringify({ ...request, pushed: request.pushed ? { ...request.pushed, body: Array.from(request.pushed.body) } : null });
}

export function decodeRequest(raw: string): ChangeRequest {
  const request = JSON.parse(raw);
  if (request.pushed) request.pushed.body = new Uint8Array(request.pushed.body);
  return request;
}
