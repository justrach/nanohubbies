// The validated-stable runner (docs/validated-stable.md). It runs on a host
// you trust, never inside the Worker: it claims the newest published version
// of a workspace, fetches that exact commit with plain git, checks the tree,
// runs the workspace's check command inside a bubblewrap sandbox, and reports
// the verdict. Only a pass on the claimed commit can move `stable`.
//
//   NANOHUB_URL=https://nanohub.sh VALIDATOR_TOKEN=… node scripts/validation/runner.ts <workspace> [--once]
//
// The sandbox (bwrap) gets: new user, pid, net, ipc, uts and cgroup
// namespaces (no network at all), no capabilities, a cleared environment, the
// host's /usr (and /usr/local) read-only, an empty /tmp, and the checkout as
// its only writable path. It never sees $HOME, the runner's environment (so
// not VALIDATOR_TOKEN), any git credentials, or a Docker socket. If bwrap is
// missing or fails its self-test, the runner refuses to run anything and
// reports nothing, so stable cannot move: it fails closed.
import { spawn, execFile } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const TIMEOUT_MS = Number(process.env.VALIDATION_TIMEOUT_MS ?? 10 * 60 * 1000);
const LOG_BYTES = 8000;

export interface RunnerOptions { url: string; token: string; trunk: string; runner?: string; bwrap?: string }
export interface Outcome { claimed: boolean; version?: number; commit?: string; passed?: boolean; exitCode?: number | null; stable?: { version: number; commit: string } | null; log?: string }

/** The bwrap arguments for one run. Exported for tests that assert the policy. */
export function sandboxArgs(work: string, command: string): string[] {
  const ro = ["/usr", "/usr/local"].flatMap((p) => ["--ro-bind-try", p, p]);
  return [
    "--unshare-all", "--die-with-parent", "--new-session", "--cap-drop", "ALL", "--clearenv",
    ...ro,
    "--symlink", "usr/bin", "/bin", "--symlink", "usr/lib", "/lib", "--symlink", "usr/lib64", "/lib64", "--symlink", "usr/sbin", "/sbin",
    "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
    "--bind", work, "/work", "--chdir", "/work",
    "--setenv", "PATH", "/usr/local/bin:/usr/bin:/bin", "--setenv", "HOME", "/tmp", "--setenv", "CI", "1",
    "/bin/sh", "-c", command,
  ];
}

function run(file: string, args: string[], timeout: number): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    // The child gets an empty environment; bwrap clears it again inside.
    const child = spawn(file, args, { env: {}, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let out = "";
    const take = (b: Buffer) => { out = (out + b.toString("utf8")).slice(-LOG_BYTES * 2); };
    child.stdout.on("data", take); child.stderr.on("data", take);
    const timer = setTimeout(() => { try { process.kill(-child.pid!, "SIGKILL"); } catch {} out += `\n[runner] timed out after ${timeout} ms\n`; }, timeout);
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out: out.slice(-LOG_BYTES) }); });
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: null, out: String(e) }); });
  });
}

/** Proves the sandbox is real before trusting it: no network interface but
 *  loopback, no $HOME, no host environment, uid not root outside. */
export async function selfTest(bwrap: string): Promise<void> {
  await access(bwrap).catch(() => { throw new Error(`no sandbox: ${bwrap} not found; refusing to run checks`); });
  const dir = await mkdtemp(join(tmpdir(), "nanohub-probe-"));
  try {
    const probe = [
      `test ! -e "${process.env.HOME ?? "/root"}"`,
      "test -z \"$VALIDATOR_TOKEN\"",
      "test ! -S /var/run/docker.sock",
      "! grep -qv -E '^ *(Inter|face|lo:)' /proc/net/dev",
      "touch /work/ok",
      "! touch /usr/probe 2>/dev/null",
    ].join(" && ");
    const r = await run(bwrap, sandboxArgs(dir, probe), 20_000);
    if (r.code !== 0) throw new Error(`sandbox self-test failed (exit ${r.code}); refusing to run checks: ${r.out.trim()}`);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

async function call(o: RunnerOptions, op: string, body: unknown) {
  const res = await fetch(`${o.url}/api/trunks/${o.trunk}/validation/${op}`, { method: "POST", headers: { authorization: `Bearer ${o.token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  const value = await res.json() as any;
  if (!res.ok) throw new Error(`${op}: ${res.status} ${value.error ?? ""}`);
  return value;
}

/** One claim, fetch, check and report. */
export async function validateOnce(o: RunnerOptions): Promise<Outcome> {
  const bwrap = o.bwrap ?? process.env.BWRAP ?? "/usr/bin/bwrap";
  await selfTest(bwrap);
  const { claim } = await call(o, "claim", { runner: o.runner ?? "runner" });
  if (!claim) return { claimed: false };
  const dir = await mkdtemp(join(tmpdir(), "nanohub-check-"));
  try {
    const repo = join(dir, "repo"), work = join(dir, "work");
    // Host-side git only reads objects: no hooks, no credentials, no submodules.
    const git = (...args: string[]) => exec("git", ["-c", "core.hooksPath=/dev/null", "-c", "credential.helper=", "-c", "protocol.file.allow=never", ...args], { env: { PATH: process.env.PATH ?? "/usr/bin:/bin", GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", HOME: dir } , maxBuffer: 1 << 24 });
    await git("clone", "--quiet", "--no-checkout", `${o.url}/git/${o.trunk}.git`, repo);
    const tree = (await git("-C", repo, "rev-parse", `${claim.commit}^{tree}`)).stdout.trim();
    if (tree !== claim.tree) throw new Error(`fetched commit ${claim.commit} has tree ${tree}, claim says ${claim.tree}`);
    await mkdir(work);
    await git("-C", repo, "--work-tree", work, "checkout", "--quiet", claim.commit, "--", ".");
    await writeFile(join(dir, "claim.json"), JSON.stringify(claim));
    const r = await run(bwrap, sandboxArgs(work, claim.command), TIMEOUT_MS);
    const passed = r.code === 0;
    const reported = await call(o, "report", { claim: claim.id, version: claim.version, commit: claim.commit, tree: claim.tree, passed, exitCode: r.code, log: r.out });
    return { claimed: true, version: claim.version, commit: claim.commit, passed, exitCode: r.code, stable: reported.stable, log: r.out };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const trunk = process.argv[2];
  const url = process.env.NANOHUB_URL, token = process.env.VALIDATOR_TOKEN;
  if (!trunk || !url || !token) { console.error("usage: NANOHUB_URL=… VALIDATOR_TOKEN=… node scripts/validation/runner.ts <workspace> [--once]"); process.exit(2); }
  const once = process.argv.includes("--once");
  for (;;) {
    try {
      const out = await validateOnce({ url, token, trunk, runner: process.env.RUNNER_NAME ?? "runner" });
      console.log(JSON.stringify({ ...out, log: undefined }));
    } catch (e) { console.error(String(e)); if (once) process.exit(1); }
    if (once) break;
    await new Promise((r) => setTimeout(r, 15_000));
  }
}
