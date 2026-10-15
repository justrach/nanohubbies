export interface Repository {
  full_name: string;
  private: boolean;
}
export interface RepositorySnapshot {
  scope: string;
  repos: Repository[];
  updatedAt: number;
}
const KEY = "swarm.repository-picker.v1";
export const FRESH_FOR = 5 * 60_000;
const RETAIN_FOR = 24 * 60 * 60_000;
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

/** Suggestions only. Import authorization is always checked by the server. */
export function createRepositoryCache(storage: () => Storage | null) {
  let current: RepositorySnapshot | null = null;
  let active = "";
  let generation = 0;
  let pending: Promise<RepositorySnapshot> | null = null;
  function persist(value: RepositorySnapshot | null) {
    try {
      if (value) storage()?.setItem(KEY, JSON.stringify(value));
      else storage()?.removeItem(KEY);
    } catch {
      /* Private browsing or a full storage quota must not block picking. */
    }
  }
  function clear() {
    generation++;
    active = "";
    current = null;
    pending = null;
    persist(null);
  }
  function read(scope: string, now = Date.now()): RepositorySnapshot | null {
    if (active !== scope) {
      generation++;
      active = scope;
      current = null;
      pending = null;
      try {
        const value = JSON.parse(storage()?.getItem(KEY) ?? "null");
        if (
          value?.scope === scope &&
          Number.isFinite(value.updatedAt) &&
          value.updatedAt <= now &&
          now - value.updatedAt < RETAIN_FOR &&
          Array.isArray(value.repos) &&
          value.repos.length <= 5000 &&
          value.repos.every(
            (r: Repository) =>
              r &&
              typeof r.full_name === "string" &&
              typeof r.private === "boolean",
          )
        )
          current = value;
      } catch {
        /* Ignore obsolete or malformed cache data. */
      }
      if (!current) persist(null);
    }
    if (current && now - current.updatedAt >= RETAIN_FOR) {
      current = null;
      persist(null);
    }
    return current;
  }
  function load(
    scope: string,
    fetcher: () => Promise<Repository[]>,
    force = false,
  ) {
    const cached = read(scope);
    if (!force && cached && Date.now() - cached.updatedAt < FRESH_FOR)
      return Promise.resolve(cached);
    if (pending) return pending;
    const version = generation;
    const request = fetcher()
      .then((repos) => {
        const value = { scope, repos, updatedAt: Date.now() };
        if (generation === version && active === scope) {
          current = value;
          persist(value);
        }
        return value;
      })
      .finally(() => {
        if (pending === request) pending = null;
      });
    pending = request;
    return request;
  }
  return { read, load, clear };
}
export const repositoryCache = createRepositoryCache(() =>
  typeof window === "undefined" ? null : window.sessionStorage,
);
