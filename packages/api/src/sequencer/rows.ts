// Every statement costs a call into the runtime, so rows go in and come out
// many per statement.

/** A Durable Object's limit on bound parameters per statement. */
export const MAX_PARAMS = 100;

/** `INSERT ... VALUES` for many rows in as few statements as the limit allows,
 *  with what the statements return (for a RETURNING clause in `then`). */
export function insertRows(sql: SqlStorage, into: string, rows: SqlStorageValue[][], then = ""): Record<string, SqlStorageValue>[] {
  const width = rows[0]?.length ?? 0;
  const per = Math.max(1, Math.floor(MAX_PARAMS / Math.max(1, width)));
  const out: Record<string, SqlStorageValue>[] = [];
  for (let i = 0; i < rows.length; i += per) {
    const chunk = rows.slice(i, i + per);
    const values = chunk.map(() => `(${new Array(width).fill("?").join(", ")})`).join(", ");
    out.push(...sql.exec(`${into} VALUES ${values} ${then}`, ...chunk.flat()).toArray());
  }
  return out;
}

/** `select ... WHERE column IN (values)`, in as few statements as the limit allows. */
export function rowsWhereIn<T extends Record<string, SqlStorageValue>>(sql: SqlStorage, select: string, column: string, values: Iterable<string>): T[] {
  const all = [...values];
  const out: T[] = [];
  for (let i = 0; i < all.length; i += MAX_PARAMS) {
    const chunk = all.slice(i, i + MAX_PARAMS);
    out.push(...sql.exec<T>(`${select} WHERE ${column} IN (${chunk.map(() => "?").join(", ")})`, ...chunk).toArray());
  }
  return out;
}
