import type { Owner } from "../types";
import { ownerEvidence } from "../team/access";
import { getMeta, setMeta } from "./store";

interface SocketIdentity {
  who: Owner | null;
  team?: { trunk: string; origin: string; ownerId: string; until: number };
}

/** Long-lived sockets must not retain the access they had when opened. */
export class RoomAccess {
  constructor(
    private env: Env,
    private sql: SqlStorage,
    private ctx: DurableObjectState,
  ) {}

  restrict(trunk: string) {
    setMeta(this.sql, "team_trunk", trunk);
    for (const ws of this.ctx.getWebSockets()) this.close(ws);
  }
  attachment(ws: WebSocket): SocketIdentity {
    const value = ws.deserializeAttachment() as SocketIdentity | Owner | null;
    // Old public sockets used an Owner directly.
    return value && "who" in value ? value : { who: value as Owner | null };
  }
  fromRequest(request: Request, who: Owner | null): SocketIdentity {
    const name = request.headers.get("X-Swarm-Trunk");
    if (name && /^[a-z0-9][a-z0-9-]{0,62}$/.test(name))
      setMeta(this.sql, "team_trunk", name);
    const raw = request.headers.get("X-Swarm-Team");
    if (!raw) return { who };
    const team = JSON.parse(raw) as NonNullable<SocketIdentity["team"]>;
    return { who, team: { ...team, until: Date.now() + 300_000 } };
  }
  async allowed(identity: SocketIdentity): Promise<boolean> {
    const trunk =
      getMeta<string>(this.sql, "team_trunk") ?? identity.team?.trunk;
    if (!trunk) return true;
    try {
      const binding = await this.env.HUB.get(
        this.env.HUB.idFromName("hub"),
      ).team(trunk);
      if (!binding) return true;
      if (
        !identity.team ||
        !identity.who ||
        identity.team.ownerId !== identity.who.id ||
        identity.team.trunk !== trunk ||
        identity.team.until <= Date.now()
      )
        return false;
      if (binding.kind === "owner") return identity.who.id === binding.boundBy;
      const evidence = await ownerEvidence(
        this.env,
        identity.team.origin,
        identity.who.id,
        [binding.roomId],
      );
      return (
        evidence.issuer === binding.issuer &&
        evidence.rooms.some((r) => r.id === binding.roomId)
      );
    } catch {
      return false;
    }
  }
  async check(ws: WebSocket): Promise<boolean> {
    const allowed = await this.allowed(this.attachment(ws));
    if (!allowed) this.close(ws);
    return allowed;
  }
  close(ws: WebSocket) {
    try {
      ws.close(4003, "Reconnect to verify current workspace access");
    } catch {
      /* already closed */
    }
  }
}
