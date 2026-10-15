import type { Room } from "../room";
import { makeAgentToken } from "../agent-credentials";
import type { Owner } from "../types";
import type { Presence } from "./registry";

interface Context {
  request: Request;
  env: Env;
  room: DurableObjectStub<Room>;
  trunk: string;
  name?: string;
  action?: string;
  user: Owner | null;
  credential: { owner: Owner; agent: string | null; agentId?: string } | null;
}
export async function coordination(c: Context): Promise<Response | null> {
  const { request, room, name, action, credential, user } = c;
  if (!name) {
    if (request.method === "GET") return Response.json(await room.roster());
    if (request.method === "POST") {
      if (!user)
        return Response.json(
          { error: "sign in to register an agent" },
          { status: 401 },
        );
      if (!(await c.env.HUB.get(c.env.HUB.idFromName("hub")).find(c.trunk)))
        return Response.json({ error: "no such trunk" }, { status: 404 });
      const { handle, type } = await request.json<{
        handle: string;
        type: string;
      }>();
      if (typeof handle !== "string" || typeof type !== "string")
        throw new Error("handle and type are required");
      if (!/^[a-z0-9][a-z0-9.-]{0,47}$/.test(handle))
        throw new Error("invalid registered handle");
      const existing = await room.registeredAgent(handle);
      if (!existing) {
        const legacy = await c.env.AGENT.get(
          c.env.AGENT.idFromName(`${c.trunk}/${handle}`),
        ).info();
        if (legacy.life > 0)
          throw new Error(
            "this handle is already in use by a legacy agent; choose a new handle",
          );
      }
      return Response.json(await room.registerAgent(user, handle, type), {
        status: 201,
      });
    }
    return null;
  }
  if (action === "token" && request.method === "POST") {
    const agent = await room.registeredAgent(name);
    if (!agent)
      return Response.json(
        { error: "register this handle first" },
        { status: 404 },
      );
    if (!user || user.id !== agent.owner.id)
      return Response.json(
        {
          error: "only the registered owner can issue this agent's credentials",
        },
        { status: 403 },
      );
    return Response.json(await makeAgentToken(c.env, agent, c.trunk), {
      status: 201,
    });
  }
  if (!["heartbeat", "inbox", "ack"].includes(action ?? "")) return null;
  if (
    !credential?.agentId ||
    credential.agent !== name ||
    !(await room.agentAllowed(name, credential.agentId))
  )
    return Response.json(
      { error: "use this registered agent's scoped credential" },
      { status: 403 },
    );
  if (action === "heartbeat" && request.method === "POST") {
    const {
      status = "idle",
      task = "",
      progress = "",
    } = await request.json<{
      status?: Presence;
      task?: string;
      progress?: string;
    }>();
    return Response.json(
      await room.agentHeartbeat(name, status, task, progress),
    );
  }
  if (action === "inbox" && request.method === "GET") {
    const raw = new URL(request.url).searchParams.get("after") ?? "0";
    const after = Number(raw);
    if (!Number.isSafeInteger(after) || after < 0)
      throw new Error("after must be a nonnegative message cursor");
    const page = await room.messages(after, name, 101);
    const messages = page.slice(0, 100);
    const last = messages.at(-1);
    return Response.json({
      messages,
      nextCursor: last?.t === "message" ? last.id : after,
      hasMore: page.length > 100,
    });
  }
  if (action === "ack" && request.method === "POST") {
    const { id } = await request.json<{ id: number }>();
    return Response.json(await room.acknowledgeMessage(id, name));
  }
  return null;
}
