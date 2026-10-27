import { ownerEvidence } from "../team/access";

/** Recheck write membership immediately before the sequencer's dismissal.
 * A signed-in identity is necessary; an allowlist never grants repository access. */
export async function reviewWriter(env: Env, trunk: string, origin: string, account: string) {
  const hub=env.HUB.get(env.HUB.idFromName("hub")),binding=await hub.team(trunk);
  if (!binding) return (await hub.find(trunk))?.owner === account;
  if (binding.kind === "owner") {
    const role=await hub.collaboratorRole(trunk,account);
    return !!role && role !== "reader";
  }
  const evidence=await ownerEvidence(env,origin,account,[binding.roomId]);
  const membership=evidence.rooms.find(room=>room.id===binding.roomId);
  return evidence.issuer===binding.issuer && !!membership;
}
