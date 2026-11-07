# Validated stable

Landing does not change: a change still lands on `main` when no later change
wrote what it read or wrote, with no test run. Beside that, each workspace can
have a **check command** and a protected **`refs/heads/stable`** ref. `stable`
moves only to a published version whose exact commit passed that check in an
isolated runner. Clone it like any branch:

```sh
git clone --branch stable https://nanohub.sh/git/<workspace>.git
```

There is no `stable` ref until the first pass.

## Pieces

- **Sequencer** (`src/sequencer/validation.ts`) holds the check command, claims,
  results and the stable pointer, in the same SQLite storage as the trunk. It
  is the only thing that writes `stable`, and it advertises the ref next to
  `main` and the branches.
- **Routes** (`src/validation/route.ts`):

  | Route | Who | What |
  |---|---|---|
  | `GET /api/trunks/:t/validation` | anyone who can read the workspace | config, stable, recent claims and results (with log tails) |
  | `POST /api/trunks/:t/validation` `{command}` / `{command: null}` | signed-in human owner, same origin | set or clear the check |
  | `POST /api/trunks/:t/validation/claim` `{runner}` | runner, `Authorization: Bearer $VALIDATOR_TOKEN` | the newest published version not yet checked under the current command, or `null` |
  | `POST /api/trunks/:t/validation/report` `{claim, version, commit, tree, passed, exitCode, log}` | runner | record the verdict; a pass may move stable |

- **Runner** (`scripts/validation/runner.ts`, `npm run validate`) runs on a host
  you control, not in the Worker:

  ```sh
  NANOHUB_URL=https://nanohub.sh VALIDATOR_TOKEN=… npm run validate -- <workspace> [--once]
  ```

  It claims, clones the workspace with plain git (hooks and credential helpers
  off), checks that the claimed commit has the claimed tree, checks out that
  commit, runs the command in a bubblewrap sandbox, and reports.

## Configuration

- `VALIDATOR_TOKEN` (Worker secret, 24+ characters). Without it, claim and
  report answer 503 and `stable` can never move. Only the runner host holds it.
- The check command: set by the owner. It runs as `/bin/sh -c <command>` in
  `/work`, the checked-out tree, with `CI=1`, `HOME=/tmp`, and
  `PATH=/usr/local/bin:/usr/bin:/bin`. Exit 0 is a pass.
- Runner environment: `NANOHUB_URL`, `VALIDATOR_TOKEN`, optional `RUNNER_NAME`,
  `BWRAP` (default `/usr/bin/bwrap`), `VALIDATION_TIMEOUT_MS` (default 10
  minutes; the whole sandbox process group is killed at the limit).

## Rules that keep stable honest

- Only a report for a claim the sequencer issued counts, and it must name the
  claim's version, commit and tree; that version must be one this trunk
  published. Anything else is 404 or 409.
- Stable only moves forward. A late pass for an older version is recorded and
  leaves stable where it is. A failure never moves it.
- A pass under a command that has since changed is recorded with
  `advanced: false`; the version is claimed again under the new command.
- Reports are idempotent: the same verdict for the same claim replays its
  result; a different verdict is refused.
- One open claim per version. A claim expires after 15 minutes; after it is
  issued again, the old claim's report is refused.
- The runner claims only the newest published version. Versions in between are
  skipped, never certified.
