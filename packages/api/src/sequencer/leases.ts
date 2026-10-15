import type { ChangeRequest, Overlap } from "../types";
import { rowsWhereIn } from "./store";

/** An agent that loses the same key this many times in a row gets a lease on
 *  it: until it lands, or the lease runs out, changes that write the key wait.
 *  Without it, an agent that plans for minutes never lands on a key that
 *  fast scripted agents keep writing. Scripted agents never get one. */
const STARVED_AFTER = 2;
const STARVED_WINDOW_MS = 600_000;
const LEASE_MS = 60_000;

/** Agents with rows in starved or leases, and the ones holding leases. Read
 *  once, then kept in step, so most landings check leases and forgive with no
 *  statement at all. */
interface Marks {
  starving: Set<string>;
  holding: Set<string>;
}
const marks = new WeakMap<SqlStorage, Marks>();

function marked(sql: SqlStorage): Marks {
  let m = marks.get(sql);
  if (!m) {
    const holding = new Set(sql.exec<{ agent: string }>("SELECT DISTINCT agent FROM leases").toArray().map((r) => r.agent));
    const starving = new Set(sql.exec<{ agent: string }>("SELECT DISTINCT agent FROM starved").toArray().map((r) => r.agent));
    marks.set(sql, (m = { starving: new Set([...starving, ...holding]), holding }));
  }
  return m;
}

/** Drops what is kept in memory, for storage that was just wiped. */
export function forgetLeases(sql: SqlStorage) {
  marks.delete(sql);
}

/** Keys among `writes` that another agent holds a lease on. */
export function leased(sql: SqlStorage, agent: string, writes: Set<string>, tip: number): Overlap[] {
  const { holding } = marked(sql);
  if (!holding.size || (holding.size === 1 && holding.has(agent))) return [];
  const now = Date.now();
  const held = new Map(rowsWhereIn<{ key: string; agent: string; until: number }>(sql, "SELECT key, agent, until FROM leases", "key", writes).map((r) => [r.key, r]));
  const out: Overlap[] = [];
  for (const k of writes) {
    const row = held.get(k);
    if (row && row.agent !== agent && row.until > now) out.push({ key: k, kind: "leased", by: row.agent, version: tip });
  }
  return out;
}

/** Counts an agent's losses per key; a key it keeps losing is leased to it.
 *  Returns the keys just leased. */
export function starve(sql: SqlStorage, req: ChangeRequest, conflicts: Overlap[], at: number): string[] {
  if (req.kind !== "agent") return [];
  const m = marked(sql);
  const granted: string[] = [];
  for (const c of conflicts) {
    if (c.kind === "leased") continue;
    const prev = sql.exec<{ n: number; at: number }>("SELECT n, at FROM starved WHERE agent = ? AND key = ?", req.agent, c.key).toArray()[0];
    const n = prev && at - prev.at < STARVED_WINDOW_MS ? prev.n + 1 : 1;
    sql.exec("INSERT OR REPLACE INTO starved (agent, key, n, at) VALUES (?, ?, ?, ?)", req.agent, c.key, n, at);
    m.starving.add(req.agent);
    if (n < STARVED_AFTER) continue;
    const held = sql.exec<{ agent: string; until: number }>("SELECT agent, until FROM leases WHERE key = ?", c.key).toArray()[0];
    if (held && held.agent !== req.agent && held.until > at) continue;
    sql.exec("INSERT OR REPLACE INTO leases (key, agent, until) VALUES (?, ?, ?)", c.key, req.agent, at + LEASE_MS);
    m.holding.add(req.agent);
    granted.push(c.key);
  }
  return granted;
}

/** Landing ends the agent's run of losses, and with it any lease. */
export function forgive(sql: SqlStorage, agent: string) {
  const m = marked(sql);
  if (!m.starving.has(agent)) return;
  sql.exec("DELETE FROM starved WHERE agent = ?", agent);
  sql.exec("DELETE FROM leases WHERE agent = ?", agent);
  m.starving.delete(agent);
  m.holding.delete(agent);
}
