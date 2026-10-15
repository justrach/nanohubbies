import { DurableObject } from "cloudflare:workers";
import type { Owner, SubmitResult } from "./types";

export interface SwarmPlan {
  trunk: string;
  /** The person the bots work for. */
  owner: Owner;
  bots: string[];
  until: number;
  /** Chance that a life edits a shared function instead of the bot's own file. */
  shared: number;
  /** Zipf exponent over the shared functions: higher means hotter hot spots. */
  skew: number;
  /** Think time between a bot's lives, in ms. */
  think: [number, number];
  targets: { path: string; name: string }[];
}

interface Bot {
  name: string;
  next: number;
  busy: boolean;
  /** Functions in the bot's own file, or null until learned from the trunk. */
  fns: number | null;
  /** The issue the bot claimed: how many changes for it have landed, as far
   *  as this driver knows, how many finish it, and how many more of its own
   *  the bot makes before handing the issue on. */
  issue: { number: number; title: string; landed: number; needs: number; shift: number } | null;
  /** Whether the bot's last life failed, perhaps after submitting: its agent
   *  starts no new life until that submission has its decision. */
  unresolved: boolean;
}

/** One alarm runs the scheduler this long, launching bots as they come due.
 *  Long slices: the gap before the next alarm fires would otherwise hold back
 *  every bot that comes due in it, and they would all start at once after. */
const SLICE_MS = 30_000;
const POLL_MS = 50;
const MAX_IN_FLIGHT = 40;
/** How often the driver asks the room which issues are open and how far along. */
const AGENDA_MS = 5000;
/** Bots on one issue at a time, whoever's swarm they belong to. */
const PER_ISSUE = 4;
/** After the room has no issue to hand out, wait this long before asking again. */
const CLAIM_BACKOFF_MS = 3000;

/** Drives a shard of scripted agents for one person. Each bot loops through
 *  lives: start one, read what it is about to change, submit an edit, think,
 *  repeat. When the trunk has open issues, a bot claims the least crowded one
 *  from the room and names it in its changes until enough have landed; the
 *  change that finishes it closes it. Bots without an issue do chores. Most
 *  lives edit the bot's own file; some edit a shared function, which is where
 *  bots collide. Ticks run from alarms, so a long swarm never holds a request
 *  open. */
export class Driver extends DurableObject<Env> {
  private plan: SwarmPlan | null = null;
  private bots = new Map<string, Bot>();
  /** Cumulative Zipf weights over plan.targets. */
  private weights: number[] = [];
  private inFlight = 0;
  /** Lives under way, which a slice waits for: ending it would cancel their calls. */
  private running = new Set<Promise<void>>();
  private agendaAt = 0;
  private claimsAfter = 0;

  async start(plan: SwarmPlan) {
    await this.ctx.storage.put("plan", plan);
    this.load(plan);
    await this.ctx.storage.setAlarm(Date.now() + 10);
  }

  async stop() {
    const plan = this.plan ?? (await this.ctx.storage.get<SwarmPlan>("plan"));
    if (!plan) return;
    this.plan = { ...plan, until: 0 };
    await this.ctx.storage.put("plan", this.plan);
    await this.ctx.storage.deleteAlarm();
  }

