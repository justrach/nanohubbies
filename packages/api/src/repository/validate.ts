import { encode, readTree, tree, type ObjectType } from "../git";
import type { StoredObject } from "../objects";
import { commitAt } from "../review/graph";

export interface RepositoryLimits {
  objectBytes: number;
  totalBytes: number;
  objects: number;
  graphBytes?: number;
}
export function repositoryLimits(env: Env): RepositoryLimits {
  const vars = env as Env & Record<string, string>;
  const limit = (key: string, fallback: number, max: number) => {
    const n = Number(vars[key] ?? fallback);
    if (!Number.isSafeInteger(n) || n < 1 || n > max)
      throw new Error(`Invalid ${key}`);
    return n;
  };
  return {
    objectBytes: limit("GIT_MAX_OBJECT_BYTES", 16 << 20, 32 << 20),
    totalBytes: limit("GIT_MAX_EXPANDED_BYTES", 48 << 20, 64 << 20),
    objects: limit("GIT_MAX_OBJECTS", 100_000, 200_000),
    graphBytes: limit("GIT_MAX_REPOSITORY_BYTES", 2 ** 31, 16 * 2 ** 30),
  };
}

/** Walk the entire reachable graph. Never silently omit a file or ancestor.
 * Names that cannot be represented losslessly by this host fail explicitly. */
export async function validateGraph(
  get: (sha: string) => Promise<StoredObject | null>,
  roots: { sha: string; type?: ObjectType }[],
  limits: RepositoryLimits,
) {
  const seen = new Map<string, ObjectType>();
  const queue = roots.map((r) => ({ ...r, depth: 0 }));
  let bytes = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  for (let i = 0; i < queue.length; i++) {
    const { sha, type, depth } = queue[i];
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Invalid object ID");
    const known = seen.get(sha);
    if (known) {
      if (type && known !== type)
        throw new Error(`Wrong object type for ${sha}`);
      continue;
    }
    const obj = await get(sha);
    if (
      !obj ||
      (type && obj.type !== type) ||
      encode(obj.type, obj.body).sha !== sha
    )
      throw new Error(`Missing or invalid object ${sha}`);
    bytes += obj.body.length;
    if (
      obj.body.length > limits.objectBytes ||
      bytes > (limits.graphBytes ?? limits.totalBytes) ||
      seen.size >= limits.objects
    )
      throw new Error(
        "Repository graph exceeds configured object/expanded-byte limits; migration incomplete",
      );
    seen.set(sha, obj.type);
    const add = (sha: string, type?: ObjectType, depth = 0) =>
      queue.push({ sha, type, depth });
    if (obj.type === "commit") {
      const c = await commitAt({ body: async () => obj!.body }, sha);
      add(c.tree, "tree");
      c.parents.forEach((p) => add(p, "commit"));
    } else if (obj.type === "tag") {
      const header = decoder.decode(obj.body).split("\n\n")[0];
      const target = /^object ([a-f0-9]{40})$/m.exec(header)?.[1];
      const kind = /^type (commit|tree|blob|tag)$/m.exec(header)?.[1] as
        | ObjectType
        | undefined;
      if (!target || !kind) throw new Error("Malformed annotated tag");
      add(target, kind);
    } else if (obj.type === "tree") {
      if (depth > 100) throw new Error("Tree exceeds 100 directory levels");
      const names = new Set<string>();
      for (let at = 0; at < obj.body.length; ) {
        const space = obj.body.indexOf(32, at),
          nul = obj.body.indexOf(0, space + 1);
        if (space < at || nul <= space + 1 || nul + 21 > obj.body.length)
          throw new Error("Malformed tree");
        decoder.decode(obj.body.subarray(space + 1, nul));
        at = nul + 21;
      }
      const entries = readTree(obj.body);
      if (tree(entries).sha !== sha)
        throw new Error(
          "Noncanonical tree or unsupported path encoding; migration incomplete",
        );
      for (const e of entries) {
        if (
          !e.name ||
          /[/\\\0]/.test(e.name) ||
          [".", "..", ".git"].includes(e.name.toLowerCase()) ||
          names.has(e.name)
        )
          throw new Error(
            "Unsupported or duplicate Git path; migration incomplete",
          );
        names.add(e.name);
        if (e.mode === "40000") add(e.sha, "tree", depth + 1);
        else if (["100644", "100755", "120000"].includes(e.mode))
          add(e.sha, "blob");
        else
          throw new Error(
            `Unsupported tree mode ${e.mode} (submodules require a separate migration)`,
          );
      }
    } else if (
      obj.type === "blob" &&
      obj.body.length < 1024 &&
      new TextDecoder()
        .decode(obj.body)
        .startsWith("version https://git-lfs.github.com/spec/v1\n")
    ) {
      throw new Error(
        "Git LFS pointer found; external LFS objects have not been transferred. Migration incomplete",
      );
    }
  }
  return seen;
}

export async function isAncestor(
  get: (sha: string) => Promise<StoredObject | null>,
  ancestor: string,
  tip: string,
  max = 100_000,
) {
  const queue = [tip],
    seen = new Set<string>();
  for (let i = 0; i < queue.length; i++) {
    const sha = queue[i];
    if (sha === ancestor) return true;
    if (seen.has(sha)) continue;
    if (seen.size >= max) throw new Error("Ancestry traversal limit exceeded");
    seen.add(sha);
    const c = await get(sha);
    if (!c || c.type !== "commit")
      throw new Error("Missing commit while proving ancestry");
    queue.push(...(await commitAt({ body: async () => c.body }, sha)).parents);
  }
  return false;
}

/** Inspect every introduced commit, including commits hidden below the tip.
 * Exclude all ancestors of the previous ref so pre-existing merges are allowed. */
export async function refProof(
  get: (sha: string) => Promise<StoredObject | null>,
  old: string | null,
  next: string,
  max = 100_000,
): Promise<import("./types").RefProof> {
  const parents = async (sha: string) => {
    const obj = await get(sha);
    if (!obj || obj.type !== "commit")
      throw Error("Missing commit while proving linear history");
    return (await commitAt({ body: async () => obj.body }, sha)).parents;
  };
  const known = new Set<string>(),
    before = old ? [old] : [];
  for (let i = 0; i < before.length; i++) {
    const sha = before[i];
    if (known.has(sha)) continue;
    if (known.size >= max) throw Error("History proof exceeds commit limit");
    known.add(sha);
    before.push(...(await parents(sha)));
  }
  const seen = new Set<string>(),
    queue = [next];
  for (let i = 0; i < queue.length; i++) {
    const sha = queue[i];
    if (known.has(sha) || seen.has(sha)) continue;
    if (seen.size >= max) throw Error("History proof exceeds commit limit");
    seen.add(sha);
    const p = await parents(sha);
    if (p.length > 1) return { old, next, linear: false };
    queue.push(...p);
  }
  return { old, next, linear: true };
}
