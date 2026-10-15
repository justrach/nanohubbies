import type { RoomEvent } from "../types";

/** Events for the trunk's room, sent in batches every 200ms at most, so a
 *  busy trunk makes few calls. A batch of landings that does not go in takes
 *  its events back before they are sent (`mark`, `back`). */
export class Feed {
  private outgoing: RoomEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private send: (events: RoomEvent[]) => Promise<void>) {}

  emit(event: RoomEvent) {
    this.outgoing.push(event);
    this.timer ??= setTimeout(() => void this.flush(), 200);
  }

  /** Where the queue is now, for `back`. */
  mark(): number {
    return this.outgoing.length;
  }

  /** Drops the events queued since `mark`. */
  back(to: number) {
    this.outgoing.length = to;
  }

  private async flush() {
    this.timer = null;
    const batch = this.outgoing.splice(0);
    if (!batch.length) return;
    try {
      await this.send(batch);
    } catch (e) {
      // The room is a view: losing a batch costs the dashboard some events,
      // never the trunk any state.
      console.error(`room publish failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
