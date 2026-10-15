# Submission receipts

The JSON agent API distinguishes the durable landing decision from publication
of its Git objects. These changes do not replace the conflict rules, squash
landings, or change Git object formats.

## Retry the same life

Keep the `life` returned by `POST /api/trunks/:trunk/agents/:agent/lives` and send
it on submission:

```json
{
  "life": 1,
  "intent": "Add greeting",
  "edits": [{ "op": "create", "path": "hello.txt", "text": "hello\n" }],
  "wait": "published"
}
```

The agent saves the complete request and change ID before dispatch. Until it
gets a decision, starting another life is refused. Repeat the same submission
if its response is lost: concurrent retries share a dispatch; after an eviction
the saved request is sent again. A different intent, edits, issue association,
or pushed commit is refused rather than silently substituted. JSON object-key
order does not change request identity; edit-array order does.

The sequencer saves the decision with its effects in a synchronous SQLite
transaction. An identical change ID and request replays the landed, conflict,
or rejected receipt without reapplying edits or counting another conflict.
Reusing an ID with a different request is refused. A rolled-back transaction
also invalidates the sequencer's derived caches and discards queued events from
that attempt. Optional in-memory Git objects are not retained in the receipt;
a replayed landing can read its original version through publication instead.

The agent retains the current life's request/receipt, not an unbounded client
history. Once a new life starts, a submission pinned to an older life is
refused. Omitting `life` remains compatible with old clients, but does not
protect against a delayed request being applied to a newer life. The shared
script client now supplies it. Decisions from before this migration have no
request fingerprint and are not guessed to be safe retries.

To recover a lost answer without resending the body, `POST …/retry` with
`{"life": N}` sends the saved request again: the decision is replayed if it was
made, or made now, and never becomes a new change. `GET …/submission?life=N`
reports the change ID, the receipt, and for a landing whether it is published
(`state`: `none`, `undecided`, `landed`, `conflict` or `rejected`); it never
returns the saved request. Both refuse a life other than the current one, so a
stale retry cannot touch a newer life.

A submit or retry that fails after the submission was recorded answers 502
with `{error, state: "undecided", life, id}`, as status would: the decision
may exist, so retry the life rather than treat it as refused or busy. Errors
before anything was recorded stay 400. Once a signed-in person starts an
agent's life, its submit, retry and submission routes answer only that person
(403 for anyone else); a guest's life stays open like every guest route.

## Landed is not yet published

Without `wait`, submission returns the existing landed/conflict/rejected
shape. A landed receipt names the durable version and commit; it is not an
assertion that R2 publication or the Artifacts mirror has caught up.

With `wait: "published"`:

- HTTP 200 with `status: "landed", publication: "published"` means that version
  is available through this trunk's R2-backed Git clone endpoint. A concurrent
  later landing may already be the advertised tip; the receipted commit remains
  in its history.
- HTTP 202 with `status: "landed", publication: "pending"` means publication
  failed or the ten-second wait expired. The change is **already landed**.
  Retrying the same life and payload waits on the same receipt, not a new change.
- Conflicts and rejections return their recorded decisions without a publication
  state. Invalid `life` or `wait` input is rejected before dispatch.

Publication failures schedule an alarm, including when there are no more
landings or clients waiting. Restart recovery also drains pending objects.
The published head still advances only through complete, ordered uploads.
These receipts make no assertion about Artifacts/upstream mirroring, CI success,
or provenance publication. Git-push retry identity is not redesigned here.

## Not admitted: the publication backlog

Landing can outrun publication. The sequencer keeps the backlog from its own
pending table: bytes of Git objects not yet published, and when the oldest of
them landed. Both are exact across failed uploads and restarts, and the trunk's
`GET /api/trunks/:trunk/info` reports them under `backlog`, beside the landed
(`tip`) and published (`head`) versions.

Once the backlog passes either limit, the sequencer decides no new change:

- `PUBLISH_BACKLOG_BYTES` (default 64 MiB) of objects waiting, or
- `PUBLISH_BACKLOG_MS` (default 30 s) since the oldest waiting version landed.

