const observations = [
  ["versions", "list"],
  ["versions", "view"],
  ["deployments", "status"],
  ["r2", "bucket", "info"],
  ["d1", "list"],
  ["d1", "time-travel", "info"],
  ["secrets-store", "store", "list"],
  ["secrets-store", "secret", "list"],
];
export function wranglerArguments(args, runtime = "node") {
  if (!["node", "bun"].includes(runtime))
    throw Error("Unknown fixture provider runtime");
  return ["x", ...(runtime === "bun" ? ["--bun"] : []), "wrangler", ...args];
}
export const isProviderObservation = (args) =>
  observations.some((prefix) => prefix.every((value, i) => args[i] === value));
export function transientObservation(args, result) {
  if (!result.code || !isProviderObservation(args)) return false;
  const message = result.stdout + "\n" + result.stderr;
  if (
    /\b(?:10000|10006|10007|401|403)\b|unauthorized|authentication|permission denied/i.test(
      message,
    )
  )
    return false;
  if (result.timedOut === true) return true;
  return /fetch failed|request to Cloudflare's API timed out|connect(?:ion)?[^\n]*tim(?:ed? ?out|eout)|ECONNRESET|ECONNREFUSED|ETIMEDOUT|UND_ERR_/i.test(
    message,
  );
}
/** action writes a separate provider log/receipt entry for every attempt. */
export async function observeWithRetries(
  args,
  action,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  for (let attempt = 0; ; attempt++) {
    const result = await action();
    if (attempt >= 2 || !transientObservation(args, result)) return result;
    await wait([1000, 3000][attempt]);
  }
}
