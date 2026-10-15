// GitHub's REST API, read-only. Answers are kept for a minute, then
// revalidated with their ETag. With a token GitHub does not count a 304
// against the rate limit, so re-reading a pull request that has not changed
// is free; without one every revalidation still costs a request.

const FRESH_MS = 60_000;
const KEEP = 500;
const UA = { "User-Agent": "nanohub-swarm/0.1" };

const cache = new Map<string, { etag: string | null; body: unknown; at: number }>();

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Who GitHub is read as. A person's own token may see what others cannot,
 *  so what it reads is cached apart from everyone else's. */
export interface Reader {
  token: string | null;
  /** "public", or the id of the person whose token it is */
  cache: string;
}

/** The deployment's own token, when one is configured. Public repositories
 *  need none; one raises the rate limit from 60 requests an hour to 5,000. */
export function githubToken(env: Env): string | null {
  return (env as Env & { GITHUB_TOKEN?: string }).GITHUB_TOKEN || null;
}

/** GET a path under https://api.github.com. */
export async function gh<T>(path: string, reader: Reader): Promise<T> {
  const key = `${reader.cache} ${path}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.body as T;
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...UA };
  if (reader.token) headers.Authorization = `Bearer ${reader.token}`;
  if (hit?.etag) headers["If-None-Match"] = hit.etag;
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (res.status === 304 && hit) {
    hit.at = Date.now();
    return hit.body as T;
  }
  if (!res.ok) throw failure(res, path);
  const body = await res.json();
  cache.delete(key);
  cache.set(key, { etag: res.headers.get("etag"), body, at: Date.now() });
  if (cache.size > KEEP) cache.delete(cache.keys().next().value!);
  return body as T;
}

/** Every page of a list, up to `pages` pages of 100. */
export async function ghPages<T>(path: string, reader: Reader, pages: number): Promise<{ items: T[]; complete: boolean }> {
  const items: T[] = [];
  const sep = path.includes("?") ? "&" : "?";
  for (let page = 1; page <= pages; page++) {
    const batch = await gh<T[]>(`${path}${sep}per_page=100&page=${page}`, reader);
    items.push(...batch);
    if (batch.length < 100) return { items, complete: true };
  }
  return { items, complete: false };
}

function failure(res: Response, path: string): GitHubError {
  const what = path.split("?")[0];
  if ((res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0") {
    const reset = new Date(Number(res.headers.get("x-ratelimit-reset")) * 1000).toISOString().slice(11, 16);
    return new GitHubError(`GitHub's rate limit is used up until ${reset} UTC.`, 429);
  }
  if (res.status === 403) return new GitHubError(`GitHub did not allow reading ${what}`, 403);
  if (res.status === 404) return new GitHubError(`GitHub has no ${what}, or it is private`, 404);
  return new GitHubError(`GitHub answered HTTP ${res.status} for ${what}`, 502);
}
