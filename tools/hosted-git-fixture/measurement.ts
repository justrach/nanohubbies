/** Fixture-only numeric telemetry: never log object keys or request headers. */
export function readMeasurement(
  bucket: R2Bucket,
  report: (
    count: number,
    elapsed: number,
    peak: number,
    finished: number,
  ) => void,
) {
  const started = performance.now();
  let count = 0,
    active = 0,
    peak = 0;
  const measured = new Proxy(bucket, {
    get(target, name) {
      if (name === "get")
        return async (...args: Parameters<R2Bucket["get"]>) => {
          count++;
          active++;
          peak = Math.max(peak, active);
          try {
            return await target.get(...args);
          } finally {
            active--;
            if (count % 1000 === 0)
              report(count, Math.round(performance.now() - started), peak, 0);
          }
        };
      const value = Reflect.get(target, name);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return {
    bucket: measured,
    finish: () =>
      report(count, Math.round(performance.now() - started), peak, 1),
  };
}
