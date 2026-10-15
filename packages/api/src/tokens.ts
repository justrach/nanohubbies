import type { Owner } from "./types";
import { agentCredential, listAgentTokens, revokeAgentToken } from "./agent-credentials";

/** Push tokens: how an agent proves who it works for. A signed-in person makes
 *  one on a trunk's page, and git sends it as HTTP Basic credentials: the
 *  username names the agent, the token names the person. The remote URL holds
 *  only the username; a credential helper supplies the token (./connect).
 *  Tokens are shown once and kept only as SHA-256 hashes, in the app's D1
 *  database, made on first use. Clones and fetches of public trunks need none;
 *  pushes do. */

const DAYS = 30;
const PREFIX = "nhs_";
const AGENT = /^[A-Za-z0-9][\w.-]{0,63}$/;

const TABLE = `create table if not exists "push_token" ("id" text not null primary key, "hash" text not null unique, "ownerId" text not null, "ownerName" text not null, "label" text not null, "trunk" text, "createdAt" integer not null, "expiresAt" integer not null, "usedAt" integer, "revokedAt" integer)`;
const INDEX = `create index if not exists "push_token_owner_idx" on "push_token" ("ownerId")`;

const made = new WeakMap<D1Database, Promise<unknown>>();

function db(env: Env): D1Database {
  const d = (env as unknown as { AUTH_DB?: D1Database }).AUTH_DB;
  if (!d) throw new Error("push tokens need the AUTH_DB database");
  let ready = made.get(d);
  if (!ready) {
    made.set(d, (ready = d.batch([d.prepare(TABLE), d.prepare(INDEX)])));
    ready.catch(() => made.delete(d));
  }
  return d;
}

const ready = async (env: Env) => {
  const d = db(env);
  await made.get(d);
  return d;
};

async function hash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface TokenInfo {
  id: string;
  label: string;
  trunk: string | null;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
}

/** A new token for `owner`, valid on `trunk` (or every trunk) for 30 days.
 *  The token itself is returned once and never stored. */
export async function makeToken(env: Env, owner: Owner, label: string, trunk: string | null): Promise<TokenInfo & { token: string }> {
  const d = await ready(env);
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const token = PREFIX + btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const id = crypto.randomUUID();
  const now = Date.now();
  const info: TokenInfo = { id, label: label.slice(0, 64) || "agents", trunk, createdAt: now, expiresAt: now + DAYS * 86_400_000, usedAt: null };
  await d
    .prepare(`insert into "push_token" ("id", "hash", "ownerId", "ownerName", "label", "trunk", "createdAt", "expiresAt") values (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, await hash(token), owner.id, owner.name, info.label, trunk, now, info.expiresAt)
    .run();
  return { ...info, token };
}

/** The person's tokens that still work, newest first. */
export async function listTokens(env: Env, owner: Owner): Promise<TokenInfo[]> {
  const d = await ready(env);
  const { results } = await d
    .prepare(`select "id", "label", "trunk", "createdAt", "expiresAt", "usedAt" from "push_token" where "ownerId" = ? and "revokedAt" is null and "expiresAt" > ? order by "createdAt" desc limit 50`)
    .bind(owner.id, Date.now())
    .all<TokenInfo>();
  return [...results, ...await listAgentTokens(env, owner)].sort((a, b) => b.createdAt - a.createdAt);
}

export async function revokeToken(env: Env, owner: Owner, id: string): Promise<boolean> {
  const d = await ready(env);
  const r = await d.prepare(`update "push_token" set "revokedAt" = ? where "id" = ? and "ownerId" = ? and "revokedAt" is null`).bind(Date.now(), id, owner.id).run();
  return (r.meta.changes ?? 0) > 0 || await revokeAgentToken(env, owner, id);
}

/** Who a push comes from, by its Basic credentials: the person the token
 *  belongs to, and the agent the username names. Null when the credentials
 *  are missing, wrong, revoked, expired, or for another trunk. */
export async function pusher(env: Env, request: Request, trunk: string): Promise<{ owner: Owner; agent: string | null; agentId?: string; credentialId?: string } | null> {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Basic ")) return null;
  let user = "";
  let token = "";
  try {
    const plain = atob(header.slice(6));
    const colon = plain.indexOf(":");
    if (colon < 0) return null;
    user = decodeURIComponent(plain.slice(0, colon));
    token = plain.slice(colon + 1);
  } catch {
    return null;
  }
  if (token.startsWith("nha_")) return agentCredential(env, token, user, trunk);
  if (!token.startsWith(PREFIX)) return null;
  const d = await ready(env);
  const row = await d
    .prepare(`select "id", "ownerId", "ownerName", "trunk" from "push_token" where "hash" = ? and "revokedAt" is null and "expiresAt" > ?`)
    .bind(await hash(token), Date.now())
    .first<{ id: string; ownerId: string; ownerName: string; trunk: string | null }>();
  if (!row || (row.trunk && row.trunk !== trunk)) return null;
  await d.prepare(`update "push_token" set "usedAt" = ? where "id" = ?`).bind(Date.now(), row.id).run();
  return { owner: { id: row.ownerId, name: row.ownerName }, agent: AGENT.test(user) ? user : null };
}
