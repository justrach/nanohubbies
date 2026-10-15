import type { AgentKind, Owner, RoomEvent } from "../types";
import { getMeta, type AgentState, type Person, type Totals } from "./store";

type Conflict = Extract<RoomEvent, { t: "conflict" }>;

/** What folding events needs from the rest of the room. */
export interface Fold {
  /** A change named an issue. */
  workedOn(number: number, agent: string, owner: Owner | null, change: string, version: number | null, outcome: string, at: number, closes: boolean): void;
  /** A real agent lost a conflict and should hear why. */
  mention(e: Conflict): void;
  /** Adds the event to the feed, after everything it caused. */
  emit(e: RoomEvent): void;
}

/** Folds events into the agents' states, the people's tallies, the counts per
 *  second and the totals, and returns the new totals. */
export function fold(sql: SqlStorage, events: RoomEvent[], room: Fold): Totals {
  const sum = totals(sql);
  for (const e of events) {
    switch (e.t) {
      case "life": {
        const prev = sql.exec<{ state: string }>("SELECT state FROM agents WHERE name = ?", e.agent).toArray()[0];
        if (prev?.state === "alive") sum.unpaid++;
        sql.exec(
          `INSERT INTO agents (name, kind, state, life, seen, owner_id, owner_name) VALUES (?, ?, 'alive', ?, ?, ?, ?)
           ON CONFLICT (name) DO UPDATE SET state = 'alive', life = excluded.life, seen = excluded.seen,
             owner_id = coalesce(excluded.owner_id, owner_id), owner_name = coalesce(excluded.owner_name, owner_name)`,
          e.agent,
          e.kind,
          e.life,
          e.at,
          e.owner?.id ?? null,
          e.owner?.name ?? null,
        );
        person(sql, e.owner, e.at, 0, 0, 0);
        break;
      }
      case "landed":
        ended(sql, e.agent, e.kind, e.owner, "settled", e.life, e.at, e.issue, 1, 0);
        person(sql, e.owner, e.at, 1, 0, 0);
        sum.landed++;
        count(sql, e.at, 1, 0, 0);
        if (e.issue != null) room.workedOn(e.issue, e.agent, e.owner, e.change, e.version, "landed", e.at, e.closes);
        break;
      case "conflict":
        ended(sql, e.agent, e.kind, e.owner, "reborn", e.life, e.at, e.issue, 0, 1);
        person(sql, e.owner, e.at, 0, 1, 0);
        sum.conflicts++;
        count(sql, e.at, 0, 1, 0);
        for (const k of e.keys) sql.exec("INSERT INTO hot (key, n) VALUES (?, 1) ON CONFLICT (key) DO UPDATE SET n = n + 1", k);
        clash(sql, e);
        if (e.issue != null) room.workedOn(e.issue, e.agent, e.owner, e.change, null, "conflict", e.at, false);
        if (e.kind === "agent") room.mention(e);
        break;
      case "rejected":
        ended(sql, e.agent, e.kind, e.owner, "stillborn", e.life, e.at, e.issue, 0, 0);
        person(sql, e.owner, e.at, 0, 0, 1);
        sum.rejected++;
        count(sql, e.at, 0, 0, 1);
        break;
      case "status":
        sql.exec(
          `INSERT INTO agents (name, kind, state, life, seen, intent, progress) VALUES (?, 'agent', 'alive', 0, ?, ?, ?)
           ON CONFLICT (name) DO UPDATE SET seen = excluded.seen, intent = excluded.intent, progress = excluded.progress`,
          e.agent,
          e.at,
          e.intent,
          e.progress,
        );
        break;
    }
    room.emit(e);
  }
  return sum;
}

export function totals(sql: SqlStorage): Totals {
  return getMeta<Totals>(sql, "totals") ?? { landed: 0, conflicts: 0, rejected: 0, unpaid: 0 };
}

