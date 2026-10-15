export interface ReleaseAsset { id: string; name: string; size: number; key: string }
export interface Release {
  id: string; trunk: string; tag: string; title: string; notes: string;
  version: number; commit: string; state: "draft" | "published";
  created: number; published: number | null; assets: ReleaseAsset[];
}
export type PublicRelease = Omit<Release, "version" | "commit" | "assets"> & {
  assets: Omit<ReleaseAsset, "key">[];
};
/** GET …/releases: every release for the owner, the published ones (in their
 *  public shape) for everyone else. Published releases are public even when
 *  the workspace's source is private (`sourcePrivate`). */
export interface ReleaseList {
  releases: (PublicRelease & Partial<Pick<Release, "version" | "commit">>)[];
  canManage: boolean;
  sourcePrivate: boolean;
}
export type ReleaseCommand =
  | { op: "list"; trunk: string; publicOnly: boolean }
  | { op: "create"; release: Release }
  | { op: "asset"; trunk: string; id: string; asset: ReleaseAsset; maxBytes: number }
  | { op: "publish"; trunk: string; id: string; published: boolean }
  | { op: "delete"; trunk: string; id: string };

/** Every release file of one workspace together, by default. */
export const RELEASE_MAX_BYTES = 1024 * 1024 * 1024;

export function publicRelease(r: Release): PublicRelease {
  const { version, commit, assets, ...safe } = r;
  return { ...safe, assets: assets.map(({ key, ...asset }) => asset) };
}
export function releaseFields(input: Record<string, unknown>) {
  const { tag, title, notes, version } = input;
  if (typeof tag !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(tag)) throw new Error("Use a release tag of up to 80 letters, numbers, dots, dashes or underscores");
  if (typeof title !== "string" || !title.trim() || title.length > 200) throw new Error("Provide a title of up to 200 characters");
  if (typeof notes !== "string" || notes.length > 16000) throw new Error("Release notes can contain up to 16000 characters");
  if (!Number.isSafeInteger(version) || (version as number) < 1) throw new Error("Choose a published source version");
  return { tag, title: title.trim(), notes, version: version as number };
}
