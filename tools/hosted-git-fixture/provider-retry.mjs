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
export function transientObservation(args, result) {
  if (
    !result.code ||
    !observations.some((prefix) =>
      prefix.every((value, i) => args[i] === value),
    )
  )
    return false;
  const message = result.stdout + "\n" + result.stderr;
  if (
    /\b(?:10000|10006|10007|401|403)\b|unauthorized|authentication|permission denied/i.test(
      message,
    )
  )
    return false;
  return /fetch failed|connect(?:ion)?[^\n]*tim(?:ed? ?out|eout)|ECONNRESET|ECONNREFUSED|ETIMEDOUT|UND_ERR_/i.test(
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