export function people(sql: SqlStorage): Person[] {
  const agents = new Map(
    sql
      .exec<{ owner_id: string; n: number }>("SELECT owner_id, COUNT(*) AS n FROM agents WHERE owner_id IS NOT NULL GROUP BY owner_id")
      .toArray()
      .map((r) => [r.owner_id, r.n]),
  );
  const closed = new Map(
    sql
      .exec<{ owner_id: string; n: number }>(
        "SELECT a.owner_id, COUNT(*) AS n FROM issues i JOIN agents a ON a.name = i.closed_by WHERE i.state = 'closed' AND a.owner_id IS NOT NULL GROUP BY a.owner_id",
      )
      .toArray()
      .map((r) => [r.owner_id, r.n]),
  );
  return sql
    .exec<{ id: string; name: string; seen: number; landed: number; conflicts: number; rejected: number }>("SELECT * FROM people ORDER BY landed DESC LIMIT 100")
    .toArray()
    .map((p) => ({ ...p, agents: agents.get(p.id) ?? 0, closed: closed.get(p.id) ?? 0 }));
}

export function clashes(sql: SqlStorage): [string, string, number][] {
  return sql
    .exec<{ loser: string; winner: string; n: number }>("SELECT loser, winner, n FROM clashes ORDER BY n DESC LIMIT 100")
    .toArray()
    .map((r) => [r.loser, r.winner, r.n]);
}

export function hot(sql: SqlStorage): [string, number][] {
  return sql.exec<{ key: string; n: number }>("SELECT key, n FROM hot ORDER BY n DESC LIMIT 8").toArray().map((r) => [r.key, r.n]);
}

function ended(
  sql: SqlStorage,
  agent: string,
  kind: AgentKind,
  owner: Owner | null,
  state: AgentState,
  life: number,
  at: number,
  issue: number | null,
  landed: number,
  conflicts: number,
) {
  sql.exec(
    `INSERT INTO agents (name, kind, state, life, seen, landed, conflicts, owner_id, owner_name, issue) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (name) DO UPDATE SET state = excluded.state, life = excluded.life, seen = excluded.seen,
       landed = landed + excluded.landed, conflicts = conflicts + excluded.conflicts,
       owner_id = coalesce(excluded.owner_id, owner_id), owner_name = coalesce(excluded.owner_name, owner_name), issue = excluded.issue`,
    agent,
    kind,
    state,
    life,
    at,
    landed,
    conflicts,
    owner?.id ?? null,
    owner?.name ?? null,
    issue,
  );
}

function person(sql: SqlStorage, owner: Owner | null, at: number, landed: number, conflicts: number, rejected: number) {
  if (!owner) return;
  sql.exec(
    `INSERT INTO people (id, name, seen, landed, conflicts, rejected) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET name = excluded.name, seen = max(seen, excluded.seen), landed = landed + excluded.landed,
       conflicts = conflicts + excluded.conflicts, rejected = rejected + excluded.rejected`,
    owner.id,
    owner.name,
    at,
    landed,
    conflicts,
    rejected,
  );
}

function count(sql: SqlStorage, at: number, landed: number, conflicts: number, rejected: number) {
  sql.exec(
    `INSERT INTO seconds (sec, landed, conflicts, rejected) VALUES (?, ?, ?, ?)
     ON CONFLICT (sec) DO UPDATE SET landed = landed + excluded.landed, conflicts = conflicts + excluded.conflicts,
       rejected = rejected + excluded.rejected`,
    Math.floor(at / 1000),
    landed,
    conflicts,
    rejected,
  );
}

/** Counts a conflict once for each person whose change won it. */
function clash(sql: SqlStorage, e: Conflict) {
  const winners = new Set(e.winners.map((w) => sql.exec<{ owner_name: string | null }>("SELECT owner_name FROM agents WHERE name = ?", w.agent).toArray()[0]?.owner_name ?? ""));
  for (const winner of winners) {
    sql.exec("INSERT INTO clashes (loser, winner, n) VALUES (?, ?, 1) ON CONFLICT (loser, winner) DO UPDATE SET n = n + 1", e.owner?.name ?? "", winner);
  }
}
