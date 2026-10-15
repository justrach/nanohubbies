import type { Owner } from "../types";

export type Presence = "idle" | "working" | "blocked" | "offline";
export interface RegisteredAgent {
  id: string;
  handle: string;
  type: string;
  owner: Owner;
  status: Presence;
  task: string;
  progress: string;
  registeredAt: number;
  heartbeatAt: number | null;
}
type Row = {
  id: string;
  handle: string;
  type: string;
  owner_id: string;
  owner_name: string;
  status: Presence;
  task: string;
  progress: string;
  registered_at: number;
  heartbeat_at: number | null;
};

export function migrateRegistry(sql: SqlStorage) {
  sql.exec(`CREATE TABLE IF NOT EXISTS registered_agents (
    id TEXT PRIMARY KEY, handle TEXT NOT NULL UNIQUE, type TEXT NOT NULL,
    owner_id TEXT NOT NULL, owner_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'offline',
    task TEXT NOT NULL DEFAULT '', progress TEXT NOT NULL DEFAULT '', registered_at INTEGER NOT NULL, heartbeat_at INTEGER
  )`);
}

function view(r: Row): RegisteredAgent {
  return {
    id: r.id,
    handle: r.handle,
    type: r.type,
    owner: { id: r.owner_id, name: r.owner_name },
    status: r.status,
    task: r.task,
    progress: r.progress,
    registeredAt: r.registered_at,
    heartbeatAt: r.heartbeat_at,
  };
}
export function lookup(
  sql: SqlStorage,
  handle: string,
): RegisteredAgent | null {
  const row = sql
    .exec<Row>("SELECT * FROM registered_agents WHERE handle = ?", handle)
    .toArray()[0];
  return row ? view(row) : null;
}
export function roster(sql: SqlStorage): RegisteredAgent[] {
  return sql
    .exec<Row>(
      "SELECT * FROM registered_agents ORDER BY registered_at, handle LIMIT 1000",
    )
    .toArray()
    .map(view);
}
export function register(
  sql: SqlStorage,
  owner: Owner,
  handle: string,
  type: string,
): RegisteredAgent {
  if (
    !/^[a-z0-9][a-z0-9.-]{0,47}$/.test(handle) ||
    ["guest", "sequencer", "git"].includes(handle)
  )
    throw new Error(
      "handle must be 1–48 lowercase letters, numbers, dots or hyphens; system names are reserved",
    );
  if (!type.trim() || type.length > 80)
    throw new Error("agent type is required (at most 80 characters)");
  const existing = lookup(sql, handle);
  if (existing) {
    if (existing.owner.id !== owner.id)
      throw new Error("this handle is already registered to another owner");
    return existing;
  }
  if (
    sql.exec("SELECT name FROM agents WHERE name = ?", handle).toArray().length
  )
    throw new Error(
      "this handle is already in use by a legacy agent; choose a new handle",
    );
  const swarm = sql
    .exec<{
      prefix: string;
      agents: number;
    }>("SELECT prefix, agents FROM swarms WHERE until > ?", Date.now())
    .toArray();
  if (
    swarm.some((s) => {
      if (!handle.startsWith(`${s.prefix}-`)) return false;
      const index = handle.slice(s.prefix.length + 1);
      return /^\d{4,}$/.test(index) && Number(index) < s.agents;
    })
  )
    throw new Error(
      "this handle belongs to an active practice swarm; choose a new handle",
    );
  if (roster(sql).length >= 1000)
    throw new Error("this room has reached its registration limit");
  sql.exec(
    "INSERT INTO registered_agents (id, handle, type, owner_id, owner_name, registered_at) VALUES (?, ?, ?, ?, ?, ?)",
    crypto.randomUUID(),
    handle,
    type.trim(),
    owner.id,
    owner.name,
    Date.now(),
  );
  return lookup(sql, handle)!;
}
export function heartbeat(
  sql: SqlStorage,
  handle: string,
  status: Presence,
  task: string,
  progress: string,
): RegisteredAgent {
  if (!["idle", "working", "blocked", "offline"].includes(status))
    throw new Error("status must be idle, working, blocked or offline");
  if (
    typeof task !== "string" ||
    typeof progress !== "string" ||
    task.length > 512 ||
    progress.length > 256
  )
    throw new Error(
      "task must be at most 512 characters and progress at most 256",
    );
  sql.exec(
    "UPDATE registered_agents SET status = ?, task = ?, progress = ?, heartbeat_at = ? WHERE handle = ?",
    status,
    task,
    progress,
    Date.now(),
    handle,
  );
  const agent = lookup(sql, handle);
  if (!agent) throw new Error("register the agent first");
  return agent;
}
