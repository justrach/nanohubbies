// A Durable Object's storage outside the Workers runtime. SQL runs on
// node:sqlite or bun:sqlite, and the writes of one event-loop turn commit
// together after it, as a Durable Object's do. R2 is a map in memory whose
// calls complete on a later turn, as I/O does.

type Row = Record<string, unknown>;

export async function openSql(path: string) {
  const bun = (globalThis as { Bun?: unknown }).Bun;
  const db = bun ? new (await import("bun:sqlite")).Database(path) : new (await import("node:sqlite")).DatabaseSync(path);
  db.exec("PRAGMA journal_mode=WAL");
  const statements = new Map<string, { all(...args: unknown[]): unknown[] }>();
  let open = false;
  const commit = () => {
    if (!open) return;
    db.exec("COMMIT");
    open = false;
  };
  const turn = () => {
    if (open) return;
    db.exec("BEGIN");
    open = true;
    setImmediate(commit);
  };
  return {
    transactionSync<T>(callback: () => T): T {
      turn();
      db.exec("SAVEPOINT receipt");
      try {
        const result = callback();
        db.exec("RELEASE receipt");
        return result;
      } catch (error) {
        db.exec("ROLLBACK TO receipt; RELEASE receipt");
        throw error;
      }
    },
    close() {
      commit();
      db.close();
    },
    exec(query: string, ...bindings: unknown[]) {
      turn();
      let stmt = statements.get(query);
      if (!stmt) statements.set(query, (stmt = db.prepare(query) as { all(...args: unknown[]): unknown[] }));
      const rows = stmt.all(...bindings.map((b) => (b instanceof ArrayBuffer ? new Uint8Array(b) : b))) as Row[];
      return {
        toArray: () => rows,
        one: () => {
          if (rows.length !== 1) throw new Error(`expected one row, got ${rows.length}`);
          return rows[0];
        },
        [Symbol.iterator]: () => rows[Symbol.iterator](),
      };
    },
  };
}

export function memoryBucket() {
  const objects = new Map<string, Uint8Array>();
  const later = <T>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 0));
  return {
    objects,
    put: (key: string, value: Uint8Array) => {
      objects.set(key, value);
      return later({ key });
    },
    get: (key: string) => {
      const v = objects.get(key);
      return later(v ? { size: v.length, arrayBuffer: async () => v.slice().buffer } : null);
    },
    delete: (keys: string | string[]) => {
      for (const k of ([] as string[]).concat(keys)) objects.delete(k);
      return later(undefined);
    },
  };
}
