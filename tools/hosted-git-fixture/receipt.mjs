/** Snapshot at invocation and preserve write order within one controller.
 * A failed receipt still rejects its caller; later cleanup may persist again. */
export function serializedReceipt(write) {
  if (typeof write !== "function") throw Error("Receipt writer required");
  let tail = Promise.resolve();
  return value => {
    const snapshot = JSON.stringify(value);
    const pending = tail.then(() => write(JSON.parse(snapshot)));
    tail = pending.catch(() => {});
    return pending;
  };
}
