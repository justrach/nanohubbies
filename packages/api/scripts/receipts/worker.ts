// Test-only fault injection around the real HTTP, Agent, Lane, Sequencer and
// Packer dispatch paths. Never included by either deployment entry point.
import worker from "../../src/index";
import { Lane as BaseLane, laneFor } from "../../src/lane";
import { Packer as BasePacker } from "../../src/packer";
import { Sequencer as BaseSequencer } from "../../src/sequencer";
import type { ChangeRequest } from "../../src/types";
export { Account, Agent, Driver, Hub, Room } from "../../src/index";

export class Lane extends BaseLane {
  private lose = false;
  loseReply() { this.lose = true; }
  async submit(trunk: string, request: ChangeRequest) {
    const lose = this.lose;
    this.lose = false;
    const result = await super.submit(trunk, request);
    if (lose) throw new Error("injected lost lane reply after decision");
    return result;
  }
}

export class Packer extends BasePacker {
  private failure = "";
  private resume: (() => void) | null = null;
  fail(mode: string) {
    this.failure = mode;
    if (!mode) { this.resume?.(); this.resume = null; }
  }
  /** Fails every upload until released, across restarts too. */
  hold(on: boolean) {
    if (on) this.ctx.storage.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('test-hold', '1')");
    else this.ctx.storage.sql.exec("DELETE FROM meta WHERE k = 'test-hold'");
  }
  async publish(...args: Parameters<BasePacker["publish"]>) {
    if (this.ctx.storage.sql.exec("SELECT 1 FROM meta WHERE k = 'test-hold'").toArray().length) throw new Error("injected held upload");
    const failure = this.failure;
    this.failure = "";
    if (failure === "before") throw new Error("injected upload failure");
    if (failure === "pause") await new Promise<void>((resolve) => { this.resume = resolve; });
    await super.publish(...args);
    if (failure === "after") throw new Error("injected lost pack acknowledgement");
  }
}

export class Sequencer extends BaseSequencer {
  private loseNext = false;
  failReceipt(on: boolean, id = "rollback") {
    if (on) this.ctx.storage.sql.exec(`CREATE TRIGGER fail_receipt BEFORE INSERT ON receipts
      WHEN NEW.id = '${id.replace(/'/g, "")}' BEGIN SELECT RAISE(ABORT, 'injected receipt failure'); END`);
    else this.ctx.storage.sql.exec("DROP TRIGGER fail_receipt");
  }
  loseBatch() { this.loseNext = true; }
  // The batch is decided and stored; only its answer to the lane is lost.
  async land(...args: Parameters<BaseSequencer["land"]>) {
    const lose = this.loseNext;
    this.loseNext = false;
    const out = await super.land(...args);
    if (lose) throw new Error("injected lost batch acknowledgement after commit");
    return out;
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/__test/")) return worker.fetch(request, env);
    try {
      const { trunk, agent, mode, change, changes, id } = await request.json<any>();
      const seq = env.SEQUENCER.get(env.SEQUENCER.idFromName(trunk)) as unknown as Sequencer;
      switch (url.pathname) {
        case "/__test/lose": await (laneFor(env, trunk, agent) as unknown as Lane).loseReply(); break;
        case "/__test/upload": await (env.PACKER.get(env.PACKER.idFromName(trunk)) as unknown as Packer).fail(mode); break;
        case "/__test/receipt": await seq.failReceipt(mode === "on", id); break;
        case "/__test/submit": return Response.json(await seq.submit(change));
        case "/__test/land": return Response.json(await seq.land(changes, []));
        case "/__test/losebatch": await seq.loseBatch(); break;
        case "/__test/hold": await (env.PACKER.get(env.PACKER.idFromName(trunk)) as unknown as Packer).hold(mode === "on"); break;
        default: return new Response("not found", { status: 404 });
      }
      return Response.json({ ok: true });
    } catch (error) {
      return Response.json({ error: String(error) }, { status: 500 });
    }
  },
};
