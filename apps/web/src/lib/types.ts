// The shapes the Worker sends. Kept here, not imported from the Worker, so the
// web build never pulls in Worker-only modules.

export type AgentKind = "agent" | "scripted";
export type AgentState = "alive" | "settled" | "reborn" | "stillborn";
export type IssueState = "open" | "progress" | "closed";

export interface Owner {
  id: string;
  name: string;
}

type Who = { agent: string; kind: AgentKind; owner: Owner | null };

export type RoomEvent =
  | (Who & { t: "life"; life: number; base: number; at: number })
  | (Who & { t: "landed"; life: number; change: string; intent: string; base: number; version: number; revalidate: string[]; issue: number | null; closes: boolean; at: number })
  | (Who & {
      t: "conflict";
      life: number;
      change: string;
      intent: string;
      base: number;
      keys: string[];
      /** What it lost to. A winner with no change is an agent holding a lease. */
      winners: { agent: string; change: string; intent: string; version: number | null }[];
      /** Keys the losing agent now holds a lease on, having lost them before. */
      leased?: string[];
      issue: number | null;
      at: number;
    })
  | (Who & { t: "rejected"; life: number; change: string; error: string; issue: number | null; at: number })
  | { t: "status"; agent: string; intent: string; progress: string; at: number }
  | { t: "message"; id: number; from: string; to: string[]; body: string; delivered: boolean; at: number; replyTo?: number | null; handoffTo?: string | null; acknowledgements?: { agent: string; at: number }[] }
  | { t: "message_ack"; id: number; agent: string; at: number }
  | { t: "swarm"; state: "running" | "stopped"; agents: number; owner: Owner | null; at: number }
  | { t: "issue"; number: number; title: string; state: IssueState; by: string | null; version: number | null; heldBy?: string | null; at: number }
  | { t: "watchers"; watchers: Owner[]; at: number };

export interface Issue {
  number: number;
  title: string;
  body: string;
  origin: "github" | "local";
  upstream: "open" | "closed";
  state: IssueState;
  labels: { name: string; color: string }[];
  author: string;
  created: number;
  comments: number;
  url: string | null;
  landed: number;
  agents: number;
  closedBy: string | null;
  closedIn: number | null;
  /** The agent holding the issue, which scripted agents then leave alone. */
  heldBy: string | null;
}

export interface RepoInfo {
  contextUpdatedAt?: number;
  contextNotes?: string[];
  importSummary?: { files: number; skipped: number; notes: string[]; importedAt: number };
  fullName: string;
  description: string | null;
  url: string;
  stars: number;
  topics: string[];
  license: string | null;
  defaultBranch: string;
  commit: string | null;
  pulls: { number: number; title: string; author: string; branch: string; draft: boolean; url: string; created: number }[];
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

export type Sequenced = RoomEvent & { seq: number };
export type Message = Extract<RoomEvent, { t: "message" }>;

export interface Totals {
  landed: number;
  conflicts: number;
  rejected: number;
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

export interface Snapshot {
  roster: RegisteredAgent[];
  totals: Totals;
  agents: [string, AgentKind, AgentState, number, number, number, number, string, string | null, number | null][];
  events: Sequenced[];
  seconds: [number, number, number, number][];
  messages: Message[];
  swarms: SwarmState[];
  /** The keys agents conflict on most: [key, conflicts]. */
  hot: [string, number][];
  people: Person[];
  /** [whose agent re-planned, whose change won, conflicts]; "" is nobody's. */
  clashes: Clash[];
  issues: Issue[];
  repo: RepoInfo | null;
  watchers: Owner[];
  now: number;
}

export type Clash = [string, string, number];

export interface RegisteredAgent {
  id: string;
  handle: string;
  type: string;
  owner: Owner;
  status: "idle" | "working" | "blocked" | "offline";
  task: string;
  progress: string;
  registeredAt: number;
  heartbeatAt: number | null;
}

export interface Head {
  version: number;
  commit: string;
  tree: string;
}

export interface TrunkInfo {
  head: Head;
  tip: Head;
  mirror: { repo: string; remote: string; pushed: number } | null;
}

export interface TrunkListing {
  name: string;
  created: number;
  source: string;
  owner: string | null;
}