- `stable` and `stable/*` cannot be created, pushed or deleted through the
  branch API or git push (they share `ReviewStore`'s branch path).

## Sandbox

The runner refuses to run anything unless bubblewrap is present and passes a
self-test every run (no network interface but loopback, the runner's `$HOME`
not visible, `VALIDATOR_TOKEN` not in the environment, no Docker socket,
`/work` writable, `/usr` read-only). If that fails it exits before claiming, so
nothing is reported and stable cannot move.

Inside: new user, PID, network, IPC, UTS and cgroup namespaces
(`--unshare-all`); all capabilities dropped; an empty environment; `/usr` and
`/usr/local` read-only; empty `/tmp`, `/proc` and `/dev`; the checkout as the
only writable path. No network means a check cannot install dependencies:
commit them, or vendor what the check needs. The checkout is copied out of git
on the host, so the sandbox never sees `.git`.

What it is not:

- It shares the host kernel. There is no seccomp filter, no gVisor or VM
  boundary, and no cgroup memory, CPU or disk limits beyond the timeout. A
  kernel exploit, or a fork or memory bomb, can still harm the runner host.
  Run the runner on a dedicated machine or VM with nothing else on it.
- It needs unprivileged user namespaces. Hosts that disable them fail the
  self-test, and then nothing runs.
- The runner host's git parses repository data from the workspace. Hooks,
  credential helpers and `file://` are off, but git itself is trusted.

## Limits of this first slice

- Team (private) workspaces answer 409 to claims. Several people and their
  agents on a public workspace work as above: the runner has no member credential to
  clone them.
- One check command per workspace; no matrix, no per-path checks, no
  dependency cache.
- Results are kept for the newest 200 claims. Nothing in the dashboard shows
  them yet; read `GET …/validation`.
- `VALIDATION_CLAIM_MS` (Worker var, at least 1000) shortens claim expiry; the
  simulation sets it to 1.5 s.

## Several people and agents at once

A failure belongs to a **range**, not an author: every claim and result
carries `from` (the version after stable) and `version`. With many people
landing, the version that fails usually holds several people's changes, and
the last author is often not the one who broke it.

`npm run sim:validation -- <agentsPerPerson> <rounds>` simulates three
signed-in people, each with registered agents and scoped credentials (HTTP
clients, not LLMs), on one public workspace, with three runners checking
concurrently in bubblewrap. Agents read a shared function, half of them
rewrite it, and every submit is sent twice to exercise receipts. Then two
people land individually harmless, non-overlapping changes that break the
check together; others keep landing; a third person repairs it. It asserts:
every landed change is on `main` with its `Agent:` and `On-behalf-of:`
trailers; stable never moves backwards and is an exact tree with an advancing
pass; stable does not move while every newer version fails; the failure range
covers both authors; a repair moves stable again; an abandoned claim expires
and its late report is refused; `git push` to `stable` and `stable/x` is
refused with a real agent credential.

Measured on one machine (local Miniflare, `node test.js` as the check):

| agents | rounds | landed | conflicts re-planned | most attempts for one change | runner verdicts | versions skipped | failure range | failure seen after landing | repair to stable |
|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|
| 6 | 3 | 25 | 31 | 4 | 13 | 13 | v15..v21 | 202 ms | 227 ms |
| 24 | 3 | 79 | 427 | 20 | 36 | 44 | v70..v75 | 305 ms | 141 ms |
| 48 | 2 | 103 | 1042 | 41 | 48 | 56 | v95..v99 | 202 ms | 225 ms |

With 48 agents the default cap of 30 attempts was too low: an agent rewriting
the shared function needed up to 41 (`SIM_MAX_ATTEMPTS=300`). That is landing
contention on one hot function, which validation does not change; every change
did land.

What this says about policy:

- **Check the newest version, coalesced, not every change.** Runners skipped
  about half the versions and stable still followed `main` within a check's
  time. Checking every change would multiply runner work by the landing rate.
- **Report failures as a range.** Two authors' compatible-looking changes broke
  together in every run; neither was last alone in every run. Bisecting the
  range is the natural next step when a range is long, run on demand.
- **Do not serialize landing on checks.** `main` kept landing while stable held
  at the last good version, and the repair needed no special path.
- **Several runners are safe.** No version was checked twice and stable never
  moved backwards, with three runners racing.

## Tests

`npm run test:validation` (needs `bwrap` with user namespaces) boots an
isolated Worker and drives the real runner: a passing check moves stable to the
exact tested commit and `git clone --branch stable` gets it; a failing check
leaves stable and `main` still lands; a check cannot reach the API port on
loopback or see the runner's secrets; retries replay, conflicting verdicts,
forged commits and unknown claims are refused; a late older pass does not move
stable back; a pass under a changed command does not count; the branch API
cannot write `stable`; stable survives a restart; and without `VALIDATOR_TOKEN`
or without bwrap nothing moves.
