import { betterAuth } from "better-auth";
import { genericOAuth } from "better-auth/plugins";
import { settings, type Tokens, type User } from "./auth";

// Sign in with Codegraff, through Better Auth, with its tables in a D1
// database of the app's own (AUTH_DB). Codegraff is the only way in: the first
// sign-in makes the person's user row, later ones find it. Provider tokens are
// never stored in the tables; they go to the person's Account object, which
// refreshes them one at a time. OAuth state lives in a cookie, so a sign-in
// someone abandons leaves no row behind.

interface Vars {
  BETTER_AUTH_SECRET?: string;
  AUTH_DB?: D1Database;
}

const vars = (env: Env) => env as unknown as Vars;

/** Whether this deployment signs people in with Codegraff: it needs the
 *  client, a secret of its own, and the database. */
export function codegraffReady(env: Env, url: URL): boolean {
  const s = settings(env, url);
  return !!(s.clientId && s.clientSecret && vars(env).BETTER_AUTH_SECRET && vars(env).AUTH_DB);
}

// Better Auth's four tables and their indexes, as its own migration tool
// writes them for SQLite, made idempotent. Created on first use, so a fresh
// checkout needs no migration step.
const TABLES = [
  `create table if not exists "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null)`,
  `create table if not exists "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade)`,
  `create table if not exists "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null)`,
  `create table if not exists "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null)`,
  `create index if not exists "session_userId_idx" on "session" ("userId")`,
  `create index if not exists "account_userId_idx" on "account" ("userId")`,
  `create index if not exists "verification_identifier_idx" on "verification" ("identifier")`,
];

const created = new WeakMap<D1Database, Promise<unknown>>();
const instances = new Map<string, ReturnType<typeof build>>();

/** Better Auth for this origin, once its tables exist. One instance per
 *  origin, so its links and cookies match the address in use.
 *
 *  Registering Codegraff reads its discovery document, and Better Auth leaves
 *  the provider out for good when that read fails. Signing in needs it, so for
 *  that an instance without it is thrown away and built once more. Reading a
 *  session does not, and never waits on Codegraff. */
export async function codegraffAuth(env: Env, origin: string, signingIn = true, teams = false) {
  const db = vars(env).AUTH_DB!;
  let ready = created.get(db);
  if (!ready) {
    created.set(db, (ready = db.batch(TABLES.map((t) => db.prepare(t)))));
    ready.catch(() => created.delete(db));
  }
  await ready;
  const key = `${origin}:${teams ? "teams" : "default"}`;
  for (let attempt = 0; ; attempt++) {
    let auth = instances.get(key);
    if (!auth) instances.set(key, (auth = build(env, origin, teams)));
    if (!signingIn || attempt > 0) return auth;
    if ((await auth.$context).socialProviders.some((p) => p.id === "codegraff")) return auth;
    instances.delete(key);
  }
}

/** Who the Better Auth session cookie belongs to, if anyone. */
export async function sessionUser(env: Env, request: Request, url: URL): Promise<User | null> {
  // Agents and scripts send no session cookie: no need to wake Better Auth.
  if (!codegraffReady(env, url) || !request.headers.get("cookie")?.includes("swarm.session_token")) return null;
  const auth = await codegraffAuth(env, url.origin, false);
  const got = await auth.api.getSession({ headers: request.headers }).catch(() => null);
  if (!got) return null;
  const { id, name, email } = got.user;
  return { id: userId(id), name: name || email.split("@")[0] || "codegraff user", email, provider: "codegraff" };
}

/** The app's id for a person in the auth tables. Their Account object is named after it. */
export const userId = (authUserId: string) => `codegraff:${authUserId}`;

// Tokens taken off an account row during a sign-in, until the session it
// makes says whose they are. Keyed by the request's endpoint context.
const pending = new WeakMap<object, Tokens>();

function build(env: Env, origin: string, teams = false) {
  const v = vars(env);
  const s = settings(env, new URL(origin));
  return betterAuth({
    appName: "nanohub swarm",
    baseURL: origin,
    basePath: "/api/auth",
    secret: v.BETTER_AUTH_SECRET,
    trustedOrigins: [origin],
    database: v.AUTH_DB!,
    user: {
      validateUserInfo: ({ user: u, source }) =>
        source.oauth && u.emailVerified !== true ? { error: "email_not_verified", errorDescription: "Codegraff has not verified this email." } : undefined,
    },
    session: { expiresIn: 7 * 86_400, cookieCache: { enabled: true, maxAge: 300 } },
    account: { storeStateStrategy: "cookie" },
    emailAndPassword: { enabled: false },
    plugins: [
      genericOAuth({
        config: [
          {
            providerId: "codegraff",
            name: "Codegraff",
            discoveryUrl: `${s.issuer}/.well-known/openid-configuration`,
            clientId: s.clientId,
            clientSecret: s.clientSecret,
            scopes: [...new Set([...s.scopes.split(/\s+/).filter(Boolean), ...(teams ? ["rooms:read"] : [])])],
            redirectURI: `${origin}/api/auth/callback/codegraff`,
            pkce: true,
            requireIdTokenVerification: true,
          },
        ],
      }),
    ],
    databaseHooks: {
      account: {
        create: { before: async (row, ctx) => ({ data: withoutTokens(row, ctx) }) },
        update: { before: async (row, ctx) => ({ data: withoutTokens(row, ctx) }) },
      },
      session: {
        create: {
          after: async (row, ctx) => {
            const tokens = ctx ? pending.get(ctx) : undefined;
            if (!ctx || !tokens) return;
            pending.delete(ctx);
            await env.ACCOUNT.get(env.ACCOUNT.idFromName(userId(row.userId))).save(tokens);
          },
        },
      },
    },
    advanced: {
      cookiePrefix: "swarm",
      useSecureCookies: origin.startsWith("https:"),
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
  });
}

/** The row as written: the provider's tokens set aside for the person's
 *  Account object, never stored in the table. */
function withoutTokens<T extends Record<string, unknown>>(row: T, ctx: object | null): T {
  if (ctx && typeof row.accessToken === "string") {
    const expires = row.accessTokenExpiresAt instanceof Date ? row.accessTokenExpiresAt.getTime() : Date.now() + 3_600_000;
    pending.set(ctx, { access: row.accessToken, refresh: typeof row.refreshToken === "string" ? row.refreshToken : null, expires, scope: typeof row.scope === "string" ? row.scope : "" });
  }
  return { ...row, accessToken: null, refreshToken: null, idToken: null, accessTokenExpiresAt: null, refreshTokenExpiresAt: null };
}
