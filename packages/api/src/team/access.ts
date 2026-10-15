import { currentUser, settings, type User } from "../auth";
import { sessionUser } from "../better-auth";
import type { TrunkInfo } from "../hub";
import { pusher } from "../tokens";
import { linkedSubject, TeamError } from "./provider";
import type { IdentityProof, TeamBinding } from "./store";

export type TeamAccess = { binding: TeamBinding; proof: IdentityProof };
export async function userFor(
  env: Env,
  request: Request,
): Promise<User | null> {
  const url = new URL(request.url);
  return (
    (await sessionUser(env, request, url)) ??
    (await currentUser(request, settings(env, url)))
  );
}

export async function ownerEvidence(
  env: Env,
  origin: string,
  ownerId: string,
  roomIds: string[] | null,
  after = "",
) {
  const subject = await linkedSubject(env, ownerId);
  const result = await env.ACCOUNT.get(
    env.ACCOUNT.idFromName(ownerId),
  ).memberships(origin, subject, roomIds, after);
  if (result.error)
    throw new TeamError(result.error, result.status, result.code);
  if (!result.data)
    throw new TeamError("Codegraff membership could not be verified");
  return result.data;
}

/** Every protected request checks the current provider grant. No positive
 * membership cache, cookie claims, display names or legacy token fallback. */
export async function requireTeam(
  env: Env,
  request: Request,
  trunk: string,
  user?: User | null,
): Promise<TeamAccess | null> {
  const hub = env.HUB.get(env.HUB.idFromName("hub"));
  const binding = await hub.team(trunk);
  if (!binding) return null;
  const credential = request.headers.has("authorization")
    ? await pusher(env, request, trunk)
    : null;
  if (request.headers.has("authorization") && !credential?.agentId)
    throw new TeamError(
      "Use a registered agent's scoped credential",
      401,
      "agent_credential_required",
    );
  const who =
    credential?.owner ??
    (user === undefined ? await userFor(env, request) : user);
  if (!who)
    throw new TeamError(
      "Workspace not found or access unavailable",
      new URL(request.url).pathname.startsWith("/git/") ? 401 : 404,
      "not_found",
    );
  if (binding.kind === "owner") {
    if (who.id !== binding.boundBy)
      throw new TeamError("Workspace not found or access unavailable", 404, "not_found");
    // A local session or its bound agent credential proves ownership. This is
    // deliberately not represented as a Codegraff membership verification.
    return {
      binding,
      proof: {
        ownerId: who.id, subject: who.id, issuer: binding.issuer,
        audience: new URL(request.url).origin, roomId: "owner", role: "owner",
        agentId: credential?.agentId ?? null,
        credentialId: credential?.credentialId ?? null, verifiedAt: Date.now(),
      },
    };
  }
  const evidence = await ownerEvidence(
    env,
    new URL(request.url).origin,
    who.id,
    [binding.roomId],
  );
  const membership = evidence.rooms.find((r) => r.id === binding.roomId);
  if (!membership || evidence.issuer !== binding.issuer)
    throw new TeamError(
      "Workspace not found or access unavailable",
      404,
      "not_found",
    );
  const proof: IdentityProof = {
    ownerId: who.id,
    subject: evidence.subject,
    issuer: evidence.issuer,
    audience: evidence.audience,
    roomId: binding.roomId,
    role: membership.role,
    agentId: credential?.agentId ?? null,
    credentialId: credential?.credentialId ?? null,
    verifiedAt: evidence.checkedAt,
  };
  await hub.recordTeamProof(trunk, proof);
  return { binding, proof };
}

export async function visibleTrunks(
  env: Env,
  request: Request,
  entries: TrunkInfo[],
  user: User | null,
) {
  const hub = env.HUB.get(env.HUB.idFromName("hub"));
  const policies = await Promise.all(
    entries.map((entry) => hub.team(entry.name)),
  );
  const ids = [...new Set(policies.flatMap((p) => (p && p.kind !== "owner" ? [p.roomId] : [])))];
  let allowed = new Set<string>();
  if (ids.length && user?.provider === "codegraff") {
    // If proof cannot be obtained, omit protected entries. Never fall back to public.
    try {
      const evidence = await ownerEvidence(
        env,
        new URL(request.url).origin,
        user.id,
        ids,
      );
      allowed = new Set(
        evidence.rooms.map((r) => `${evidence.issuer}/${r.id}`),
      );
    } catch {
      /* Public entries remain available during provider outages. */
    }
  }
  return entries.filter(
    (_, i) =>
      !policies[i] || (policies[i]!.kind === "owner"
        ? policies[i]!.boundBy === user?.id
        : allowed.has(`${policies[i]!.issuer}/${policies[i]!.roomId}`)),
  );
}

export function privateResponse(response: Response) {
  if (response.status === 101) return response;
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Vary", "Cookie, Authorization");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
