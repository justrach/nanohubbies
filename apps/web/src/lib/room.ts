import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentKind, AgentState, Clash, Issue, Message, Owner, Person, RegisteredAgent, RepoInfo, Sequenced, Snapshot, SwarmState, Totals } from "./types";

export interface AgentRow {
  name: string;
  kind: AgentKind;
  state: AgentState;
  life: number;
  /** Server time of the agent's last event. */
  seen: number;
  landed: number;
  conflicts: number;
  intent: string;
  /** The person the agent works for, if any. */
  owner: string | null;
  /** The issue it last worked on. */
  issue: number | null;
  /** Client time the state last changed, for the brief highlight on the wall. */
  changed: number;
}

export interface Second {
  landed: number;
  conflicts: number;
  rejected: number;
}

export interface RoomView {
  roster: RegisteredAgent[];
  status: "connecting" | "live" | "offline";
  totals: Totals;
  agents: Map<string, AgentRow>;
  /** Newest last. */
  feed: Sequenced[];
  seconds: Map<number, Second>;
  messages: Message[];
  swarms: SwarmState[];
  /** The keys agents conflict on most: [key, conflicts]. */
  hot: [string, number][];
  people: Person[];
  clashes: Clash[];
  issues: Map<number, Issue>;
  repo: RepoInfo | null;
  watchers: Owner[];
  /** Highest version seen landing. */
  version: number;
  /** Server clock minus client clock, in ms. */
  skew: number;
  /** Bumps on every update; use it as a memo dependency. */
  tick: number;
  post: (body: string) => void;
}

const FEED_CAP = 400;
const MESSAGE_CAP = 200;

type Data = Omit<RoomView, "tick" | "post">;

const empty = (): Data => ({
  roster: [],
  status: "connecting",
  totals: { landed: 0, conflicts: 0, rejected: 0, unpaid: 0 },
  agents: new Map(),
  feed: [],
  seconds: new Map(),
  messages: [],
  swarms: [],
  hot: [],
  people: [],
  clashes: [],
  issues: new Map(),
  repo: null,
  watchers: [],
  version: 0,
  skew: 0,
});

interface Frame {
  roster: RegisteredAgent[];
  events: Sequenced[];
  totals: Totals;
  swarms: SwarmState[];
  hot: [string, number][];
  people: Person[];
  clashes: Clash[];
  watchers: Owner[];
  now: number;
}

/** The room's live feed for one trunk: a snapshot on connect, then frames of
 *  events folded into the same state. Reconnects with backoff; a reconnect
 *  starts again from a fresh snapshot. The browser's session cookie goes with
 *  the socket, so the room knows who is watching. */
