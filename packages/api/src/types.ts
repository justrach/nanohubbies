/** An edit names a top-level symbol instead of a line range, so it still
 *  applies after unrelated changes land in the same file. */
export type Edit =
  | { op: "replace"; path: string; symbol: string; text: string }
  | { op: "insert"; path: string; after?: string; text: string }
  | { op: "delete"; path: string; symbol: string }
  | { op: "create"; path: string; text: string }
  | { op: "remove"; path: string }
  /** The whole file as the agent left it. It writes every symbol the file has
   *  now or will have, so it conflicts with any change to the file since the
   *  agent's base and never undoes one. */
  | { op: "write"; path: string; text: string };

/** A commit that came in with `git push`. When it lands as a fast-forward, the
 *  trunk keeps it as is, so the agent's history and the trunk's stay one. */
export interface Pushed {
  sha: string;
  /** The commit object's body, as git hashed it. */
  body: Uint8Array;
}

/** Footprint keys. A change conflicts with one that landed after its base
 *  when that change wrote a key this one read or wrote. */
export const key = {
  /** The definition of a top-level symbol. A file that is not code is one symbol, "*". */
  def: (path: string, name: string) => `d:${path}#${name}`,
  /** Whether a file exists. */
  path: (path: string) => `p:${path}`,
  /** The set of places that use a name. Adding or removing a use writes it;
   *  asking where a name is used, or changing what its users depend on, reads it. */
  refs: (name: string) => `r:${name}`,
};

/** What a session observed. Strong reads are exact: one symbol, one refs
 *  query. Weak reads come from reading a whole file, where the agent saw
 *  symbols it may not depend on. */
export interface Reads {
  strong: string[];
  weak: string[];
}

/** Scripted agents are the load generator; everything else is a real agent
 *  that the room talks to (a conflict becomes an @mention). */
export type AgentKind = "agent" | "scripted";

/** The person an agent works for. */
export interface Owner {
  id: string;
  name: string;
}

export interface ChangeRequest {
  id: string;
  agent: string;
  kind: AgentKind;
  owner: Owner | null;
  /** Which of the agent's lives (attempts) this change ends. */
  life: number;
  intent: string;
  base: number;
  reads: Reads;
  edits: Edit[];
  /** The issue this change works on, and whether landing it closes the issue. */
  issue: number | null;
  closes: boolean;
  pushed?: Pushed | null;
}

type Who = { agent: string; kind: AgentKind; owner: Owner | null };

/** What the room hears about and passes on to everyone watching. */
export type RoomEvent =
  | (Who & { t: "life"; life: number; base: number; at: number })
  | (Who & {
      t: "landed";
      life: number;
      change: string;
      intent: string;
      base: number;
      version: number;
      revalidate: string[];
      issue: number | null;
      closes: boolean;
      at: number;
    })
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

/** Open: nobody has landed anything for it. Progress: changes have landed.
 *  Closed: a change that closes it landed, or it was closed upstream. */
export type IssueState = "open" | "progress" | "closed";

export interface Issue {
  number: number;
  title: string;
  body: string;
  /** Where the issue came from: "github" (imported) or "local". */
  origin: "github" | "local";
  upstream: "open" | "closed";
  state: IssueState;
  labels: { name: string; color: string }[];
  author: string;
  created: number;
  comments: number;
  url: string | null;
  /** Landed changes that worked on it. */
  landed: number;
  /** Distinct agents with recent work on it. */
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

/** A key this change touched that a change landed after its base also wrote. */
export interface Overlap {
  key: string;
  /** "write" and "read" overlaps reject the change. "weak" ones let it land
   *  and ask for the result to be verified again. "leased" means another
   *  agent holds the key for a while (`by` names it), after losing it to
   *  other changes more than once. */
  kind: "write" | "read" | "weak" | "leased";
  by: string;
  version: number;
}

export interface Head {
  version: number;
  commit: string;
  tree: string;
}

export interface ChangeRecord {
  id: string;
  agent: string;
  intent: string;
  base: number;
  status: "landed" | "conflict" | "rejected";
  version: number | null;
  commit: string | null;
  overlaps: Overlap[];
  at: number;
}

export type SubmitResult =
  | { status: "landed"; id: string; version: number; commit: string; revalidate: Overlap[] }
  | { status: "conflict"; id: string; conflicts: Overlap[]; winners: ChangeRecord[] }
  | { status: "rejected"; id: string; error: string }
  /** Not admitted: the trunk's publishing is too far behind to take more. No
   *  decision was made and nothing was stored, so the change can be sent
   *  again, after `retryAfterMs`. */
  | { status: "busy"; id: string; retryAfterMs: number };

/** What a landing made, for the agent that made it and no one else: the
 *  version's root tree, and its new trees and blobs in loose form. The agent's
 *  next life can start on that version and read them from memory, without
 *  waiting for them to reach R2. */
export interface Made {
  tree: string;
  objects: { sha: string; raw: Uint8Array }[];
}

/** A result as the sequencer hands it to the agent's lane. */
export type Submitted = SubmitResult & { made?: Made };
