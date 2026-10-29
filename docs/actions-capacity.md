# Shared Actions capacity

One trusted dispatcher fleet can serve multiple repositories and controllers.
Each job still runs in a fresh Codegraff VM, with candidate code inside the
existing restricted container. A persistent VM shared by unrelated customers
would introduce process/kernel isolation, persistent compromise, cache poisoning,
resource contention and shared failure concerns. Repository roles are application
permissions; they do not isolate programs sharing an operating system.
GitHub also recommends [ephemeral runners for autoscaling](https://docs.github.com/en/actions/reference/runners/self-hosted-runners#ephemeral-runners-for-autoscaling);
Docker documents the [kernel, daemon and configuration boundaries](https://docs.docker.com/engine/security/)
that a shared host must enforce.

The new capacity path is implemented and locally tested. It is **not deployed
or activated in production**. It does not add billing plans, compute sizes,
provider quotas or an unattended dispatcher. The configured Nanohub Codegraff
key's missing sandbox scope remains a separate activation blocker.

## Policy and account identity

The shared Hub Durable Object serializes reservations in a SQLite transaction.
Operator Worker variables set positive integer limits (1–10,000):

| Variable | Default | Meaning |
| --- | --- | --- |
| `ACTIONS_MAX_SANDBOXES` | 64 | Outstanding slots across this deployment |
| `ACTIONS_MAX_SANDBOXES_PER_ACCOUNT` | 16 | Outstanding slots for one repository owner or connected team |

Missing variables use the defaults; invalid supplied values reject new admission.
Set both deliberately to match the provider account's budget before activation.
The per-account limit currently applies equally to all accounts. Account-specific
entitlements, compute profiles and pricing tiers remain future work.

Personal repositories share their stored creator/owner identity. Repositories
connected to an external team share the stored issuer + room identity, including
when different people created them. Repository names, aliases, runner names and
client account/limit fields cannot choose another capacity bucket. Ownerless
repositories cannot acquire shared capacity. Limits apply within one Nanohub
deployment; two independent deployments using the same provider key do not share
this ledger.

The existing controller `concurrency`, `jobConcurrency` and `maxSandboxes` remain
local limits. Passing those limits also requires a shared slot. A slot currently
represents one fixed-size VM (4 CPU, 16 GiB RAM, 60 GiB disk); it does not represent
arbitrary resource weights. Provider capacity and credit still apply separately.

## Reservation lifecycle

Updated Codegraff controllers check the versioned capacity service before
claiming a CI candidate. After claim, each job writes a private capacity receipt
before requesting a slot. Admission requires a current repository runner
credential and exact active CI run/attempt. The server derives the account and
limits itself. Only an explicit capacity denial is polled (30 seconds); malformed
responses and transport failures stop instead of repeating an uncertain write.

The receipt records reservation ID, run, attempt, job, progress and provider VM
ID when known. It contains no control credentials and is never uploaded as an
Actions log or copied into candidate execution. The controller records the VM
ID before attaching it to the shared reservation. It releases capacity only if
it never attempted allocation, or after provider-confirmed destruction. Failed
cleanup or an unknown allocation result retains the slot. Expired CI leases,
runner revocation, job failure, archive and controller restart do not expire it.
Released tombstones fence delayed allocation/replay of the same job/attempt.

Cleanup is allowed with any **current** runner credential for the same repository,
even after its CI lease is canceled or the repository is archived. Revoked runner
credentials remain denied. A cleanup report is a trusted controller assertion:
Nanohub does not independently query the provider at the server or attest an
arbitrary runner's honesty. Do not give these service credentials to candidate
code, customers' machines or untrusted controllers.

## Recovery

Keep the trusted config and artifact directory across controller restarts. Use
a current repository credential (a replacement if the old one was revoked).
Inspection makes no changes:

```sh
bun --env-file=/absolute/private/actions.env tools/reconcile-sandbox-capacity.mjs \
  /etc/nanohub/one-repository.json /var/lib/nanohub-ci/job.capacity.json
```

`--release` releases only after the provider reports that the exact recorded VM
is absent/destroyed/deleted/expired. `--destroy` explicitly destroys that exact
VM, confirms removal, then releases the slot. A running/stopped VM, unavailable
provider, mismatched receipt or unknown VM ID keeps capacity reserved. A lost
release acknowledgement can be reconciled idempotently. No automatic replay
creates a replacement VM. If creation's result was lost before its ID was saved,
resolve the allocation with the provider before a trusted operator asserts that
no VM exists; the repair tool intentionally cannot guess from an inventory.

Runner-only POST operations under either `/api/trunks/:id/ci/capacity/` or
`/api/repos/:owner/:repo/ci/capacity/` are `status`, `reserve`, `inspect`, `attach`
and `release`. Bodies are bounded to 2 KiB and reject unknown fields. Responses
are private/no-store. Exact release may be repeated; an uncertain provider
creation must not be repeated.

## Rollout and limits

Deploy the server before replacing controllers; updated controllers fail before
claim if the capacity service is unavailable. Stop/drain all older controllers
and reconcile existing provider VMs before enabling the updated fleet. Older
controllers, direct provider API users, explicit Docker backends and external
pipeline adapters do not participate in this ledger. It cannot constrain those
allocations at the provider. Cross-deployment limits would require a common
capacity service or provider-enforced account quotas.

Admission has no FIFO scheduling, fairness guarantee, autoscaling, cost meter or
automatic orphan reconciler yet. Held reservations can reduce availability until
an operator reconciles them. Released records are retained; a bounded retention
policy that preserves replay protection remains future operations work. The
deployment's existing HTTP rate limits also apply to controller traffic and must
be sized for the intended fleet. Shared-Hub throughput and production load/SLO
acceptance remain unmeasured.

Run `bun run --filter @swarm/api test:actions-capacity` for focused controller and
real Worker tests. The normal hosting gate includes the shared-capacity tests.
See [acceptance evidence](evidence/actions-capacity-validation.md).