export function useRoom(trunk: string): RoomView {
  const data = useRef<Data>(empty());
  const socket = useRef<WebSocket | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    data.current = empty();
    let closed = false;
    let retry = 0;
    let timer: number | undefined;
    const bump = () => setTick((t) => t + 1);

    const connect = () => {
      const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/trunks/${encodeURIComponent(trunk)}/live`);
      socket.current = ws;
      ws.onmessage = (m) => {
        const frame = JSON.parse(m.data as string);
        if (frame.type === "snapshot") applySnapshot(data.current, frame as Snapshot);
        else if (frame.type === "events") applyFrame(data.current, frame as Frame);
        data.current.status = "live";
        retry = 0;
        bump();
      };
      ws.onclose = () => {
        if (closed) return;
        data.current.status = "offline";
        bump();
        timer = window.setTimeout(connect, Math.min(10_000, 500 * 2 ** retry++));
      };
      ws.onerror = () => ws.close();
    };
    connect();
    return () => {
      closed = true;
      window.clearTimeout(timer);
      socket.current?.close();
    };
  }, [trunk]);

  const post = useCallback((body: string) => {
    socket.current?.send(JSON.stringify({ type: "post", body }));
  }, []);

  return { ...data.current, tick, post };
}

function applySnapshot(d: Data, s: Snapshot) {
  d.roster = s.roster ?? [];
  const now = Date.now();
  d.totals = s.totals;
  d.swarms = s.swarms;
  d.hot = s.hot;
  d.people = s.people;
  d.clashes = s.clashes;
  d.repo = s.repo;
  d.watchers = s.watchers;
  d.skew = s.now - now;
  d.agents = new Map(
    s.agents.map(([name, kind, state, life, seen, landed, conflicts, intent, owner, issue]) => [
      name,
      { name, kind, state, life, seen, landed, conflicts, intent, owner, issue, changed: 0 },
    ]),
  );
  d.issues = new Map(s.issues.map((i) => [i.number, i]));
  d.seconds = new Map(s.seconds.map(([sec, landed, conflicts, rejected]) => [sec, { landed, conflicts, rejected }]));
  d.feed = s.events.filter((e) => e.t !== "status" && e.t !== "watchers");
  d.messages = s.messages;
  d.version = Math.max(0, ...s.events.map((e) => (e.t === "landed" ? e.version : 0)));
}

function applyFrame(d: Data, frame: Frame) {
  d.roster = frame.roster ?? d.roster;
  const now = Date.now();
  d.totals = frame.totals;
  d.swarms = frame.swarms;
  d.hot = frame.hot;
  d.people = frame.people;
  d.clashes = frame.clashes;
  d.watchers = frame.watchers;
  d.skew = frame.now - now;
  for (const e of frame.events) {
    switch (e.t) {
      case "life":
        upsert(d, e.agent, e.kind, e.owner?.name ?? null, now, (a) => {
          a.state = "alive";
          a.life = e.life;
          a.seen = e.at;
        });
        break;
      case "landed":
        upsert(d, e.agent, e.kind, e.owner?.name ?? null, now, (a) => {
          a.state = "settled";
          a.life = e.life;
          a.seen = e.at;
          a.landed++;
          a.issue = e.issue;
        });
        count(d, e.at, "landed");
        d.version = Math.max(d.version, e.version);
        if (e.issue != null) {
          const i = d.issues.get(e.issue);
          if (i) i.landed++;
        }
        break;
      case "conflict":
        upsert(d, e.agent, e.kind, e.owner?.name ?? null, now, (a) => {
          a.state = "reborn";
          a.life = e.life;
          a.seen = e.at;
          a.conflicts++;
          a.issue = e.issue;
        });
        count(d, e.at, "conflicts");
        break;
      case "rejected":
        upsert(d, e.agent, e.kind, e.owner?.name ?? null, now, (a) => {
          a.state = "stillborn";
          a.life = e.life;
          a.seen = e.at;
        });
        count(d, e.at, "rejected");
        break;
      case "status":
        upsert(d, e.agent, "agent", null, now, (a) => {
          a.seen = e.at;
          a.intent = e.intent;
        });
        break;
      case "message":
        d.messages.push(e);
        if (d.messages.length > MESSAGE_CAP) d.messages.splice(0, d.messages.length - MESSAGE_CAP);
        break;
      case "message_ack": {
        const message = d.messages.find((m) => m.id === e.id);
        if (message) message.acknowledgements = [...(message.acknowledgements ?? []).filter((a) => a.agent !== e.agent), { agent: e.agent, at: e.at }];
        break;
      }
      case "issue": {
        const i = d.issues.get(e.number);
        if (i) {
          i.state = e.state;
          if (e.heldBy !== undefined) i.heldBy = e.heldBy;
          if (e.state === "closed") {
            i.closedBy = e.by;
            i.closedIn = e.version;
          }
        } else {
          // Opened while we watched: the rest of it arrives on the next snapshot or fetch.
          d.issues.set(e.number, {
            number: e.number,
            title: e.title,
            body: "",
            origin: "local",
            upstream: "open",
            state: e.state,
            labels: [],
            author: e.by ?? "",
            created: e.at,
            comments: 0,
            url: null,
            landed: 0,
            agents: 0,
            closedBy: null,
            closedIn: null,
            heldBy: e.heldBy ?? null,
          });
        }
        break;
      }
    }
    if (e.t !== "status" && e.t !== "watchers") d.feed.push(e);
  }
  if (d.feed.length > FEED_CAP) d.feed.splice(0, d.feed.length - FEED_CAP);
}

function upsert(d: Data, name: string, kind: AgentKind, owner: string | null, now: number, change: (a: AgentRow) => void) {
  let a = d.agents.get(name);
  if (!a) {
    a = { name, kind, state: "alive", life: 0, seen: 0, landed: 0, conflicts: 0, intent: "", owner, issue: null, changed: now };
    d.agents.set(name, a);
  }
  if (owner) a.owner = owner;
  const before = a.state;
  change(a);
  if (a.state !== before || a.state !== "alive") a.changed = now;
}

function count(d: Data, at: number, field: keyof Second) {
  const sec = Math.floor(at / 1000);
  const s = d.seconds.get(sec) ?? { landed: 0, conflicts: 0, rejected: 0 };
  s[field]++;
  d.seconds.set(sec, s);
  if (d.seconds.size > 900) {
    const oldest = Math.min(...d.seconds.keys());
    d.seconds.delete(oldest);
  }
}
