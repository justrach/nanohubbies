import type { User } from "../auth";
import { canAdmin, sameOrigin, type TeamAccess } from "../team/access";
import { hashToken, type RepoRole } from "./store";
import {cliCollaborators} from './cli-route';

export async function acceptInvitation(
  env: Env,
  request: Request,
  user: User | null,
) {
  if (
    request.method !== "POST" ||
    !user ||
    request.headers.has("authorization") ||
    !sameOrigin(env, request)
  )
    return Response.json(
      { error: "Sign in and accept from this site" },
      { status: 403 },
    );
  const { trunk, token } = await request.json<{
    trunk: string;
    token: string;
  }>();
  if (
    !/^[a-z0-9][a-z0-9-]{0,62}$/.test(trunk) ||
    typeof token !== "string" ||
    !/^nhi_[a-f0-9]{64}$/.test(token)
  )
    throw new Error("Invalid invitation");
  return Response.json(
    await env.HUB.get(env.HUB.idFromName("hub")).acceptInvitation(
      trunk,
      user.id,
      await hashToken(token),
    ),
  );
}
export async function collaboratorRoute(
  env: Env,
  request: Request,
  trunk: string,
  id: string | undefined,
  user: User | null,
  access: TeamAccess | null,
) {
  if(user?.cli)return cliCollaborators(env,request,trunk,id,user,access);
  const hub = env.HUB.get(env.HUB.idFromName("hub"));
  if (access?.binding.kind !== "owner")
    return Response.json({
      managedExternally: true,
      canManage: false,
      members: [],
      invitations: [],
    });
  const allowed =
    !!user && !request.headers.has("authorization") && canAdmin(access);
  if (request.method === "GET")
    return Response.json({
      ...(await hub.collaborators(trunk)),
      canManage: allowed,
      currentRole: access.proof.role,
    });
  if (!allowed || !sameOrigin(env, request))
    return Response.json(
      { error: "A signed-in repository owner or admin is required" },
      { status: 403 },
    );
  if (request.method === "POST" && !id) {
    const { userId, role } = await request.json<{
      userId: string;
      role: RepoRole;
    }>();
    const token =
      "nhi_" +
      Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
    const invitation = await hub.inviteCollaborator(
      trunk,
      user!.id,
      userId,
      role,
      await hashToken(token),
    );
    return Response.json({ ...invitation, token }, { status: 201 });
  }
  if (request.method === "DELETE" && id) {
    await hub.cancelInvitation(trunk, user!.id, id);
    return Response.json({ cancelled: true });
  }
  if (request.method === "PATCH") {
    const { userId, role } = await request.json<{
      userId: string;
      role: RepoRole | null;
    }>();
    await hub.changeCollaborator(trunk, user!.id, userId, role);
    return Response.json({ updated: true });
  }
  return Response.json({ error: "Method not supported" }, { status: 405 });
}
