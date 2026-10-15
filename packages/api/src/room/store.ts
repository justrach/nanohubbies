import type { AgentKind, Issue, Owner, RepoInfo, RoomEvent } from "../types";
import { migrateRegistry, type RegisteredAgent } from "./registry";

// agents      every agent seen: its newest state, owner, issue, and counts
// people      every person whose agents did something, with their tallies
// events      the newest events, replayed to anyone who joins
// seconds     landings, conflicts and rejections per second
// messages    the trunk's channel
// hot         conflicts per footprint key: where agents collide
// issues      work items, imported from GitHub or opened here
// issue_work  every change that named an issue, landed or not
// swarms      scripted agents running on the trunk, one swarm per person
// clashes     conflicts between people: whose agent re-planned, whose change won
// claims      which agent is on which issue: hints for handing out work, not locks
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS agents (
    name TEXT PRIMARY KEY, kind TEXT NOT NULL, state TEXT NOT NULL, life INTEGER NOT NULL, seen INTEGER NOT NULL,
    landed INTEGER NOT NULL DEFAULT 0, conflicts INTEGER NOT NULL DEFAULT 0,
    intent TEXT NOT NULL DEFAULT '', progress TEXT NOT NULL DEFAULT '',
    owner_id TEXT, owner_name TEXT, issue INTEGER
  );
  CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, seen INTEGER NOT NULL,
    landed INTEGER NOT NULL DEFAULT 0, conflicts INTEGER NOT NULL DEFAULT 0, rejected INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS seconds (sec INTEGER PRIMARY KEY, landed INTEGER NOT NULL, conflicts INTEGER NOT NULL, rejected INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, sender TEXT NOT NULL, recipients TEXT NOT NULL, body TEXT NOT NULL,
    hops INTEGER NOT NULL, delivered INTEGER NOT NULL, at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS hot (key TEXT PRIMARY KEY, n INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS message_context (message INTEGER PRIMARY KEY, reply_to INTEGER, handoff_to TEXT);
  CREATE TABLE IF NOT EXISTS message_ack (message INTEGER NOT NULL, agent TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (message, agent));
  CREATE TABLE IF NOT EXISTS issues (
    number INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, origin TEXT NOT NULL, upstream TEXT NOT NULL,
    state TEXT NOT NULL, labels TEXT NOT NULL, author TEXT NOT NULL, created INTEGER NOT NULL, comments INTEGER NOT NULL,
    url TEXT, landed INTEGER NOT NULL DEFAULT 0, closed_by TEXT, closed_in INTEGER
  );
  CREATE TABLE IF NOT EXISTS issue_work (
    issue INTEGER NOT NULL, agent TEXT NOT NULL, owner TEXT, change TEXT NOT NULL, version INTEGER, outcome TEXT NOT NULL, at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS issue_work_by_issue ON issue_work (issue, at);
  CREATE TABLE IF NOT EXISTS swarms (
    owner_id TEXT PRIMARY KEY, owner_name TEXT NOT NULL, prefix TEXT NOT NULL, agents INTEGER NOT NULL, drivers INTEGER NOT NULL,
    shared REAL NOT NULL, started INTEGER NOT NULL, until INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS clashes (loser TEXT NOT NULL, winner TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (loser, winner));
  CREATE TABLE IF NOT EXISTS claims (agent TEXT PRIMARY KEY, issue INTEGER NOT NULL, owner TEXT, at INTEGER NOT NULL, held INTEGER NOT NULL DEFAULT 0)
`;

export type AgentState = "alive" | "settled" | "reborn" | "stillborn";
export type Sequenced = RoomEvent & { seq: number };

/** Adds an event to the room's feed, for replay and for everyone watching. */
export type Emit = (e: RoomEvent) => void;

export interface Totals {
  landed: number;
  conflicts: number;
  rejected: number;
  /** Lives that ended without submitting anything. */
  unpaid: number;
}

export interface SwarmState {
  owner: Owner;
  prefix: string;
  running: boolean;
  agents: number;
  drivers: number;
  shared: number;
  started: number;
  until: number;
}

export interface Person {
  id: string;
  name: string;
  seen: number;
  landed: number;
  conflicts: number;
  rejected: number;
  agents: number;
  /** Issues their agents closed. */
  closed: number;
}

export interface Snapshot {
  roster: RegisteredAgent[];
  totals: Totals;
  /** [name, kind, state, life, seen, landed, conflicts, intent, owner name, issue] */
  agents: [string, AgentKind, AgentState, number, number, number, number, string, string | null, number | null][];
  events: Sequenced[];
  /** [unix second, landed, conflicts, rejected] */
  seconds: [number, number, number, number][];
  messages: RoomEvent[];
  swarms: SwarmState[];
  /** The keys agents conflict on most: [key, conflicts]. */
  hot: [string, number][];
  people: Person[];
  /** [whose agent re-planned, whose change won, conflicts]; "" is nobody's. */
  clashes: [string, string, number][];
  issues: Issue[];
  repo: RepoInfo | null;
  watchers: Owner[];
  now: number;
}

export function migrate(sql: SqlStorage) {
  for (const stmt of SCHEMA.split(";")) if (stmt.trim()) sql.exec(stmt);
  migrateRegistry(sql);
}

export function getMeta<T>(sql: SqlStorage, k: string): T | undefined {
  const row = sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = ?", k).toArray()[0];
  return row ? (JSON.parse(row.v) as T) : undefined;
}

export function setMeta(sql: SqlStorage, k: string, v: unknown) {
  sql.exec("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", k, JSON.stringify(v));
}
