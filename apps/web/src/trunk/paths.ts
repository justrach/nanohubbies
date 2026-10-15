// Where things are, for server and client components alike. Paths follow
// GitHub's: /t/<trunk>/tree/<dir>, /t/<trunk>/blob/<file>, /t/<trunk>/commit/<v>.

export const TRUNK_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

export const trunkHref = (trunk: string, rest = "") => `/t/${trunk}${rest}`;

/** A directory's or a file's page, at version `v` when given. */
export function pathHref(trunk: string, kind: "tree" | "blob", path: string, v?: number | null) {
  const p = path.split("/").map(encodeURIComponent).join("/");
  return `${kind === "tree" && !path ? trunkHref(trunk) : trunkHref(trunk, `/${kind}/${p}`)}${v ? `?v=${v}` : ""}`;
}

export const commitHref = (trunk: string, version: number) => trunkHref(trunk, `/commit/${version}`);

/** A path from the route's segments, which arrive encoded. */
export const joinPath = (segments: string[] | undefined) => (segments ?? []).map(decoded).join("/");

function decoded(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** `?v=12` as a version, or undefined for the newest. */
export function versionParam(raw: string | string[] | undefined): number | undefined {
  const v = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isSafeInteger(v) && v > 0 ? v : undefined;
}

/** A link in a file at `dir`, as a path from the top of the tree: "../a.md"
 *  from "docs/guide" is "docs/a.md"; "/x" is from the top. Null when it leaves the tree. */
export function resolveRelative(dir: string, href: string): string | null {
  const [path] = href.split(/[?#]/);
  const parts = path.startsWith("/") ? [] : dir.split("/").filter(Boolean);
  for (const p of path.split("/")) {
    if (!p || p === ".") continue;
    if (p === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(decoded(p));
  }
  return parts.join("/");
}
