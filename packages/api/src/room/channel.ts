import type { RoomEvent } from "../types";
import type { Emit } from "./store";
import { lookup } from "./registry";

/** A chain of replies stops routing to inboxes after this many hops, so two agents
 *  cannot keep @mentioning each other forever. A chain cools off after the
 *  window, and the next message starts at zero again. */
const MAX_HOPS = 6;
const HOP_WINDOW_MS = 600_000;

/** Posts to the trunk's channel. Every @name in the body is a recipient. */
export function post(sql: SqlStorage, emit: Emit, from: string, body: string, context: { replyTo?: number; handoffTo?: string } = {}): RoomEvent {
  if (typeof body !== "string" || body.length > 4000) throw new Error("message must be at most 4000 characters");
  const text = body.trim().slice(0, 4000);
  if (!text) throw new Error("empty message");
  const to = [...new Set([...text.matchAll(/@([A-Za-z0-9][\w.-]{0,63})/g)].map((m) => m[1]))].filter((n) => n !== from);
  if (context.replyTo !== undefined) {
    if (!Number.isSafeInteger(context.replyTo)) throw new Error("replyTo must name an existing message");
    const parent = sql.exec<{ sender: string }>("SELECT sender FROM messages WHERE id = ?", context.replyTo).toArray()[0];
    if (!parent) throw new Error("replyTo must name an existing message");
    if (parent.sender !== from && lookup(sql, parent.sender) && !to.includes(parent.sender)) to.push(parent.sender);
  }
  if (context.handoffTo !== undefined) {
    if (!lookup(sql, context.handoffTo) || context.handoffTo === from) throw new Error("handoffTo must name another registered agent");
    if (!to.includes(context.handoffTo)) to.push(context.handoffTo);
  }
  // A reply is one hop further than the newest recent message to its sender.
  const prior = sql
    .exec<{ hops: number }>(
      "SELECT hops FROM messages WHERE at > ? AND (',' || recipients || ',') LIKE ? ORDER BY id DESC LIMIT 1",
      Date.now() - HOP_WINDOW_MS,
      `%,${from},%`,
    )
    .toArray()[0];
  return record(sql, emit, from, to, text, prior ? prior.hops + 1 : 0, context);
}

/** Messages after `after`, optionally only those that reached `forAgent`. */
export function messages(sql: SqlStorage, after = 0, forAgent: string | null = null, limit = 100): RoomEvent[] {
  return sql
    .exec<{ id: number; sender: string; recipients: string; body: string; delivered: number; at: number }>(
      `SELECT * FROM messages WHERE id > ? ${forAgent ? "AND delivered = 1 AND (',' || recipients || ',') LIKE ?" : ""}
       ORDER BY id ${forAgent ? "ASC" : "DESC"} LIMIT ?`,
      ...(forAgent ? [after, `%,${forAgent},%`, limit] : [after, limit]),
    )
    .toArray()
    .map((m, index, all) => forAgent ? m : all[all.length - index - 1])
    .map((m) => {
      const context = sql.exec<{ reply_to: number | null; handoff_to: string | null }>("SELECT reply_to, handoff_to FROM message_context WHERE message = ?", m.id).toArray()[0];
      const acknowledgements = sql.exec<{ agent: string; at: number }>("SELECT agent, at FROM message_ack WHERE message = ? ORDER BY at", m.id).toArray();
      return { t: "message", id: m.id, from: m.sender, to: m.recipients ? m.recipients.split(",") : [], body: m.body, delivered: !!m.delivered, at: m.at, replyTo: context?.reply_to ?? null, handoffTo: context?.handoff_to ?? null, acknowledgements };
    });
}

export function acknowledge(sql: SqlStorage, emit: Emit, id: number, agent: string) {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("message id must be a positive integer");
  const found = sql.exec("SELECT id FROM messages WHERE id = ? AND delivered = 1 AND (',' || recipients || ',') LIKE ?", id, `%,${agent},%`).toArray()[0];
  if (!found) throw new Error("only a recipient can acknowledge a message eligible for its inbox");
  sql.exec("INSERT OR IGNORE INTO message_ack (message, agent, at) VALUES (?, ?, ?)", id, agent, Date.now());
  const at = sql.exec<{ at: number }>("SELECT at FROM message_ack WHERE message = ? AND agent = ?", id, agent).one().at;
  emit({ t: "message_ack", id, agent, at });
  return { id, agent, at };
}

/** Tells the agent that lost a conflict what won, so it can re-plan, and that
 *  a key it keeps losing is now held for it. */
export function mention(sql: SqlStorage, emit: Emit, e: Extract<RoomEvent, { t: "conflict" }>) {
  const won = e.winners.map((w) => (w.change ? `${w.agent}'s "${w.intent}"${w.version ? ` (v${w.version})` : ""}` : `${w.agent}'s lease`)).join(", ");
  const list = (keys: string[]) => keys.slice(0, 3).join(", ") + (keys.length > 3 ? `, and ${keys.length - 3} more` : "");
  const lease = e.leased?.length ? ` You keep losing ${list(e.leased)}, so it is held for you for a minute: other changes to it wait until you land.` : "";
  record(sql, emit, "sequencer", [e.agent], `@${e.agent} your change "${e.intent}" conflicts with ${won || "a newer change"} on ${list(e.keys)}. Re-plan on the current trunk.${lease}`, 0);
}

function record(sql: SqlStorage, emit: Emit, from: string, to: string[], body: string, hops: number, context: { replyTo?: number; handoffTo?: string } = {}): RoomEvent {
  const at = Date.now();
  const delivered = hops <= MAX_HOPS;
  const id = sql
    .exec<{ id: number }>(
      "INSERT INTO messages (sender, recipients, body, hops, delivered, at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
      from,
      to.join(","),
      body,
      hops,
      delivered ? 1 : 0,
      at,
    )
    .one().id;
  sql.exec("INSERT INTO message_context (message, reply_to, handoff_to) VALUES (?, ?, ?)", id, context.replyTo ?? null, context.handoffTo ?? null);
  const event: RoomEvent = { t: "message", id, from, to, body, delivered, at, replyTo: context.replyTo ?? null, handoffTo: context.handoffTo ?? null, acknowledgements: [] };
  emit(event);
  return event;
}
