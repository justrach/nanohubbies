/** "owner/name", or any github.com address inside a repository, as
 *  owner/name; null for anything else. GitHub owners have no dots, so
 *  another host's address never reads as one. */
export function repoOf(input: string): string | null {
  const m = input.trim().split("#")[0].match(/^(?:(?:https?:\/\/)?(?:www\.)?github\.com\/)?([A-Za-z0-9-]+)\/([\w.-]+?)(?:\.git)?(?:\/.*)?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** A trunk name from a repository's name: lower case, letters, digits and dashes. */
export const nameFor = (repo: string) => (repo.split("/")[1] ?? "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "trunk";


export function trunkDestination(name: string, destination: "setup" | "code") {
  return `/t/${encodeURIComponent(name)}${destination === "setup" ? "/setup" : ""}`;
}
