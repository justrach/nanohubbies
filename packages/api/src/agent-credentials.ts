import type { RegisteredAgent } from "./room/registry";
import type { TokenInfo } from "./tokens";
import type { Owner } from "./types";

const prepared = new WeakMap<D1Database, Promise<unknown>>();
async function db(env: Env) {
  const d = env.AUTH_DB;
  if (!prepared.has(d)) {
    const ready = d
      .prepare(
        `CREATE TABLE IF NOT EXISTS agent_token (
    id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, ownerId TEXT NOT NULL, ownerName TEXT NOT NULL,
    agentId TEXT NOT NULL, handle TEXT NOT NULL, trunk TEXT NOT NULL,
    createdAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL, usedAt INTEGER, revokedAt INTEGER
    )`,
      )
      .run();
    prepared.set(d, ready);
    ready.catch(() => prepared.delete(d));
  }
  await prepared.get(d);
  return d;
}
async function hash(token: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export async function makeAgentToken(
  env: Env,
  agent: RegisteredAgent,
  trunk: string,
): Promise<TokenInfo & { token: string; agentId: string; handle: string }> {
  const d = await db(env);
  const token =
    "nha_" +
    [...crypto.getRandomValues(new Uint8Array(24))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  const info = {
    id: crypto.randomUUID(),
    label: agent.handle,
    agentId: agent.id,
    handle: agent.handle,
    trunk,
    createdAt: Date.now(),
    expiresAt: Date.now() + 30 * 86_400_000,
    usedAt: null,
  };
  await d
    .prepare(
      "INSERT INTO agent_token (id, hash, ownerId, ownerName, agentId, handle, trunk, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      info.id,
      await hash(token),
      agent.owner.id,
      agent.owner.name,
      agent.id,
      agent.handle,
      trunk,
      info.createdAt,
      info.expiresAt,
    )
    .run();
  return { ...info, token };
}
export async function listAgentTokens(
  env: Env,
  owner: Owner,
): Promise<TokenInfo[]> {
  return (
    await (await db(env))
      .prepare(
        "SELECT id, handle AS label, agentId, handle, trunk, createdAt, expiresAt, usedAt FROM agent_token WHERE ownerId = ? AND revokedAt IS NULL AND expiresAt > ? ORDER BY createdAt DESC LIMIT 50",
      )
      .bind(owner.id, Date.now())
      .all<TokenInfo>()
  ).results;
}
export async function revokeAgentToken(env: Env, owner: Owner, id: string) {
  const result = await (await db(env))
    .prepare(
      "UPDATE agent_token SET revokedAt = ? WHERE id = ? AND ownerId = ? AND revokedAt IS NULL",
    )
    .bind(Date.now(), id, owner.id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}
export async function agentCredential(
  env: Env,
  token: string,
  username: string,
  trunk: string,
) {
  const d = await db(env);
  const row = await d
    .prepare(
      "SELECT id, ownerId, ownerName, agentId, handle, trunk FROM agent_token WHERE hash = ? AND revokedAt IS NULL AND expiresAt > ?",
    )
    .bind(await hash(token), Date.now())
    .first<{
      id: string;
      ownerId: string;
      ownerName: string;
      agentId: string;
      handle: string;
      trunk: string;
    }>();
  if (!row || row.trunk !== trunk || username !== row.handle) return null;
  const registered = await env.ROOM.get(
    env.ROOM.idFromName(trunk),
  ).registeredAgent(row.handle);
  if (
    !registered ||
    registered.id !== row.agentId ||
    registered.owner.id !== row.ownerId
  )
    return null;
  await d
    .prepare("UPDATE agent_token SET usedAt = ? WHERE id = ?")
    .bind(Date.now(), row.id)
    .run();
  return {
    owner: { id: row.ownerId, name: row.ownerName },
    agent: row.handle,
    agentId: row.agentId,
    credentialId: row.id,
  };
}
