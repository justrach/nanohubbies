/** Every operation addresses generated fixture identities, never saved config files. */
export async function cleanupFixture(record, ops) {
  const errors = [];
  const attempt = async (stage, action) => {
    try {
      await action();
      record[stage] = true;
      await ops.persist();
      return true;
    } catch (error) {
      errors.push({ stage, error: String(error.message) });
      await ops.persist();
      return false;
    }
  };
  // Observe actual existence, including operations whose acknowledgement was lost.
  // Failure to observe is never treated as absence.
  const observed = {};
  for (const kind of ["api", "gate", "bucket", "database"]) {
    if (
      !(await attempt("observed" + kind, async () => {
        observed[kind] = await ops.exists(kind);
      }))
    ) {
      record.cleanupErrors = errors;
      record.cleanupNeeded = true;
      await ops.persist();
      return;
    }
  }
  // A purge-only gate has no service binding to the app. Recreate it if an
  // interrupted initial deployment left a bucket but no working control gate.
  if (observed.gate || observed.bucket) {
    if (!(await attempt("apiGateClosed", ops.closeGate))) return unfinished();
  }
  if (observed.api) {
    if (!(await attempt("durableNamespacesRetired", ops.retire)))
      return unfinished();
    if (
      !(await attempt("apiWorkerDeleted", async () => {
        await ops.delete("api");
        if (await ops.exists("api"))
          throw Error("API Worker deletion not confirmed");
      }))
    )
      return unfinished();
  } else {
    // Once a deployed namespace exists, its explicit retirement receipt is
    // required even if someone independently deleted the Worker code.
    if (record.apiVersion && !record.durableNamespacesRetired) {
      errors.push({
        stage: "durableNamespacesRetired",
        error: "Worker absent without a namespace retirement receipt",
      });
      return unfinished();
    }
    record.apiWorkerDeleted = true;
  }
  if (observed.bucket) {
    if (!(await attempt("bucketEmptied", ops.purge))) return unfinished();
    if (
      !(await attempt("bucketDeleted", async () => {
        await ops.delete("bucket");
        if (await ops.exists("bucket"))
          throw Error("Bucket deletion not confirmed");
      }))
    )
      return unfinished();
  } else record.bucketDeleted = true;
  if (observed.database) {
    if (
      !(await attempt("databaseDeleted", async () => {
        await ops.delete("database");
        if (await ops.exists("database"))
          throw Error("Database deletion not confirmed");
      }))
    )
      return unfinished();
  } else record.databaseDeleted = true;
  // Keep the cleanup service and keys until the data resources are confirmed gone.
  if (observed.gate || observed.bucket) {
    if (
      !(await attempt("gateWorkerDeleted", async () => {
        await ops.delete("gate");
        if (await ops.exists("gate"))
          throw Error("Gate deletion not confirmed");
      }))
    )
      return unfinished();
  } else record.gateWorkerDeleted = true;
  record.cleanupErrors = errors;
  record.cleanupNeeded = false;
  record.finishedAt = new Date().toISOString();
  await ops.persist();
  await ops.removeKeys();
  return;

  async function unfinished() {
    record.cleanupErrors = errors;
    record.cleanupNeeded = true;
    await ops.persist();
  }
}
