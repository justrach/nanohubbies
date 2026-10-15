/** Only resolved, immutable repository content belongs here. Callers must
 * authorize each request and resolve versions before looking in this cache. */
interface Store {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options: { expirationTtl: number }): Promise<void>;
}
type Lifetime = { waitUntil(promise: Promise<unknown>): void };
const MAX_ENTRY = 1024 * 1024;
const MAX_BYTES = 8 * MAX_ENTRY;
const TTL = 86400;
const memory = new Map<string, { body: string; bytes: number; expires: number }>();
let used = 0;

function keep(key: string, body: string): void {
  const bytes = new TextEncoder().encode(body).length;
  if (bytes > MAX_ENTRY) return;
  const old = memory.get(key);
  if (old) used -= old.bytes;
  memory.delete(key);
  memory.set(key, { body, bytes, expires: Date.now() + TTL * 1000 });
  used += bytes;
  while (used > MAX_BYTES) {
    const [first, value] = memory.entries().next().value!;
    memory.delete(first);
    used -= value.bytes;
  }
}

async function keyFor(parts: unknown[]): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(parts)));
  return `browse:v1:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** KV is optional and best-effort. A slow/unavailable cache never prevents an
 * authoritative read. Keep only settled data across Workers requests. */
export async function cached<T>(store: Store | undefined, parts: unknown[], load: () => Promise<T>, ctx?: Lifetime): Promise<{ value: T; source: string }> {
  const key = await keyFor(parts);
  const held = memory.get(key);
  if (held && held.expires > Date.now()) {
    memory.delete(key);
    memory.set(key, held);
    return { value: JSON.parse(held.body), source: "memory" };
  }
  if (held) { memory.delete(key); used -= held.bytes; }
  if (store) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const body = await Promise.race([
        store.get(key),
        new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 75); }),
      ]);
      if (body !== null) {
        const value = JSON.parse(body) as T;
        keep(key, body);
        return { value, source: "kv" };
      }
    } catch { /* An unavailable/corrupt cache is a miss. */ }
    finally { if (timer !== undefined) clearTimeout(timer); }
  }
  const value = await load(); // Never cache errors, missing versions or denials.
  const body = JSON.stringify(value);
  if (new TextEncoder().encode(body).length <= MAX_ENTRY) {
    keep(key, body);
    if (store) {
      const write = store.put(key, body, { expirationTtl: TTL }).catch(() => {});
      if (ctx) ctx.waitUntil(write);
      else await write;
    }
  }
  return { value, source: "miss" };
}

export function cachedResponse(result: { value: unknown; source: string }): Response {
  return Response.json(result.value, { headers: { "X-Browse-Cache": result.source, "Cache-Control": "private, no-store" } });
}