  async alarm() {
    if (!this.plan) {
      const plan = await this.ctx.storage.get<SwarmPlan>("plan");
      if (!plan) return;
      this.load(plan);
    }
    // Each bot starts its next life on its own schedule. Waiting for a whole
    // batch of lives before starting more would march every bot in lockstep,
    // which no real fleet does.
    const end = Date.now() + SLICE_MS;
    while (Date.now() < end && Date.now() < this.plan!.until) {
      const plan = this.plan!;
      if (Date.now() - this.agendaAt > AGENDA_MS) await this.refreshAgenda(plan);
      const now = Date.now();
      let room = MAX_IN_FLIGHT - this.inFlight;
      for (const bot of this.bots.values()) {
        if (room <= 0) break;
        if (bot.busy || bot.next > now) continue;
        room--;
        this.inFlight++;
        const life: Promise<void> = this.live(plan, bot).finally(() => {
          this.inFlight--;
          this.running.delete(life);
        });
        this.running.add(life);
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    // The lives this slice started finish within it: when the alarm returns,
    // calls still out would be cancelled, leaving their outcomes unknown.
    await Promise.allSettled([...this.running]);
    if (Date.now() < this.plan!.until) await this.ctx.storage.setAlarm(Date.now() + 10);
  }

  private load(plan: SwarmPlan) {
    this.plan = plan;
    const now = Date.now();
    // Bots start spread over one think time, not all at once.
    this.bots = new Map(plan.bots.map((name) => [name, { name, next: now + Math.random() * plan.think[1], busy: false, fns: null, issue: null, unresolved: true }]));
    let sum = 0;
    this.weights = plan.targets.map((_, i) => (sum += 1 / Math.pow(i + 1, plan.skew)));
  }

  /** Catches the bots up on their issues: changes other bots landed for them,
   *  and issues someone closed or an agent took, which their bots drop. */
  private async refreshAgenda(plan: SwarmPlan) {
    this.agendaAt = Date.now();
    const agenda = await this.room(plan).agenda(500).catch(() => null);
    if (!agenda) return;
    const open = new Map(agenda.filter((i) => !i.heldBy).map((i) => [i.number, i.landed]));
    for (const bot of this.bots.values()) {
      if (!bot.issue) continue;
      const landed = open.get(bot.issue.number);
      if (landed === undefined) bot.issue = null;
      else bot.issue.landed = Math.max(bot.issue.landed, landed);
    }
  }

  /** Claims the least crowded open issue for a bot, if one has room. */
  private async claim(plan: SwarmPlan, bot: Bot): Promise<Bot["issue"]> {
    if (Date.now() < this.claimsAfter) return null;
    const got = await this.room(plan).claim(bot.name, plan.owner.id, PER_ISSUE);
    if (!got) {
      this.claimsAfter = Date.now() + CLAIM_BACKOFF_MS;
      return null;
    }
    // Fifteen to forty landed changes finish an issue, fixed per issue; a bot
    // makes three to six of them, then hands the issue on.
    return { ...got, needs: 15 + ((got.number * 37) % 26), shift: 3 + Math.floor(Math.random() * 4) };
  }

  private room(plan: SwarmPlan) {
    return this.env.ROOM.get(this.env.ROOM.idFromName(plan.trunk));
  }

  private async live(plan: SwarmPlan, bot: Bot) {
    bot.busy = true;
    // Set when the trunk turned a change away for now: the bot waits that long first.
    let wait = 0;
    try {
      const agent = this.env.AGENT.get(this.env.AGENT.idFromName(`${plan.trunk}/${bot.name}`));
      if (bot.unresolved) {
        // The last life's submission may have landed with its answer lost:
        // sending it again replays the decision. Then the bot's own file is
        // read again, not guessed.
        const settled = await agent.settle();
        bot.unresolved = false;
        bot.fns = null;
        if (settled?.status === "busy") {
          wait = settled.retryAfterMs;
          return;
        }
      }
      const { life } = await agent.start(plan.trunk, bot.name, "scripted", plan.owner);
      const own = `src/swarm/${bot.name.slice(0, -2)}/${bot.name}.js`;
      if (bot.fns === null) {
        // First life since this driver loaded: learn how far the bot's own file got.
        bot.fns = (await agent.fileIfAny(own))?.symbols.length ?? 0;
      }
      bot.issue ??= await this.claim(plan, bot);
      const issue = bot.issue;
      const closes = !!issue && issue.landed + 1 >= issue.needs;
      const opts = { issue: issue?.number ?? null, closes };
      const label = (what: string) => (issue ? `#${issue.number} ${issue.title.slice(0, 60)}: ${what}` : what);

      let result: SubmitResult;
      if (plan.targets.length && Math.random() < plan.shared) {
        const target = plan.targets[this.pick()];
        const { text } = await agent.symbol(target.path, target.name);
        result = await agent.submit(label(`touch ${target.name}`), [{ op: "replace", path: target.path, symbol: target.name, text: touch(text, bot.name, life) }], opts);
      } else if (bot.fns === 0) {
        result = await agent.submit(label(`start ${bot.name}`), [{ op: "create", path: own, text: `${task(1, life)}\n` }], opts);
        if (result.status === "landed") bot.fns = 1;
      } else if (Math.random() < 0.6) {
        const n = 1 + Math.floor(Math.random() * bot.fns);
        await agent.symbol(own, `task${n}`);
        result = await agent.submit(label(`rework task${n}`), [{ op: "replace", path: own, symbol: `task${n}`, text: task(n, life) }], opts);
      } else {
        result = await agent.submit(label(`add task${bot.fns + 1}`), [{ op: "insert", path: own, text: task(bot.fns + 1, life) }], opts);
        if (result.status === "landed") bot.fns += 1;
      }
      if (result.status === "busy") {
        wait = result.retryAfterMs;
        return;
      }
      if (result.status === "landed" && issue) {
        issue.landed++;
        if (closes || --issue.shift <= 0) bot.issue = null;
      }
      // A rejected edit means the bot's idea of its own file drifted.
      if (result.status === "rejected") bot.fns = null;
    } catch (e) {
      console.error(`${bot.name}: ${e instanceof Error ? e.message : String(e)}`);
      bot.fns = null;
      bot.unresolved = true;
    } finally {
      bot.busy = false;
      bot.next = Date.now() + wait + plan.think[0] + Math.random() * (plan.think[1] - plan.think[0]);
    }
  }

  /** A target index, drawn from the Zipf weights. */
  private pick(): number {
    const r = Math.random() * this.weights[this.weights.length - 1];
    let lo = 0;
    let hi = this.weights.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.weights[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}

/** Marks a shared function as touched with a comment line above it. The code
 *  itself never changes, so however many bots touch it, the trunk still runs. */
function touch(text: string, bot: string, life: number) {
  return `// touched by ${bot}, life ${life}\n${text.replace(/^\/\/ touched by .*\n/, "")}`;
}

function task(n: number, life: number) {
  return `export function task${n}() {\n  return ${n * 1000 + life};\n}`;
}
