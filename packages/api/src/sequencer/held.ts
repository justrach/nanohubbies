import { insertRows, MAX_PARAMS } from "./rows";

/** Writes held for the rest of a batch of landings (the sequencer's `land`).
 *  When the batch ends, each table gets one statement for all of it, and a
 *  row written more than once in it goes in once, as last written: the root
 *  tree and the tip change with every landing. The rows still go in during
 *  the turn that landed them, so the answer that says a change landed leaves
 *  only once they are stored. A landing's rows join the batch when it is
 *  decided; one that throws leaves none behind. Reads that could miss a held
 *  row look here first. Outside a batch, writes go in at once. */

type Row = SqlStorageValue[];

/** How a table's rows go in: the statement up to VALUES, what follows it,
 *  and, for rows that can be removed, the table and its key column. */
export interface Table {
  into: string;
  then?: string;
  from?: string;
  key?: string;
}

class Writes {
  /** Rows by key, null when removed, per table. */
  keyed = new Map<Table, Map<string, Row | null>>();
  /** Rows appended, per table. */
  added = new Map<Table, Row[]>();

  merge(other: Writes) {
    for (const [t, rows] of other.keyed) for (const [k, row] of rows) this.rows(t).set(k, row);
    for (const [t, rows] of other.added) this.list(t).push(...rows);
  }

  rows(t: Table) {
    let rows = this.keyed.get(t);
    if (!rows) this.keyed.set(t, (rows = new Map()));
    return rows;
  }

  list(t: Table) {
    let rows = this.added.get(t);
    if (!rows) this.added.set(t, (rows = []));
    return rows;
  }
}

const batches = new WeakMap<SqlStorage, { batch: Writes; landing: Writes | null }>();

export function beginBatch(sql: SqlStorage) {
  batches.set(sql, { batch: new Writes(), landing: null });
}

export function beginLanding(sql: SqlStorage) {
  const b = batches.get(sql);
  if (b) b.landing = new Writes();
}

/** Ends a landing: its rows join the batch, or, when it threw, are dropped. */
export function endLanding(sql: SqlStorage, decided: boolean) {
  const b = batches.get(sql);
  if (!b?.landing) return;
  if (decided) b.batch.merge(b.landing);
  b.landing = null;
}

/** Writes what the batch holds and ends it. */
export function endBatch(sql: SqlStorage) {
  const b = batches.get(sql);
  batches.delete(sql);
  if (!b) return;
  for (const [t, rows] of b.batch.keyed) {
    const gone = [...rows].flatMap(([k, row]) => (row ? [] : [k]));
    for (let i = 0; i < gone.length; i += MAX_PARAMS) {
      const chunk = gone.slice(i, i + MAX_PARAMS);
      sql.exec(`DELETE FROM ${t.from} WHERE ${t.key} IN (${chunk.map(() => "?").join(", ")})`, ...chunk);
    }
    const kept = [...rows.values()].filter((row): row is Row => row !== null);
    if (kept.length) insertRows(sql, t.into, kept, t.then);
  }
  for (const [t, rows] of b.batch.added) if (rows.length) insertRows(sql, t.into, rows, t.then);
}

/** Writes a row of a keyed table, or removes it when `row` is null. */
export function put(sql: SqlStorage, t: Table, key: string, row: Row | null) {
  const w = writes(sql);
  if (w) w.rows(t).set(key, row);
  else if (row) insertRows(sql, t.into, [row], t.then);
  else sql.exec(`DELETE FROM ${t.from} WHERE ${t.key} = ?`, key);
}

/** Appends rows to a table. */
export function add(sql: SqlStorage, t: Table, rows: Row[]) {
  if (!rows.length) return;
  const w = writes(sql);
  if (w) w.list(t).push(...rows);
  else insertRows(sql, t.into, rows, t.then);
}

/** Bytes of a binary column, `column`, over the rows a table has appended in
 *  the batch, the landing under way included. */
export function heldBytes(sql: SqlStorage, t: Table, column: number): number {
  const b = batches.get(sql);
  let bytes = 0;
  for (const w of b ? [b.batch, b.landing] : []) for (const row of w?.added.get(t) ?? []) bytes += (row[column] as ArrayBuffer).byteLength;
  return bytes;
}

/** A held row of a keyed table: the row, null when held as removed, or
 *  undefined when the table's row is not held. */
export function held(sql: SqlStorage, t: Table, key: string): Row | null | undefined {
  const b = batches.get(sql);
  if (!b) return undefined;
  const mine = b.landing?.keyed.get(t)?.get(key);
  return mine !== undefined ? mine : b.batch.keyed.get(t)?.get(key);
}

function writes(sql: SqlStorage): Writes | null {
  const b = batches.get(sql);
  return b ? (b.landing ?? b.batch) : null;
}
