import { blob, type GitObject } from "../git";
import type { ChangeRecord, Head } from "../types";
import { DIR, dirAt, FILE, removeEntry, setEntry, treeOf, type Dirs } from "./dirs";
import { held, put, type Table } from "./held";
import { rowsWhereIn } from "./rows";

export { insertRows, rowsWhereIn } from "./rows";

// files       the tip's contents, so edits apply without reading R2
// trees       the tip's tree for every directory, so a commit rebuilds only
//             the directories on the paths it changed
// last_write  footprint key → the version and change that last wrote it
// versions    every landed version's commit and root tree
// changes     every submission, landed or not
// pending     objects not yet handed to the trunk's packer
// packs       packs this sequencer recorded before trunks had a packer, handed
//             over to it once (./publish)
// outbox      objects not yet pushed to the Artifacts mirror
// starved     how often an agent lost each key in a row
// leases      keys held for an agent that kept losing them
// pushed      commits that came in with git push, and the version each became
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, dir TEXT NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL, sha TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS files_by_dir ON files (dir);
  CREATE TABLE IF NOT EXISTS trees (dir TEXT PRIMARY KEY, parent TEXT, name TEXT NOT NULL, sha TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS trees_by_parent ON trees (parent);
  CREATE TABLE IF NOT EXISTS last_write (key TEXT PRIMARY KEY, version INTEGER NOT NULL, change_id TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS versions (version INTEGER PRIMARY KEY, commit_sha TEXT NOT NULL, tree_sha TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS versions_by_commit ON versions (commit_sha);
  CREATE TABLE IF NOT EXISTS changes (
    id TEXT PRIMARY KEY, agent TEXT NOT NULL, intent TEXT NOT NULL, base INTEGER NOT NULL, status TEXT NOT NULL,
    version INTEGER, commit_sha TEXT, overlaps TEXT NOT NULL, at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, identity TEXT NOT NULL, result TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS pending (seq INTEGER PRIMARY KEY AUTOINCREMENT, version INTEGER NOT NULL, sha TEXT NOT NULL, raw BLOB NOT NULL, at INTEGER);
  CREATE TABLE IF NOT EXISTS packs (
    name TEXT PRIMARY KEY, level INTEGER NOT NULL, first INTEGER NOT NULL, last INTEGER NOT NULL,
    objects INTEGER NOT NULL, bytes INTEGER NOT NULL, dropped INTEGER
  );
  CREATE TABLE IF NOT EXISTS outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, version INTEGER NOT NULL, sha TEXT NOT NULL, raw BLOB NOT NULL);
  CREATE TABLE IF NOT EXISTS starved (agent TEXT NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (agent, key));
  CREATE TABLE IF NOT EXISTS leases (key TEXT PRIMARY KEY, agent TEXT NOT NULL, until INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS pushed (sha TEXT PRIMARY KEY, version INTEGER NOT NULL)
`;

export function migrate(sql: SqlStorage) {
  for (const stmt of SCHEMA.split(";")) if (stmt.trim()) sql.exec(stmt);
  // When each pending object landed, for the backlog (./backlog); a trunk
  // from before has the column added, and its rows count from now.
  if (!sql.exec<{ name: string }>("SELECT name FROM pragma_table_info('pending')").toArray().some((c) => c.name === "at")) {
    sql.exec("ALTER TABLE pending ADD COLUMN at INTEGER");
  }
}

// Every statement costs a call into the runtime, so a landing runs as few as
// it can: its writes are held and go in with the rest of its batch (./held),
// rows go in and come out many per statement (./rows), and what only the
// sequencer writes (meta, the tip's files and directories) is also kept in
// memory.

/** The tables a landing writes, as ./held writes them. */
export const META: Table = { into: "INSERT INTO meta (k, v)", then: "ON CONFLICT (k) DO UPDATE SET v = excluded.v" };
export const FILES: Table = {
  into: "INSERT INTO files (path, dir, name, text, sha)",
  then: "ON CONFLICT (path) DO UPDATE SET text = excluded.text, sha = excluded.sha",
  from: "files",
  key: "path",
};
export const TREES: Table = { into: "INSERT INTO trees (dir, parent, name, sha)", then: "ON CONFLICT (dir) DO UPDATE SET sha = excluded.sha", from: "trees", key: "dir" };
export const LAST_WRITE: Table = {
  into: "INSERT INTO last_write (key, version, change_id)",
  then: "ON CONFLICT (key) DO UPDATE SET version = excluded.version, change_id = excluded.change_id",
};
const CHANGES: Table = {
  into: "INSERT INTO changes (id, agent, intent, base, status, version, commit_sha, overlaps, at)",
  then: `ON CONFLICT (id) DO UPDATE SET status = excluded.status, version = excluded.version, commit_sha = excluded.commit_sha,
         overlaps = excluded.overlaps, at = excluded.at`,
};
export const VERSIONS: Table = { into: "INSERT INTO versions (version, commit_sha, tree_sha)" };
export const PENDING: Table = { into: "INSERT INTO pending (version, sha, raw, at)" };
export const PUSHED: Table = { into: "INSERT INTO pushed (sha, version)", then: "ON CONFLICT (sha) DO NOTHING" };
export const OUTBOX: Table = { into: "INSERT INTO outbox (version, sha, raw)" };

const metas = new WeakMap<SqlStorage, Map<string, unknown>>();

export function getMeta<T>(sql: SqlStorage, k: string): T | undefined {
  let known = metas.get(sql);
  if (!known) metas.set(sql, (known = new Map()));
  if (!known.has(k)) {
    const row = sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = ?", k).toArray()[0];
    known.set(k, row ? JSON.parse(row.v) : undefined);
  }
  return known.get(k) as T | undefined;
}

export function setMeta(sql: SqlStorage, k: string, v: unknown) {
  put(sql, META, k, [k, JSON.stringify(v)]);
  metas.get(sql)?.set(k, v);
}

/** Drops what is kept in memory, for storage that was just wiped. */
export function forget(sql: SqlStorage) {
  metas.delete(sql);
  indexes.delete(sql);
  texts.delete(sql);
  recent.delete(sql);
}

/** Recently written files' text, so a change to a file just changed reads
 *  nothing back: the most recent, up to about TEXT_BYTES. */
const texts = new WeakMap<SqlStorage, { byPath: Map<string, string>; size: number }>();
const TEXT_BYTES = 24 * 1024 * 1024;

function keepText(sql: SqlStorage, path: string, text: string | null) {
  let t = texts.get(sql);
  if (!t) texts.set(sql, (t = { byPath: new Map(), size: 0 }));
  const old = t.byPath.get(path);
  if (old !== undefined) {
    t.byPath.delete(path);
    t.size -= old.length;
  }
  if (text === null) return;
  t.byPath.set(path, text);
  t.size += text.length;
  for (const [p, kept] of t.byPath) {
    if (t.size <= TEXT_BYTES) break;
    t.byPath.delete(p);
    t.size -= kept.length;
  }
}

function remember<K, V>(map: Map<K, V>, k: K, v: V, max: number) {
  map.delete(k);
  map.set(k, v);
  if (map.size > max) map.delete(map.keys().next().value!);
}

/** Objects committed lately, so an object a version makes again is not
 *  published twice. Older repeats are rare and harmless: a pack may hold an
 *  object another pack has. */
const recent = new WeakMap<SqlStorage, Map<string, true>>();
const RECENT = 50_000;

/** The objects among `shas` not committed lately, and remembers them all. */
export function unseen(sql: SqlStorage, shas: string[]): Set<string> {
  let seen = recent.get(sql);
  if (!seen) recent.set(sql, (seen = new Map()));
  const out = new Set<string>();
  for (const sha of shas) {
    if (!seen.has(sha)) out.add(sha);
    remember(seen, sha, true, RECENT);
  }
  return out;
}

/** The tip's directories (./dirs), read from the files and trees tables
 *  once, then kept in step. */
const indexes = new WeakMap<SqlStorage, Dirs>();

function index(sql: SqlStorage): Dirs {
  let dirs = indexes.get(sql);
  if (!dirs) {
    dirs = new Map();
    for (const r of sql.exec<{ dir: string; name: string; sha: string }>("SELECT dir, name, sha FROM files")) setEntry(dirAt(dirs, r.dir), r.name, FILE, r.sha);
    for (const r of sql.exec<{ parent: string; name: string; sha: string }>("SELECT parent, name, sha FROM trees WHERE parent IS NOT NULL")) {
      setEntry(dirAt(dirs, r.parent), r.name, DIR, r.sha);
    }
    indexes.set(sql, dirs);
  }
  return dirs;
}

/** Writes one file of the tip, or removes it when `text` is null. */
export function putFile(sql: SqlStorage, path: string, text: string | null): GitObject | null {
  // Read from the tables before this write is held, so it is not missed.
  const dirs = index(sql);
  keepText(sql, path, text);
  if (text === null) {
    put(sql, FILES, path, null);
    const d = dirs.get(dirOf(path));
    if (d) removeEntry(d, baseName(path));
    return null;
  }
  const b = blob(text);
  put(sql, FILES, path, [path, dirOf(path), baseName(path), text, b.sha]);
  setEntry(dirAt(dirs, dirOf(path)), baseName(path), FILE, b.sha);
  return b;
}

/** Rebuilds the trees of the directories on the paths to `changed`, deepest
 *  first, and keeps every other directory's tree as it was. A directory left
 *  empty is dropped from its parent. */
export function rebuildTrees(sql: SqlStorage, changed: Iterable<string>): { root: string; objects: GitObject[] } {
  const dirs = index(sql);
  const todo = new Set<string>([""]);
  for (const path of changed) for (let d = dirOf(path); d !== ""; d = dirOf(d)) todo.add(d);
  const objects: GitObject[] = [];
  let root = "";
  for (const dir of [...todo].sort((a, b) => depth(b) - depth(a))) {
    const here = dirs.get(dir);
    if (dir !== "" && !here?.entries.size) {
      put(sql, TREES, dir, null);
      dirs.delete(dir);
      const parent = dirs.get(dirOf(dir));
      if (parent) removeEntry(parent, baseName(dir));
      continue;
    }
    const made = treeOf(here ?? dirAt(dirs, dir));
    objects.push(made);
    put(sql, TREES, dir, [dir, dir === "" ? null : dirOf(dir), baseName(dir), made.sha]);
    if (dir === "") root = made.sha;
    else setEntry(dirAt(dirs, dirOf(dir)), baseName(dir), DIR, made.sha);
  }
  return { root, objects };
}

/** The newest version stored. Unlike the tip kept in memory, it never names
 *  a version a batch of landings has decided but not yet written. */
export function lastVersion(sql: SqlStorage): number {
  return sql.exec<{ v: number | null }>("SELECT MAX(version) AS v FROM versions").one().v ?? 0;
}

export function versionAt(sql: SqlStorage, v: number): Head | undefined {
  const mine = held(sql, VERSIONS, String(v));
  if (mine) return { version: v, commit: mine[1] as string, tree: mine[2] as string };
  const row = sql.exec<{ commit_sha: string; tree_sha: string }>("SELECT commit_sha, tree_sha FROM versions WHERE version = ?", v).toArray()[0];
  return row ? { version: v, commit: row.commit_sha, tree: row.tree_sha } : undefined;
}

/** Stored versions from `from` down, newest first. */
export function versionsFrom(sql: SqlStorage, from: number, limit: number): Head[] {
  return sql
    .exec<{ version: number; commit_sha: string; tree_sha: string }>("SELECT version, commit_sha, tree_sha FROM versions WHERE version <= ? ORDER BY version DESC LIMIT ?", from, limit)
    .toArray()
    .map((r) => ({ version: r.version, commit: r.commit_sha, tree: r.tree_sha }));
}

/** The version and change that last wrote each of `keys`, the batch's held
 *  writes first. Keys already in `known` are not asked for again. */
export function lastWrites(sql: SqlStorage, keys: Iterable<string>, known = new Map<string, { version: number; change_id: string } | null>()) {
  const ask: string[] = [];
  for (const k of keys) {
    if (known.has(k)) continue;
    const mine = held(sql, LAST_WRITE, k);
    if (mine) known.set(k, { version: mine[1] as number, change_id: mine[2] as string });
    else ask.push(k);
  }
  for (const k of ask) known.set(k, null);
  for (const r of rowsWhereIn<{ key: string; version: number; change_id: string }>(sql, "SELECT key, version, change_id FROM last_write", "key", ask)) {
    known.set(r.key, { version: r.version, change_id: r.change_id });
  }
  return known;
}

export function tipText(sql: SqlStorage, path: string): string | undefined {
  const mine = held(sql, FILES, path);
  if (mine !== undefined) return mine ? (mine[3] as string) : undefined;
  const hit = texts.get(sql)?.byPath.get(path);
  if (hit !== undefined) return hit;
  return sql.exec<{ text: string }>("SELECT text FROM files WHERE path = ?", path).toArray()[0]?.text;
}

export function changeById(sql: SqlStorage, id: string): ChangeRecord | undefined {
  const mine = held(sql, CHANGES, id);
  if (mine) return toRecord(Object.fromEntries(CHANGE_COLUMNS.map((c, i) => [c, mine[i]])));
  const row = sql.exec("SELECT * FROM changes WHERE id = ?", id).toArray()[0];
  return row ? toRecord(row) : undefined;
}

export function recentChanges(sql: SqlStorage, limit: number): ChangeRecord[] {
  return sql.exec("SELECT * FROM changes ORDER BY at DESC LIMIT ?", limit).toArray().map(toRecord);
}

const CHANGE_COLUMNS = ["id", "agent", "intent", "base", "status", "version", "commit_sha", "overlaps", "at"];

export function record(sql: SqlStorage, c: ChangeRecord) {
  put(sql, CHANGES, c.id, [c.id, c.agent, c.intent, c.base, c.status, c.version, c.commit, JSON.stringify(c.overlaps), c.at]);
}

function toRecord(row: Record<string, SqlStorageValue>): ChangeRecord {
  return {
    id: row.id as string,
    agent: row.agent as string,
    intent: row.intent as string,
    base: row.base as number,
    status: row.status as ChangeRecord["status"],
    version: row.version as number | null,
    commit: row.commit_sha as string | null,
    overlaps: JSON.parse(row.overlaps as string),
    at: row.at as number,
  };
}

const dirOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const depth = (dir: string) => (dir === "" ? 0 : dir.split("/").length);
