import { spawn } from "node:child_process";
import { appendFile } from "node:fs/promises";
/** Keep provider outcomes and our numeric fixture telemetry only. */
export function safeTrace(event) {
  const outcomes = new Set([
    "ok",
    "exception",
    "exceededCpu",
    "exceededMemory",
    "canceled",
    "unknown",
    "scriptNotFound",
    "responseStreamDisconnected",
  ]);
  const reads = [];
  for (const log of event.logs ?? []) {
    const values = log?.message;
    if (
      Array.isArray(values) &&
      values[0] === "nanohub-fixture-git-reads" &&
      values.length === 5 &&
      values.slice(1).every((value) => Number.isFinite(Number(value)))
    )
      reads.push(values.slice(1).map(Number));
  }
  return {
    observedAt: new Date().toISOString(),
    outcome: outcomes.has(event.outcome) ? event.outcome : "other",
    status: Number.isInteger(event.event?.response?.status)
      ? event.event.response.status
      : undefined,
    exceptions: Array.isArray(event.exceptions)
      ? event.exceptions.length
      : undefined,
    ...(reads.length ? { reads } : {}),
    ...(Number.isFinite(event.cpuTime) ? { cpuTime: event.cpuTime } : {}),
    ...(Number.isFinite(event.wallTime) ? { wallTime: event.wallTime } : {}),
  };
}
export async function startTrace({ root, config, directory }) {
  const child = spawn(
    "bun",
    ["x", "wrangler", "tail", "--format", "json", "--config", config],
    {
      cwd: root + "/apps/web",
      env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  );
  let pending = "",
    writes = Promise.resolve(),
    events = 0,
    writeFailures = 0;
  const completed = new Promise((resolve) => {
    child.on("error", () => resolve(null));
    child.on("close", resolve);
  });
  child.stderr.on("data", () => {});
  child.stdout.on("data", (bytes) => {
    pending += String(bytes);
    for (;;) {
      const start = pending.indexOf("{");
      if (start < 0) {
        pending = "";
        return;
      }
      let depth = 0,
        quoted = false,
        escaped = false,
        end = -1;
      for (let i = start; i < pending.length; i++) {
        const c = pending[i];
        if (quoted) {
          if (escaped) escaped = false;
          else if (c === "\\") escaped = true;
          else if (c === '"') quoted = false;
        } else if (c === '"') quoted = true;
        else if (c === "{") depth++;
        else if (c === "}" && --depth === 0) {
          end = i + 1;
          break;
        }
      }
      if (end < 0) {
        pending = pending.slice(start);
        if (pending.length > 2 ** 20) pending = "";
        return;
      }
      const raw = pending.slice(start, end);
      pending = pending.slice(end);
      let value;
      try {
        value = safeTrace(JSON.parse(raw));
      } catch {
        continue;
      }
      events++;
      writes = writes
        .then(() =>
          appendFile(
            directory + "/runtime-events.jsonl",
            JSON.stringify(value) + "\n",
            { mode: 0o600 },
          ),
        )
        .catch(() => {
          writeFailures++;
        });
    }
  });
  return {
    async close() {
      // Allow the final completed/canceled request event to reach the subscriber.
      await new Promise((resolve) => setTimeout(resolve, 4000));
      const stop = (signal) => {
        try {
          process.kill(-child.pid, signal);
        } catch {}
      };
      stop("SIGTERM");
      const deadline = setTimeout(() => stop("SIGKILL"), 5000);
      const code = await completed;
      clearTimeout(deadline);
      await writes;
      return { events, exitCode: code, writeFailures };
    },
  };
}
