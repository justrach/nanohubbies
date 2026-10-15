import { DurableObject } from "cloudflare:workers";
import type { PackInfo } from "./objects";
import type { AgentKind, ChangeRequest, Head, Owner, Submitted } from "./types";

/** A life an agent started, for the room, and the version it started on. */
export interface Started {
  agent: string;
  kind: AgentKind;
  owner: Owner | null;
  life: number;
  base: number;
  at: number;
}

/** What a batch brings back: each change's result, and the trunk as the
 *  sequencer left it, so the lane can start lives without asking again. */
export interface Landed {
  results: Submitted[];
  tip: Head;
  published: Head;
}

/** Lanes per trunk. An agent always goes through the same one. */
const LANES = 8;
/** How long a lane trusts what it last heard from the sequencer. */
const FRESH_MS = 250;

export function laneFor(env: Env, trunk: string, agent: string) {
  let h = 0;
  for (let i = 0; i < agent.length; i++) h = (h * 31 + agent.charCodeAt(i)) | 0;
  return env.LANE.get(env.LANE.idFromName(`${trunk}#${(h >>> 0) % LANES}`));
}

interface Waiting {
  req: ChangeRequest;
  resolve: (r: Submitted) => void;
  reject: (e: unknown) => void;
}

/** Between a trunk's agents and its sequencer. A Durable Object answers about
 *  a thousand calls a second however little each asks, so a landing must not
 *  cost the sequencer a call or two of its own. A lane sends its agents'
 *  changes in batches, one batch at a time, gathering the next while one is
 *  out; it starts lives on the newest version it heard of; and it keeps the
 *  pack list for a moment. Nothing here is stored: a lane only relays. */
export class Lane extends DurableObject<Env> {
  private trunk = "";
  private queue: Waiting[] = [];
  private lives: Started[] = [];
  private sending: Promise<void> | null = null;
  /** The tip and the published head, as the last batch's answer gave them. */
  private heard: { tip: Head; published: Head; at: number } | null = null;
  private listed: { packs: PackInfo[]; through: number; at: number } | null = null;
  private listing: Promise<PackInfo[]> | null = null;

  async submit(trunk: string, req: ChangeRequest): Promise<Submitted> {
    this.trunk = trunk;
    const result = new Promise<Submitted>((resolve, reject) => this.queue.push({ req, resolve, reject }));
    void this.pump();
    return result;
  }

  /** The version a new life starts on: the newest published one this lane
   *  heard of, or, when that is older than the agent's own last landing
   *  (`atLeast`), that landing (`own`), whose objects the agent holds. Without
   *  it, the newest landed version, which came back through here and may
   *  still be publishing; reads then wait for it. */
  async startLife(trunk: string, life: Omit<Started, "base"> | null, atLeast: number, own: Head | null = null): Promise<Head> {
    this.trunk = trunk;
    let heard = this.fresh();
    if (!heard || heard.tip.version < atLeast) {
      if (this.sending) await this.sending;
      heard = this.fresh();
      if (!heard || heard.tip.version < atLeast) {
        await this.pump();
        heard = this.fresh();
        if (!heard) throw new Error("the trunk's sequencer did not answer");
      }
    }
    const head = heard.published.version >= atLeast ? heard.published : own && own.version >= atLeast ? own : heard.tip;
    if (life) {
      this.lives.push({ ...life, base: head.version });
      void this.pump();
    }
    return head;
  }

  /** Resolves once `version` is published, for a life about to read it. While
   *  batches are going out, their answers say how far publishing got. */
  async published(trunk: string, version: number): Promise<void> {
    this.trunk = trunk;
    if ((this.fresh()?.published.version ?? 0) >= version) return;
    if (this.sending) {
      await this.sending;
      if ((this.fresh()?.published.version ?? 0) >= version) return;
    }
    await this.sequencer().whenPublished(version);
  }

  /** The trunk's packs, as the packer listed them a moment ago, holding every
   *  object of `atLeast` and older versions. */
  async packs(trunk: string, atLeast: number): Promise<PackInfo[]> {
    this.trunk = trunk;
    // A listing already under way may predate `atLeast`: then list again.
    for (let i = 0; i < 2; i++) {
      const l = this.listed;
      if (l && l.through >= atLeast && Date.now() - l.at < FRESH_MS) return l.packs;
      this.listing ??= this.env.PACKER.get(this.env.PACKER.idFromName(trunk))
        .list()
        .then((got) => {
          this.listed = { ...got, at: Date.now() };
          return got.packs;
        })
        .finally(() => {
          this.listing = null;
        });
      await this.listing;
    }
    return this.listed?.packs ?? [];
  }

  private fresh() {
    return this.heard && Date.now() - this.heard.at < FRESH_MS ? this.heard : null;
  }

  /** Sends what has gathered, one batch at a time. Resolves when the batch
   *  that is out now, or the one this starts, is answered. */
  private pump(): Promise<void> {
    this.sending ??= this.send().finally(() => {
      this.sending = null;
      if (this.queue.length || this.lives.length) void this.pump();
    });
    return this.sending;
  }

  private async send() {
    const batch = this.queue.splice(0);
    const lives = this.lives.splice(0);
    try {
      const out = await this.sequencer().land(
        batch.map((w) => w.req),
        lives,
      );
      this.heard = { tip: out.tip, published: out.published, at: Date.now() };
      batch.forEach((w, i) => w.resolve(out.results[i]));
    } catch (e) {
      // The lives go unannounced: the room is a view, and the agents learn
      // their changes failed and try again.
      for (const w of batch) w.reject(e);
    }
  }

  private sequencer() {
    return this.env.SEQUENCER.get(this.env.SEQUENCER.idFromName(this.trunk));
  }
}
