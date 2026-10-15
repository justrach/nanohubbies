/** Who is asking. Sign in with Codegraff runs through Better Auth
 *  (./better-auth); its `github:read` scope also lets people import their
 *  GitHub repositories. Without it there is a development login, so the app
 *  runs with no accounts at all; its sessions are HMAC-signed cookies.
 *
 *  The provider's tokens never reach the browser: they live in the person's
 *  Account object, which refreshes them with `refreshTokens` below. */

export interface User {
  /** "codegraff:<local auth user ID>" or "dev:<name>": stable and unique across providers. */
  id: string;
  name: string;
  email: string | null;
  provider: "codegraff" | "dev";
}

interface Settings {
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  secret: string;
  dev: boolean;
}

interface Discovery {
  token_endpoint: string;
}

const SESSION = "swarm_session";
const SESSION_DAYS = 7;
const UA = { "User-Agent": "nanohub-swarm/0.1" };

/** Secrets come from `.dev.vars` locally and `wrangler secret` when deployed. */
export function settings(env: Env, url: URL): Settings {
  const v = env as unknown as Record<string, string | undefined>;
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  return {
    issuer: (v.OIDC_ISSUER || "https://codegraff.com").replace(/\/$/, ""),
    clientId: v.OIDC_CLIENT_ID ?? "",
    clientSecret: v.OIDC_CLIENT_SECRET ?? "",
    scopes: v.OIDC_SCOPES || "openid email profile offline_access github:read",
    // Without a configured secret, sessions are signed with a per-process key:
    // fine for local runs, and every restart signs everyone out.
    secret: v.SESSION_SECRET || processSecret(),
    // On localhost, whenever Sign in with Codegraff is not set up in full.
    dev: v.DEV_LOGIN === "1" || (local && !(v.OIDC_CLIENT_ID && v.BETTER_AUTH_SECRET)),
  };
}

// Made on first use: Workers allow no randomness at module scope.
let fallbackSecret: string | null = null;
const processSecret = () => (fallbackSecret ??= crypto.randomUUID() + crypto.randomUUID());

/** The development login's user, from its cookie. */
export async function currentUser(request: Request, s: Settings): Promise<User | null> {
  const raw = cookie(request, SESSION);
  const data = raw ? await unseal<User & { exp: number }>(raw, s.secret) : null;
  if (!data || data.exp < Date.now()) return null;
  return { id: data.id, name: data.name, email: data.email, provider: data.provider };
}

export async function sessionCookie(user: User, s: Settings, url: URL): Promise<string> {
  const value = await seal({ ...user, exp: Date.now() + SESSION_DAYS * 86_400_000 }, s.secret);
  return setCookie(SESSION, value, SESSION_DAYS * 86_400, url);
}

export function signOutCookie(url: URL): string {
  return setCookie(SESSION, "", 0, url);
}

export function devUser(name: string): User {
  const clean = name.trim().slice(0, 40) || "developer";
  return { id: `dev:${clean.toLowerCase().replace(/[^a-z0-9.-]+/g, "-")}`, name: clean, email: null, provider: "dev" };
}

export interface Tokens {
  access: string;
  refresh: string | null;
  /** ms since the epoch */
  expires: number;
  scope: string;
}

/** Trades a refresh token for new tokens. Codegraff rotates refresh tokens and
 *  treats reuse as theft, so callers must never run two of these at once. */
export async function refreshTokens(s: Settings, refresh: string): Promise<Tokens> {
  return tokenRequest(s, await discover(s.issuer), { grant_type: "refresh_token", refresh_token: refresh });
}

async function tokenRequest(s: Settings, d: Discovery, body: Record<string, string>): Promise<Tokens> {
  const res = await fetch(d.token_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${encodeURIComponent(s.clientId)}:${encodeURIComponent(s.clientSecret)}`)}`,
      ...UA,
    },
    body: new URLSearchParams(body),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string };
  if (!res.ok || !data.access_token) throw new Error(`token request failed: ${data.error_description ?? data.error ?? `HTTP ${res.status}`}`);
  return { access: data.access_token, refresh: data.refresh_token ?? null, expires: Date.now() + (data.expires_in ?? 3600) * 1000, scope: data.scope ?? "" };
}

const discovered = new Map<string, Promise<Discovery>>();

function discover(issuer: string): Promise<Discovery> {
  let d = discovered.get(issuer);
  if (!d) {
    d = fetch(`${issuer}/.well-known/openid-configuration`, { headers: UA }).then(async (res) => {
      if (!res.ok) throw new Error(`OpenID discovery failed for ${issuer} (HTTP ${res.status})`);
      return (await res.json()) as Discovery;
    });
    d.catch(() => discovered.delete(issuer));
    discovered.set(issuer, d);
  }
  return d;
}

/** A path on this site to send someone back to; anything else becomes "/". */
export const safeReturn = (to: string) => (to.startsWith("/") && !to.startsWith("//") ? to : "/");

// A sealed value is base64url(JSON) + "." + base64url(HMAC-SHA256 of it).
async function seal(data: unknown, secret: string): Promise<string> {
  const body = b64url(new TextEncoder().encode(JSON.stringify(data)));
  return `${body}.${b64url(new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(body))))}`;
}

async function unseal<T>(value: string, secret: string): Promise<T | null> {
  const [body, sig] = value.split(".");
  if (!body || !sig) return null;
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64url(sig), new TextEncoder().encode(body));
  if (!ok) return null;
  try {
    return JSON.parse(new TextDecoder().decode(fromB64url(body))) as T;
  } catch {
    return null;
  }
}

function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function cookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

function setCookie(name: string, value: string, maxAge: number, url: URL): string {
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
