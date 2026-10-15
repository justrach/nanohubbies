import { DurableObject } from "cloudflare:workers";
import { refreshTokens, settings, type Tokens } from "./auth";

import { fetchMemberships, TeamError } from "./team/provider";

const CODEGRAFF = "https://codegraff.com";
const UA = { "User-Agent": "nanohub-swarm/0.1" };

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  account_login: string;
}

/** GitHub as connected to someone's Codegraff account: a token to read with,
 *  where to go to connect it, or why neither could be had. */
export type GitHubReader = { token: string; login: string } | { connect: string } | { error: string };

/** One person's provider tokens. Refresh tokens are single-use and rotate:
 *  presenting one twice revokes the whole family. A Durable Object runs one
 *  thing at a time, so routing every refresh through here makes it
 *  single-flight per person. */
export class Account extends DurableObject<Env> {
  private refreshing: Promise<string> | null = null;
  private reader: { token: string; login: string; until: number } | null = null;
  private minting: Promise<GitHubReader> | null = null;

  async save(tokens: Tokens) {
    await this.ctx.storage.put("tokens", tokens);
  }

  async forget() {
    this.reader = null;
    await this.ctx.storage.deleteAll();
  }

  /** A valid access token, refreshed when it is about to expire. */
  async accessToken(origin: string): Promise<string> {
    const t = await this.ctx.storage.get<Tokens>("tokens");
    if (!t) throw new Error("sign in with Codegraff first");
    if (t.expires - Date.now() > 60_000) return t.access;
    if (!t.refresh) throw new Error("your Codegraff session expired; sign in again");
    this.refreshing ??= refreshTokens(settings(this.env, new URL(origin)), t.refresh)
      .then(async (next) => {
        // Keep the old refresh token only if the provider did not send a new one.
        await this.save({ ...next, refresh: next.refresh ?? t.refresh });
        return next.access;
      })
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }

  /** Fresh provider evidence; never reuse a previous membership decision. */
  async memberships(origin: string, subject: string, ids: string[] | null, after = "") {
    try {
      return { data: await fetchMemberships(this.env, origin, await this.accessToken(origin), subject, ids, after) };
    } catch (error) {
      return error instanceof TeamError
        ? { error: error.message, status: error.status, code: error.code }
        : { error: "Reconnect Codegraff to verify your team membership", status: 403, code: "team_consent_required" };
    }
  }

  /** The GitHub repositories the person connected to Codegraff. */
  async githubRepos(origin: string): Promise<GitHubRepo[]> {
    const res = await fetch(`${CODEGRAFF}/api/oauth/github/repos`, { headers: { Authorization: `Bearer ${await this.accessToken(origin)}`, ...UA } });
    const data = (await res.json().catch(() => ({}))) as { repos?: GitHubRepo[]; error?: string; connect?: string };
    if (data.connect) throw new Error(`connect GitHub on Codegraff first: ${data.connect}`);
    if (!res.ok) throw new Error(`Codegraff could not list your repositories (HTTP ${res.status})`);
    return data.repos ?? [];
  }

  /** A read-only GitHub token for everything the person connected, to read
   *  pull requests with their own rate limit. Kept in memory, never stored,
   *  until five minutes before GitHub expires it. Without GitHub connected,
   *  where to connect it: on Codegraff, so it counts there and here alike. */
  async githubReader(origin: string): Promise<GitHubReader> {
    if (this.reader && this.reader.until > Date.now()) return { token: this.reader.token, login: this.reader.login };
    this.minting ??= this.mintReader(origin).finally(() => {
      this.minting = null;
    });
    return this.minting;
  }

  private async mintReader(origin: string): Promise<GitHubReader> {
    try {
      const res = await fetch(`${CODEGRAFF}/api/oauth/github/mint-token`, {
        method: "POST",
        headers: { Authorization: `Bearer ${await this.accessToken(origin)}`, "Content-Type": "application/json", ...UA },
        body: "{}",
      });
      const data = (await res.json().catch(() => ({}))) as { token?: string; expires_at?: string; account_login?: string; error?: string; connect?: string };
      // It becomes a link on the page, so only ever an https one.
      if (data.connect) return { connect: data.connect.startsWith("https://") ? data.connect : `${CODEGRAFF}/dashboard` };
      if (!res.ok || !data.token) return { error: data.error ?? `HTTP ${res.status}` };
      const expires = Date.parse(data.expires_at ?? "") || Date.now() + 3_600_000;
      this.reader = { token: data.token, login: data.account_login ?? "", until: expires - 300_000 };
      return { token: data.token, login: this.reader.login };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** A short-lived, read-only GitHub token for some of those repositories.
   *  Used once to download, never stored. */
  async githubToken(origin: string, repos: string[], context = false): Promise<string> {
    const res = await fetch(`${CODEGRAFF}/api/oauth/github/mint-token`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await this.accessToken(origin)}`, "Content-Type": "application/json", ...UA },
      body: JSON.stringify({ repositories: repos.slice(0, 50), context }),
    });
    const data = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
    if (!res.ok || !data.token) {
      // The provider can wrap GitHub's 422 inside its own 500. Do not show
      // raw upstream JSON or turn this into an anonymous "sign in" error.
      if (res.status === 422 || /mintInstallationToken failed 422/.test(data.error ?? "")) {
        throw new Error("GitHub refused access to this repository for the connected installation. Check its repository access in your Codegraff GitHub connection.");
      }
      if (res.status === 401) throw new Error("Your Codegraff GitHub connection expired. Reconnect it and try again.");
      throw new Error(`Codegraff could not provide GitHub repository access (HTTP ${res.status}). Try again or check your GitHub connection.`);
    }
    return data.token;
  }
}
