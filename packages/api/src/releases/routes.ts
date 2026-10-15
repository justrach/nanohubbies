import { settings, type User } from "../auth";
import type { TeamAccess } from "../team/access";
import { storedBytes } from "./store";
import { publicRelease, releaseFields, RELEASE_MAX_BYTES, type Release } from "./types";

const LIMIT = 250 * 1024 * 1024;
const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
const catalog = (env: Env) => env.HUB.get(env.HUB.idFromName("hub"));
/** The cap on every release file of one workspace together (RELEASE_MAX_BYTES). */
const maxBytes = (env: Env) => Number((env as Env & { RELEASE_MAX_BYTES?: string }).RELEASE_MAX_BYTES) || RELEASE_MAX_BYTES;

/** This route intentionally bypasses Git access, and exposes published catalog data only. */
export async function publicReleases(env: Env, request: Request, trunk: string, releaseId?: string, assetId?: string) {
  if (!["GET", "HEAD"].includes(request.method)) return json({ error: "Method not allowed" }, 405);
  const releases = await catalog(env).releases({ op: "list", trunk, publicOnly: true });
  if (!releaseId) return json(releases.map(publicRelease));
  const release = releases.find((r) => r.id === releaseId);
  const asset = release?.assets.find((a) => a.id === assetId);
  if (!asset) return json({ error: "Release file not found" }, 404);
  const object = await env.OBJECTS.get(asset.key);
  if (!object) return json({ error: "Release file not found" }, 404);
  const name = encodeURIComponent(asset.name).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return new Response(request.method === "HEAD" ? null : object.body, { headers: { ...headers, "content-type": "application/octet-stream", "content-disposition": `attachment; filename="download"; filename*=UTF-8''${name}`, "content-length": String(asset.size) } });
}

/** Called after the ordinary workspace boundary. Only a human owner publishes. */
export async function releaseRoute(env: Env, request: Request, trunk: string, id: string | undefined, operation: string | undefined, user: User | null, access: TeamAccess | null) {
  const hub = catalog(env), workspace = await hub.find(trunk);
  if (!workspace) return json({ error: "Workspace not found" }, 404);
  const owner = !!user && workspace.owner === user.id && !request.headers.has("authorization") && (!access || !access.proof.agentId && access.proof.role === "owner");
  const all = () => hub.releases({ op: "list", trunk, publicOnly: !owner });
  // Only the owner sees drafts, source versions and where the files are kept.
  const answer = (releases: Release[]) => json({ releases: owner ? releases : releases.map(publicRelease), canManage: owner, sourcePrivate: !!access });
  if (request.method === "GET") return answer(await all());
  if (!owner) return json({ error: "Only the signed-in workspace owner can manage public releases" }, 403);
  const url = new URL(request.url), origin = request.headers.get("origin");
  const preview = origin && settings(env, url).dev && ["localhost", "127.0.0.1"].includes(url.hostname) && new URL(origin).hostname === url.hostname;
  if (origin && origin !== url.origin && !preview) return json({ error: "Same-origin request required" }, 403);
  try {
    if (request.method === "POST" && !id) {
      const raw = await request.text();
      if (raw.length > 20000) return json({ error: "Release details are too large" }, 413);
      const fields = releaseFields(JSON.parse(raw));
      const [head] = await env.SEQUENCER.get(env.SEQUENCER.idFromName(trunk)).heads(fields.version, 1);
      if (head?.version !== fields.version) return json({ error: "Source version is not published yet" }, 409);
      const release: Release = { ...fields, id: crypto.randomUUID(), trunk, commit: head.commit, state: "draft", created: Date.now(), published: null, assets: [] };
      return answer(await hub.releases({ op: "create", release }));
    }
    const releases = await all();
    const current = releases.find((r) => r.id === id);
    if (!current) return json({ error: "Release not found" }, 404);
    if (request.method === "DELETE" && !operation) {
      const remaining = await hub.releases({ op: "delete", trunk, id: current.id });
      if (current.assets.length) await env.OBJECTS.delete(current.assets.map((a) => a.key));
      return answer(remaining);
    }
    if (request.method === "POST" && operation === "assets") {
      const size = Number(request.headers.get("content-length"));
      const name = url.searchParams.get("name") ?? "";
      if (!Number.isSafeInteger(size) || size < 1 || size > LIMIT || !request.body) return json({ error: "Upload a file of 1 byte to 250 MB with its content length" }, 413);
      if (!name || name.length > 160 || /[\x00-\x1f\x7f/\\]/.test(name)) return json({ error: "Use a file name without folders or control characters" }, 400);
      if (current.state !== "draft") return json({ error: "Unpublish before attaching files" }, 409);
      // Checked again, atomically, once stored; this only spares a doomed upload.
      if (storedBytes(releases) + size > maxBytes(env)) return json({ error: `Release files in this workspace are limited to ${Math.floor(maxBytes(env) / 1024 / 1024)} MB in total` }, 413);
      const asset = { id: crypto.randomUUID(), name, size, key: `release-assets/${crypto.randomUUID()}` };
      await env.OBJECTS.put(asset.key, request.body, { httpMetadata: { contentType: "application/octet-stream" } });
      try { return answer(await hub.releases({ op: "asset", trunk, id: current.id, asset, maxBytes: maxBytes(env) })); }
      catch (e) { await env.OBJECTS.delete(asset.key); throw e; }
    }
    if (request.method === "POST" && ["publish", "unpublish"].includes(operation ?? "")) return answer(await hub.releases({ op: "publish", trunk, id: current.id, published: operation === "publish" }));
    return json({ error: "Method not allowed" }, 405);
  } catch (e) { return json({ error: (e as Error).message }, 400); }
}
