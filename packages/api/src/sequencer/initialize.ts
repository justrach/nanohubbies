import type { GitObject } from "../git";
import type { Head } from "../types";
import { add } from "./held";
import { createMirror, type Mirror } from "./mirror";
import { forget, getMeta, OUTBOX, PENDING, putFile, rebuildTrees, record, setMeta } from "./store";

type File = { path: string; text: string };
interface Seed { id: string; trunk: string; next: number; files: number }

/** A source snapshot enters SQLite in bounded, replayable batches. No head
 * exists until every file is staged and a single seed commit is published. */
export class Initializer {
  constructor(
    private ctx: DurableObjectState,
    private env: Env,
    private commit: (objects: GitObject[], root: string) => Head,
    private publish: () => Promise<void>,
  ) {}
  private get sql() { return this.ctx.storage.sql; }

  async begin(trunk: string, id: string): Promise<number> {
    const current = getMeta<Seed>(this.sql, "initialization");
    if (current?.id === id && current.trunk === trunk) return current.next;
    if (current || getMeta<Head>(this.sql, "tip")) throw new Error(`trunk ${trunk} already exists`);
    const mirror = this.env.ARTIFACTS ? await createMirror(this.env.ARTIFACTS, trunk) : null;
    if (getMeta<Seed>(this.sql, "initialization") || getMeta<Head>(this.sql, "tip")) throw new Error(`trunk ${trunk} already exists`);
    this.ctx.storage.transactionSync(() => {
      setMeta(this.sql, "trunk", trunk);
      if (mirror) setMeta(this.sql, "mirror", mirror);
      setMeta(this.sql, "initialization", { id, trunk, next: 0, files: 0 } satisfies Seed);
    });
    return 0;
  }

  append(id: string, batch: number, files: File[]): number {
    const seed = this.seed(id);
    if (batch < seed.next) return seed.next; // The previous RPC reply was lost.
    if (batch !== seed.next || getMeta<Head>(this.sql, "tip")) throw new Error("seed batch is out of order");
    let bytes = 0;
    const names = new Set<string>();
    for (const file of files) {
      if (!file || typeof file.path !== "string" || typeof file.text !== "string" ||
        !file.path || file.path.includes("\\") || file.path.includes("\0") ||
        file.path.split("/").some((part) => !part || part === "." || part === "..") ||
        names.has(file.path) || this.sql.exec("SELECT 1 FROM files WHERE path = ?", file.path).toArray().length)
        throw new Error("seed files need unique safe paths and text");
      names.add(file.path);
      bytes += new TextEncoder().encode(file.text).length + new TextEncoder().encode(file.path).length;
    }
    if (!files.length || bytes > 1024 * 1024) throw new Error("seed batch must contain at most 1 MiB of source");
    try {
      this.ctx.storage.transactionSync(() => {
        for (const file of files) {
          const object = putFile(this.sql, file.path, file.text)!;
          const raw = new Uint8Array(object.raw).buffer;
          add(this.sql, PENDING, [[1, object.sha, raw, Date.now()]]);
          if (getMeta<Mirror>(this.sql, "mirror")) add(this.sql, OUTBOX, [[1, object.sha, raw]]);
        }
        setMeta(this.sql, "initialization", { ...seed, next: seed.next + 1, files: seed.files + files.length });
      });
    } catch (error) {
      forget(this.sql); // SQL rollback must invalidate the directory/text caches.
      throw error;
    }
    return seed.next + 1;
  }

  async finish(id: string): Promise<Head> {
    const seed = this.seed(id);
    if (!seed.files) throw new Error("a trunk needs at least one file");
    let head = getMeta<Head>(this.sql, "tip");
    if (!head) {
      try {
        head = this.ctx.storage.transactionSync(() => {
          const paths = this.sql.exec<{ path: string }>("SELECT path FROM files");
          const trees = rebuildTrees(this.sql, Array.from(paths, (row) => row.path));
          return this.commit(trees.objects, trees.root);
        });
      } catch (error) { forget(this.sql); throw error; }
    }
    await this.publish();
    return head;
  }

  private seed(id: string): Seed {
    const seed = getMeta<Seed>(this.sql, "initialization");
    if (!seed || seed.id !== id) throw new Error("seed does not belong to this import");
    return seed;
  }

  /** Compatibility entry point for templates and existing API callers. */
  async initialize(trunk: string, files: File[]): Promise<Head> {
    if (!files.length) throw new Error("a trunk needs at least one file");
    const id = crypto.randomUUID();
    await this.begin(trunk, id);
    const head = this.ctx.storage.transactionSync(() => {
      const blobs = files.map((file) => putFile(this.sql, file.path, file.text)!);
      const trees = rebuildTrees(this.sql, files.map((file) => file.path));
      return this.commit([...blobs, ...trees.objects], trees.root);
    });
    await this.publish();
    return head;
  }
}

export function recordSeed(sql: SqlStorage, head: Head) {
  record(sql, { id: "seed", agent: "seed", intent: "Seed the trunk", base: 0, status: "landed", version: 1, commit: head.commit, overlaps: [], at: Date.now() });
}
