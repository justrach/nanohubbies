import { fingerprint } from "../submission";
import type { ChangeRequest, Submitted } from "../types";
import { held, put, type Table } from "./held";
import { forgetLeases } from "./leases";
import { forget } from "./store";

/** A receipt is held with its decision's effects in the batch (./held), so
 *  the batch's write stores both or neither. */
const RECEIPTS: Table = { into: "INSERT INTO receipts (id, identity, result)" };

/** One decision per ID. Store the decision in the same synchronous transaction
 *  as its effects. Optional in-memory objects are not part of the receipt:
 *  after replay an agent can read the original version through the publisher. */
/** How long a request that was not admitted should wait before it is sent again. */
const RETRY_MS = 1000;

export function decideOnce(storage: DurableObjectStorage, req: ChangeRequest, decide: () => Submitted, admits: () => boolean = () => true): Submitted {
  const sql = storage.sql;
  const identity = fingerprint(req);
  // The same ID earlier in this batch: its receipt is held, not yet in the table.
  const mine = held(sql, RECEIPTS, req.id);
  const previous = mine
    ? { identity: mine[1] as string, result: mine[2] as string, legacy: null }
    : sql.exec<{ identity: string | null; result: string | null; legacy: string | null }>(
        `SELECT r.identity, r.result, c.id AS legacy FROM (SELECT ? AS id) q
         LEFT JOIN receipts r ON r.id = q.id LEFT JOIN changes c ON c.id = q.id`, req.id,
      ).one();
  if (previous.identity !== null) {
    return previous.identity === identity
      ? JSON.parse(previous.result!) as Submitted
      : { status: "rejected", id: req.id, error: "change ID already belongs to a different request" };
  }
  // Old decisions have no request identity: never guess that a retry matches.
  if (previous.legacy !== null) return { status: "rejected", id: req.id, error: "change ID predates retry receipts; inspect its recorded outcome" };
  // Never decided: whether it is decided now is the backlog's call
  // (./backlog). Turned away, it leaves no receipt and no effects.
  if (!admits()) return { status: "busy", id: req.id, retryAfterMs: RETRY_MS };
  try {
    return storage.transactionSync(() => {
      const result = decide();
      const { made: _made, ...receipt } = result;
      put(sql, RECEIPTS, req.id, [req.id, identity, JSON.stringify(receipt)]);
      return result;
    });
  } catch (error) {
    // A rolled-back write must not survive in the sequencer's derived caches.
    forget(sql);
    forgetLeases(sql);
    throw error;
  }
}