It starts deciding again only below half of both. Each change is checked
before it is decided, so the queue passes the byte limit by at most one
change. The age limit bounds how old the oldest waiting version is when a new
change is admitted, not the whole wait: changes admitted just before it is
reached still publish in order, so a version can wait up to the limit plus the
time to publish what was already admitted. Under sustained overload, landing
pauses while the limit holds and resumes in a burst below half of it. A
change may write at most `CHANGE_MAX_BYTES` (default 8 MiB) of files;
a bigger one is rejected like any other refusal, with a receipt.

A change turned away gets `status: "busy"` and `retryAfterMs`; over HTTP, a
503 with `Retry-After`. It was not decided: nothing was stored, no receipt and
no effects, and the agent forgets the attempt, so the same change can simply
be sent again, and a git push says to push again shortly. A change that was
already decided replays its receipt as before, whatever the backlog, and a
landed change waiting for publication still answers 202 when asked to wait.
Publication keeps retrying from an alarm, so the backlog drains with no new
landing to start it.

## Discovery and the CLI

`GET /api/agent-help` describes the agent routes from the same table the router
dispatches, with the contract version (`contract`), this deployment's version
and backlog limits, each route's parameters and its `auth`, so the help is what
the server serves.

`nanohub swarm` drives the workflow from the nanohub binary against a Swarm
server (`--swarm URL` or `NANOHUB_SWARM`, plus `--trunk`/`NANOHUB_TRUNK` and
`--agent`/`NANOHUB_AGENT`): `start`, `submit`, `retry`, `status`, `wait`, and
`help`. `nanohub swarm help --json` is generated from the installed command
table, matched against `/api/agent-help`: a command whose route the server does
not serve, or serves without a parameter the command needs (`needs`, such as
`life` for retry), is filtered out and named under `unavailable` (`--all` lists
it); a server that cannot be asked filters nothing. Without `--life`, `submit`
and `retry` read the current life first and pin it. After a landing they ask
once whether it is published, or wait for it with `--wait`.

With `--json`, each result is one object with the same keys every time:
`state`, `publication`, `life`, `id`, `version`, `receipt` (the server's
decision as sent), `retry_after_ms`, `timed_out`, `error`, `next` and `exit`.
A usage error is `{command, state: "usage", error, exit}`. For submit, retry,
status and wait, exit 0 means landed and published, nothing less: a landing
whose publication is not confirmed, waited for or not, is 75 with publication
`pending`. Published means clonable from the trunk's git endpoint, not mirrored
or provenance-published. Exit codes:

| exit | state | next |
|---|---|---|
| 0 | `landed`, publication `published`; `started` for start | done |
| 75 | `landed`, publication `pending` (not confirmed yet, or a wait timed out) | `wait`: already landed, do not submit again |
| 75 | `busy`: not admitted, nothing stored | `resend` the same submit after `retry_after_ms` |
| 3 | `conflict` or `rejected` | `start` a new life |
| 4 | `none` or `undecided` (including a 502 after a lost reply) | `submit`, or `retry` |
| 1 | `refused` (the server's error) or `unknown` (no usable answer) | `status`, or `retry` with the same life |
| 2 | `usage` | nothing was sent |

## Local verification

From `swarm/packages/api`:

```sh
npm run test:receipts
npm run test:backlog
npm run test:cli   # after zig build at the repository root
npm run check
```

The self-contained regression uses the installed Workers runtime, SQLite Durable
Objects, local R2 and the production HTTP/Agent/Lane/Sequencer/Packer paths.
Test-only wrappers inject lost lane replies, receipt-write failures, failed
uploads, lost pack acknowledgements and a stalled publisher. It restarts the
runtime against persistent storage and clones the resulting linear history
with strict `git fsck`. It uses no hosted bindings or credentials. The CLI
regression runs the built binary against the same runtime, behind a proxy that
drops an answer after the server acted on it.

## Remaining hill-climb work

This is a safety increment, not a measured throughput improvement. Receipt
lookups, hashing and writes add work. Before selecting an optimization, profile
those costs alongside packing and tree construction, then measure with the same
workload. The initial local Node profile used a stand-in SQLite/R2 environment;
it is not a Workers throughput result. Fresh hosted measurements require
separate deployment approval.
