import type { Issue, RepoInfo } from "./types";

import { readArchive, type Imported } from "./import/archive";
export type { Imported } from "./import/archive";
const UA = { "User-Agent": "nanohub-swarm/0.1" };

/** `token` is a read-only GitHub token for private repositories; public ones
 *  need none. Without one the archive comes from github.com rather than the
 *  API, whose limit for callers without a token is per address, and a
 *  Worker's address is shared. Both carry the commit they were cut from. */
export async function importGitHub(owner: string, repo: string, ref: string | null, token: string | null, maxTextBytes?: number, onFile?: Parameters<typeof readArchive>[2]): Promise<Imported> {
  const at = ref ? ref.split("/").map(encodeURIComponent).join("/") : "HEAD";
  const url = token
    ? `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tarball${ref ? `/${at}` : ""}`
    : `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/archive/${at}.tar.gz`;
  const res = await fetch(url, {
    headers: { Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...UA },
    redirect: "follow",
    signal: AbortSignal.timeout(120_000),
  });
  if (res.status === 404) throw new Error(`${owner}/${repo} was not found${token ? "" : ", or it is private: sign in with Codegraff to import private repositories"}`);
  if (!res.ok || !res.body) throw new Error(`GitHub refused the download (HTTP ${res.status})`);
  return readArchive(res.body.pipeThrough(new DecompressionStream("gzip")), maxTextBytes, onFile);
}

type IssueSeed = Omit<Issue, "state" | "landed" | "agents" | "closedBy" | "closedIn" | "heldBy">;

/** The repository around the code: description, issues, open pull requests.
 *  Each part is fetched on its own; one that fails (a private repository whose
 *  token cannot read issues, a rate limit) is left out rather than failing the
 *  import. */
export async function importGitHubContext(owner: string, repo: string, token: string | null): Promise<{ repo: RepoInfo; issues: IssueSeed[]; notes: string[] }> {
  const notes: string[] = [];
  const get = async <T>(path: string, pagination?: { more: boolean }): Promise<T | null> => {
    const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...UA,
      },
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    if (!res) {
      notes.push(`${path || "repository"}: GitHub context could not be reached`);
      return null;
    }
    if (!res.ok) {
      notes.push(`${path || "repository"}: HTTP ${res.status}`);
      return null;
    }
    if (pagination) pagination.more = !!res.headers.get("Link")?.includes('rel="next"');
    return (await res.json().catch(() => {
      notes.push(`${path || "repository"}: GitHub returned unreadable context`);
      return null;
    })) as T | null;
  };
  // Follow page numbers on the same repository endpoint; never forward a token
  // to a URL supplied by a response header. Bound unusually large repositories.
  const pages = async <T>(path: string): Promise<T[]> => {
    const result: T[] = [];
    for (let page = 1; page <= 50; page++) {
      const pagination = { more: false };
      const rows = await get<T[]>(`${path}&per_page=100&page=${page}`, pagination);
      if (!rows) break;
      if (!Array.isArray(rows)) {
        notes.push(`${path}: GitHub returned unreadable context`);
        break;
      }
      result.push(...rows);
      if (!pagination.more) return result;
    }
    if (result.length >= 5000)
      notes.push(`${path}: more results are available on GitHub; this workspace contains the first 5000 results`);
    return result;
  };
  type GhIssue = {
    number: number;
    title: string;
    body: string | null;
    state: "open" | "closed";
    labels: ({ name: string; color: string } | string)[];
    user: { login: string } | null;
    created_at: string;
    comments: number;
    html_url: string;
    pull_request?: unknown;
  };
  type GhPull = { number: number; title: string; user: { login: string } | null; head: { ref: string }; draft: boolean; html_url: string; created_at: string };
  const [meta, open, closed, pulls] = await Promise.all([
    get<{ full_name: string; description: string | null; html_url: string; stargazers_count: number; topics?: string[]; license: { spdx_id: string } | null; default_branch: string }>(""),
    pages<GhIssue>("/issues?state=open"),
    pages<GhIssue>("/issues?state=closed&sort=updated"),
    pages<GhPull>("/pulls?state=open"),
  ]);
  const issues = [...(open ?? []), ...(closed ?? [])]
    // GitHub lists pull requests among issues; they are shown separately.
    .filter((i) => !i.pull_request)
    .map(
      (i): IssueSeed => ({
        number: i.number,
        title: i.title,
        body: (i.body ?? "").slice(0, 20_000),
        origin: "github",
        upstream: i.state,
        labels: i.labels.map((l) => (typeof l === "string" ? { name: l, color: "888888" } : { name: l.name, color: l.color })),
        author: i.user?.login ?? "ghost",
        created: Date.parse(i.created_at),
        comments: i.comments,
        url: i.html_url,
      }),
    );
  return {
    repo: {
      fullName: meta?.full_name ?? `${owner}/${repo}`,
      description: meta?.description ?? null,
      url: meta?.html_url ?? `https://github.com/${owner}/${repo}`,
      stars: meta?.stargazers_count ?? 0,
      topics: meta?.topics ?? [],
      license: meta?.license?.spdx_id ?? null,
      defaultBranch: meta?.default_branch ?? (await headBranch(owner, repo, token)) ?? "main",
      commit: null,
      pulls: (pulls ?? []).map((p) => ({
        number: p.number,
        title: p.title,
        author: p.user?.login ?? "ghost",
        branch: p.head.ref,
        draft: p.draft,
        url: p.html_url,
        created: Date.parse(p.created_at),
      })),
    },
    issues,
    notes,
  };
}

/** The branch HEAD names, from git's own protocol, which the API's limit
 *  does not cover: its first line lists HEAD's target among its capabilities. */
async function headBranch(owner: string, repo: string, token: string | null): Promise<string | null> {
  const res = await fetch(`https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}.git/info/refs?service=git-upload-pack`, {
    headers: { ...(token ? { Authorization: `Basic ${btoa(`x-access-token:${token}`)}` } : {}), ...UA },
  }).catch(() => null);
  if (!res?.ok) return null;
  const head = (await res.text()).slice(0, 4096);
  return /symref=HEAD:refs\/heads\/([^\s\0]+)/.exec(head)?.[1] ?? null;
}

/** Parses "owner/repo", "https://github.com/owner/repo", or either with "#ref". */
export function parseRepo(input: string): { owner: string; repo: string; ref: string | null } {
  const [spec, ref] = input.trim().split("#");
  const m = spec.replace(/\.git$/, "").match(/^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+)\/?$/);
  if (!m) throw new Error("give a repository as owner/name or a github.com URL");
  return { owner: m[1], repo: m[2], ref: ref || null };
}
