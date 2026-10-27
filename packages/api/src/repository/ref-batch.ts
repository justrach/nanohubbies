/** Initial migration publishes the entire checked graph atomically. Recheck
 * emptiness in the serialized writer; ordinary updates keep their small cap. */
export const INITIAL_IMPORT_MAX_REFS = 10_000;
export function assertRefBatch(count: number, emptyInitialCreation: boolean) {
  if (!Number.isSafeInteger(count) || count < 1 || count > (emptyInitialCreation ? INITIAL_IMPORT_MAX_REFS : 100))
    throw Error("Push supports 1–100 ref updates, or up to 10,000 creations into an empty repository");
}
