import assert from "node:assert/strict";
import { createHash } from "node:crypto";

/** Before overwriting or deleting anything, every live byte must have an
 * independently retained return copy. Unknown or changed content stays closed. */
export async function verifiedR2Reconcile(live, desired, retained, readLive) {
  assert.equal(new Set(live.map((x) => x.key)).size, live.length);
  assert.equal(new Set(desired.map((x) => x.key)).size, desired.length);
  const targets = new Set(desired.map((x) => x.key)),
    extras = [];
  for (const object of live) {
    const candidates = retained.filter(
      (x) => x.key === object.key && x.bytes === object.size,
    );
    assert.ok(candidates.length, "Live object has no retained return copy");
    const bytes = await readLive(object.key);
    assert.equal(bytes.length, object.size, "Live object byte count changed");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    assert.ok(
      candidates.some((x) => x.sha256 === sha256),
      "Live bytes have no verified retained return copy",
    );
    if (!targets.has(object.key)) extras.push(object.key);
  }
  return extras;
}
