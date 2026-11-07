import { settings, type User } from "../auth";
import type { TeamAccess } from "../team/access";
import type { Report } from "../sequencer/validation";

/** Routes for validated stable (../sequencer/validation, docs/validated-stable.md):
 *
 *   GET  /api/trunks/:t/validation           stable, the check command, recent claims and results
 *   POST /api/trunks/:t/validation           {command | null}: the signed-in human owner sets or clears the check
 *   POST /api/trunks/:t/validation/claim     {runner}: the isolated runner takes the newest unchecked version
 *   POST /api/trunks/:t/validation/report    {claim, version, commit, tree, passed, exitCode, log}
 *
 * Claim and report need `Authorization: Bearer <VALIDATOR_TOKEN>`, a Worker
 * secret held only by the runner host. Without the secret they answer 503, so
 * a deployment that never set one can never move stable. */
const headers = { "cache-control": "no-store" };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers });

type Env2 = Env & { VALIDATOR_TOKEN?: string };

async function same(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i];
  return diff === 0;
}

/** True for a runner request carrying the configured validator secret. */
export async function validatorAllowed(env: Env, request: Request): Promise<Response | null> {
  const secret = (env as Env2).VALIDATOR_TOKEN;
  if (!secret || secret.length < 24) return json({ error: "validation runner is not configured on this deployment (VALIDATOR_TOKEN)" }, 503);
  const got = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  if (!got || !await same(got, secret)) return json({ error: "validator credential required" }, 401);
  return null;
}

/** Runner calls, before the workspace's ordinary (cookie or agent) boundary. */
export async function validationRunnerRoute(env: Env, request: Request, trunk: string, op: string): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const refused = await validatorAllowed(env, request);
  if (refused) return refused;
  const hub = env.HUB.get(env.HUB.idFromName("hub"));
  if (!await hub.find(trunk)) return json({ error: "Workspace not found" }, 404);
  // Team workspaces clone only with a member's credential; the runner has none.
  if (await hub.team(trunk)) return json({ error: "validated stable is not available for team workspaces yet" }, 409);
  const raw = await request.text();
  if (raw.length > 20000) return json({ error: "report is too large" }, 413);
  const body = raw ? JSON.parse(raw) : {};
  const seq = env.SEQUENCER.get(env.SEQUENCER.idFromName(trunk));
  if (op === "claim") return json({ claim: await seq.validationClaim(String(body.runner ?? "runner")) });
  const out = await seq.validationReport(body as Report);
  if ("error" in out) return json({ error: out.error }, out.status);
  return json(out);
}

/** Status for anyone who can read the workspace; configuration for its human owner. */
export async function validationRoute(env: Env, request: Request, trunk: string, user: User | null, access: TeamAccess | null): Promise<Response> {
  const seq = env.SEQUENCER.get(env.SEQUENCER.idFromName(trunk));
  if (request.method === "GET") return json(await seq.validationStatus());
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const workspace = await env.HUB.get(env.HUB.idFromName("hub")).find(trunk);
  if (!workspace) return json({ error: "Workspace not found" }, 404);
  const owner = !!user && workspace.owner === user.id && !request.headers.has("authorization") && (!access || !access.proof.agentId && access.proof.role === "owner");
  if (!owner) return json({ error: "Only the signed-in workspace owner can configure validation" }, 403);
  const url = new URL(request.url), origin = request.headers.get("origin");
  const preview = origin && settings(env, url).dev && ["localhost", "127.0.0.1"].includes(url.hostname) && new URL(origin).hostname === url.hostname;
  if (origin && origin !== url.origin && !preview) return json({ error: "Same-origin request required" }, 403);
  const body = await request.json<{ command?: unknown }>();
  try {
    const config = await seq.validationConfigure(body.command === null ? null : String(body.command ?? ""));
    return json({ config, status: await seq.validationStatus() });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
}
