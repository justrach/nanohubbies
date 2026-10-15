import type { User } from "../auth";
import { ownerEvidence, type TeamAccess } from "./access";
import { ROOM_ID, TeamError } from "./provider";

/** Only a human workspace creator who also owns the selected Codegraff room
 * can make this boundary. It cannot subsequently be relaxed through the API. */
export async function teamRoute(
  env: Env,
  request: Request,
  trunk: string,
  user: User | null,
  access: TeamAccess | null,
) {
  const hub = env.HUB.get(env.HUB.idFromName("hub"));
  const entry = await hub.find(trunk);
  if (!entry) throw new TeamError("Workspace not found", 404, "not_found");
  if (request.method === "GET")
    return Response.json({
      team: access?.binding ?? null,
      canConnect:
        (!access || access.binding.kind === "owner") &&
        !!user &&
        user.provider === "codegraff" &&
        entry.owner === user.id,
      verification: access
        ? {
            method: access.binding.kind === "owner"
              ? access.proof.agentId ? "owner_session_and_agent_credential" : "owner_session"
              : access.proof.agentId
              ? "codegraff_membership_and_agent_credential"
              : "codegraff_membership_and_session",
            verifiedAt: access.proof.verifiedAt,
            role: access.proof.role,
            agentId: access.proof.agentId,
          }
        : null,
    });
  if (request.method !== "POST")
    return Response.json({ error: "method not allowed" }, { status: 405 });
  if (
    !user ||
    user.provider !== "codegraff" ||
    entry.owner !== user.id ||
    request.headers.has("authorization")
  )
    throw new TeamError(
      "Only the signed-in workspace creator can connect a team",
      403,
      "owner_required",
    );
  // This creates a new authorization boundary, so require the browser's origin.
  if (request.headers.get("origin") !== new URL(request.url).origin)
    throw new TeamError("Same-origin request required", 403, "origin_required");
  const { roomId } = await request.json<{ roomId: string }>();
  if (typeof roomId !== "string" || !ROOM_ID.test(roomId))
    throw new TeamError("Choose a Codegraff room", 400, "invalid_room");
  const evidence = await ownerEvidence(
    env,
    new URL(request.url).origin,
    user.id,
    [roomId],
  );
  const membership = evidence.rooms.find(
    (r) => r.id === roomId && r.role === "owner",
  );
  if (!membership)
    throw new TeamError(
      "You must be an accepted owner of this Codegraff room",
      403,
      "owner_required",
    );
  const room = env.ROOM.get(env.ROOM.idFromName(trunk));
  await room.stopSwarm(trunk, null);
  await room.restrictTeam(trunk);
  const team = await hub.bindTeam(trunk, user.id, {
    roomId,
    name: membership.name,
    issuer: evidence.issuer,
    boundBy: user.id,
    boundAt: Date.now(),
  });
  return Response.json({
    team,
    canConnect: false,
    verification: {
      method: "codegraff_membership_and_session",
      verifiedAt: evidence.checkedAt,
      role: membership.role,
      agentId: null,
    },
  });
}

export async function discoverTeams(
  env: Env,
  request: Request,
  user: User | null,
) {
  if (!user || user.provider !== "codegraff")
    throw new TeamError(
      "Sign in with Codegraff to choose a team",
      401,
      "codegraff_required",
    );
  const url = new URL(request.url);
  const after = url.searchParams.get("after") ?? "";
  if (after && !ROOM_ID.test(after))
    throw new TeamError("Invalid room cursor", 400, "invalid_cursor");
  const evidence = await ownerEvidence(env, url.origin, user.id, null, after);
  return Response.json({
    rooms: evidence.rooms,
    nextCursor: evidence.nextCursor,
  });
}
