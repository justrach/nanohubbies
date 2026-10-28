# Repository recovery

A Git mirror recovers Git history; repository permissions, reviews, rules,
credentials, Actions state and vault references also need recovery. Restored
content does not authorize reopening a repository to traffic. A backup can
contain authority that has since been revoked.

## Local acceptance

Run `bun run --filter @swarm/api test:recovery`. The same drill is part of
`test:repository`. It uses only synthetic loopback Workers and private temporary
directories. There are no production restore routes, live Cloudflare operations
or production credentials in this command.

The fixture stops all its Workers before copying application `do`, `d1` and `r2`
persistence. Expected SHA-256 digests stay outside the snapshot; changing a
snapshot cannot rewrite the verifier's expectations. Corruption is rejected
before deleting any live fixture state. The test then physically removes those
three resources and the disposable cache, observes missing repository and D1
identity state, restores the verified files, and boots new Workers. This is a
cold storage recovery, beyond an ordinary restart on the original files.

It compares exact Git refs, reachable objects, an annotated tag, a Unicode branch,
binary bytes, executable and symlink modes. Repository addresses, graph,
protections, rulesets, policy audit, Room issues, agent history, PR reviews and
anchored hunk comments survive. Archive fences remain set in Hub, Sequencer and
Room. Protected direct pushes, locked branch creation, release-tag deletion and
an unready PR merge remain denied. D1 identity links and a revoked CLI credential
row match the checkpoint exactly. A removed reviewer's historical review remains
visible but supplies no approval authority.

The simulated Cloudflare Secrets Store lives outside those three resources. The
test checks that neither secret value appears in the application backup. A
provider rotation made after the older checkpoint survives both storage loss and
restoration; a freshly authorized grant resolves that current provider value.
The unused vault retains its binding metadata and has no wake-up alarm.

The drill also deliberately restores a checkpoint from before collaborator
removal and Git, CLI, agent/MCP, runner and workload-grant revocation. Those old
permissions and credentials become usable again inside the isolated fixture.
Reapplying the independently known removals/revocations denies them again,
including after restart. **The snapshot is not a current authority ledger.**
The test does not implement an automatic production reconciliation service.

See the [recorded local result](evidence/cold-recovery-validation.md).

## Operator request hold

The fence is deployed on main-site version
`1450c429-a969-483e-8383-c05d9ed8467c`. Normal asset delivery and a held
configuration are verified separately; see the [rollout evidence](evidence/recovery-hold-validation.md).
Earlier builds may not honor this variable. Verify an aware deployment and
actual held responses before relying on it.

Set the main Worker's `NANOHUB_RECOVERY_HOLD` configuration variable to `"1"`
before recovery. This is operator configuration outside DO/D1/R2 backups; it
is not a repository setting or an application API permission. Only an omitted
binding or the exact string `"0"` opens requests. Empty, misspelled or unexpected
values hold traffic as well. No cookie, credential, query parameter, header,
HTTP method or public health path bypasses the hold.

The API entrypoint and the combined web entrypoint check it before auth,
throttling, repository resolution, Next.js, asset delegation or legacy routing.
Held requests receive private, non-cacheable HTTP 503 with `Retry-After: 60`,
`X-Nanohub-Recovery: hold` and a `recovery_hold` code. HEAD has no response body.
This includes new WebSocket upgrades, MCP, CLI authorization and downloads,
OAuth callbacks, Git clone/push, CI callbacks and secret redemption requests
through the application. In-process page-to-API calls use the same API fence.

Keep `assets.run_worker_first: true` on the deployed Worker and every relevant
environment. Both committed web configurations now set it. Cloudflare's
[Worker-first asset routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)
allows the request fence to run before a matching static asset is served.
After the fence, the combined Worker explicitly asks the assets binding for
matching GET/HEAD files before invoking Next or legacy routing. API/Git paths
stay with their authenticated handlers. The normal-delivery gate checks file
bytes and MIME types, including CSS, rather than accepting HTTP 200 alone.
This makes asset network requests invoke the Worker too; account for that in
traffic and cost measurements. Already cached browser content is not remotely
erased by this flag.

Apply the variable through the operator's normal Cloudflare configuration and
deployment controls, preserving existing bindings and variables. Verify the
active deployment and 503 behavior before beginning a restore. Keep the hold
through later deployments and restores. Releasing it is an explicit operator
change after current-authority reconciliation; deployment must not silently
set it to `"0"`. Do not roll back to a build that lacks this fence while relying
on it. There is deliberately no public recovery/unlock API or owner exemption.

This fences **new fetch requests reaching the aware Worker**, not already
running requests, open sockets, direct DO/Vault RPC, alarms, imports, service
clients that bypass this fetch handler or other Worker versions. It neither
revokes restored credentials nor freezes a cross-service transaction. The
operator still needs isolation and draining for all those paths. The local
drill keeps the hold across an older restore and restart, then releases only
the isolated loopback fixture to demonstrate the authority hazard and reconcile
it. That is not a safe public reopening procedure.

## Hosted recovery release gate

The local files are a Miniflare implementation detail, not a Cloudflare backup
format. Cloudflare's [SQLite Durable Object PITR API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
restores an individual object's SQL and KV state using bookmarks; it is not
implemented in local development. [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
is a separate database restore mechanism with plan-dependent retention and
destructive in-place restoration. Neither substitutes for a retained copy of
R2 objects. R2's [S3 compatibility table](https://developers.cloudflare.com/r2/api/s3/api/)
marks bucket versioning operations unsupported; do not assume overwritten or
deleted objects can be recovered through S3 version IDs.

Before a live drill can establish readiness, the operator workflow must prove:

1. Isolate the recovery resources from public requests, service-binding callers,
   WebSocket clients, import jobs, DO alarms and trusted dispatchers. A frontend
   maintenance page or a DNS change alone does not establish quiescence. Keep
   the current service available separately or keep it closed throughout the
   procedure; never expose partly restored state.
2. Preserve a trusted inventory of every required object identity and recovery
   point, D1 state, R2 object bytes and checksums, Worker versions and resource
   bindings. Include Hub, Account, Sequencer, Room, Agent, Lane, Packer, Driver,
   ImportJob and the separate Vault where applicable. Prove consistency across
   those services; choosing the same wall-clock timestamp is not a cross-service
   transaction. Retain provider credentials and application backups privately
   under operator control. Keep actual secret values in Cloudflare.
3. Preserve the latest security authority outside the recovery point. Reconcile
   current owners, collaborators, invitations, signing keys, check sources,
   Git/CLI/agent credentials, runner registrations, workload grants and provider
   sessions before reopening. Invalidate unknown or superseded grants and
   in-flight CI/deployment leases. If the current authority cannot be recovered
   independently, remain closed and explicitly re-establish access; the old
   backup is insufficient evidence. A session-key rotation alone cannot revoke
   every independently stored credential or correct restored membership.
4. Restore into the isolated environment and verify all Git object/ref hashes,
   metadata and authority at the intended recovery point. Verify R2 reachability,
   archive/default/protection revisions and enforcement with actual clone/fsck,
   rejected pushes and merge checks. Verify provider secret references without
   exporting values, and show that revoked credentials and removed people fail
   from outside the recovering application.
5. Record measured recovery time and data loss, the exact checkpoint/version,
   evidence, failed attempts and a tested return path. Reopen traffic only after
   that acceptance, then observe private access, queues, cleanup and errors.

This workflow, an independent retained backup and a hosted destructive recovery
drill remain open production requirements. The local test does not establish
Cloudflare PITR execution, bookmark retention, production resource enumeration,
alarm/import resumption, cross-service backup atomicity, infrastructure-loss
recovery, an RPO/RTO, or an automated revocation-safe reopening mechanism.

### Native provider recovery probe

The first isolated live run [passes](evidence/native-recovery-validation.md) all
nine DO classes, D1 and retained R2 bytes. This is provider-primitives evidence;
the complete hosted repository gate above remains open.

`bun run test:hosted-recovery` checks the isolated harness's authority, target
bounds, checksum rejection and recovery configuration. To exercise the actual
provider APIs, an operator can run:

```sh
NANOHUB_LIVE_CLOUDFLARE=1 bun tools/verify-hosted-storage-recovery.mjs /absolute/account-config.jsonc /absolute/private-artifacts
```

Only the account identifier is read from the supplied configuration. The harness
generates a separate `nh-recovery-live-*` Worker pair, all nine application DO
classes, D1 database and R2 bucket. It uses temporary private ingress keys and a
two-hour deadline; no production bindings or credentials are copied. Normal
application requests remain held throughout. The privileged controls exist only
in the disposable fixture entrypoint, which production does not import.

The native probe writes distinct SQL/KV checkpoints, deletes fixture state,
restores an earlier DO bookmark, exercises its undo point and returns to the
newer checkpoint. D1 Time Travel is exercised separately. SQL verification
includes binary, Unicode, embedded NUL and exact 64-bit integer data. A 1 MiB
R2 object is retained in a private controller file, verified against separate
checksum expectations, deleted and restored byte for byte; a corrupted backup
must be rejected before a restore write. Every phase verifies held API, Git
discovery and GET/HEAD asset requests.

Cleanup reuses the resumable hosted-import lifecycle: fence the gate, retire all
nine DO classes, remove the backend, purge and remove the bucket/database, then
remove the gate and private keys. If cleanup is interrupted, run the same script
with `--cleanup /absolute/private-artifacts/<run-id>` and the explicit live
opt-in. Keep the private receipt until all owned resources are confirmed absent.

This is an implementation-level prerequisite for the full hosted gate above.
It does not prove whole-repository consistency, lost-namespace recovery,
long-term backup retention, current-authority reconciliation, alarm/socket/job
draining, Vault coverage or safe reopening. Its elapsed time measures the probe,
not an application recovery-time objective.

### Hosted repository drill

The hosted repository harness uses real application requests and native Git transport.
Its first [isolated live acceptance](evidence/hosted-repository-recovery-validation.md)
passes physical application content loss and restore, policy enforcement and
explicit known-authority reconciliation after an older restore:

```sh
NANOHUB_LIVE_CLOUDFLARE=1 bun tools/verify-hosted-repository-recovery.mjs /absolute/account-config.jsonc /absolute/private-artifacts
```

It uses a separate `nh-repo-recovery-*` resource family with the ordinary request
hold always enabled. A private operator transport exists only in this fixture
entrypoint so verification can exercise actual application authentication while
normal routes remain closed. Its configured `seed`, `frozen`, `verify` and
`reconcile` phases live outside restored application storage; unknown phases
close that transport. Provider login flows, WebSockets and live-stream routes
are unavailable. The harness does not run an Actions dispatcher or import job.

The recorded acceptance covers physical DO/D1/R2 content loss, complete Git
clone/fsck and binary/mode/tag comparison, repository addresses, protections,
tag rules, archive fences, reviews/hunk threads, Room issues and MCP attribution.
Constructor registration inventories successful real DO instances, including
internal RPC targets. Checkpoints require a stable retained inventory, no alarm,
no socket, no unpublished objects and no active import. Retained bytes and
expectations are copied to private controller files before mutation.

An older checkpoint intentionally precedes removal/revocation of a collaborator,
Git, CLI, agent/MCP and runner credentials, and synthetic Account tokens. A
separate latest-authority file records those operations. Reconciliation must
deny the old access again, including after restart, without reopening normal
traffic. Synthetic Account values are not real provider or Secrets Store values.

This harness is not a general production restore API. Deleted namespace/name
reconstruction, independently retained long-term backups, general production
draining, current-authority acquisition, Vault/workload-grant integration and
safe public reopening remain part of the complete hosted gate. A passed drill
may establish only its explicitly recorded scope. Interrupted cleanup uses the
same command with `--cleanup /absolute/private-artifacts/<run-id>`.

### Vault-inclusive hosted drill

The vault extension runs the repository acceptance with a separate disposable
Vault Worker and its real Secrets Store binding:

```sh
NANOHUB_LIVE_CLOUDFLARE=1 bun tools/verify-hosted-vault-recovery.mjs /absolute/account-config.jsonc /absolute/private-artifacts
```

Cloudflare currently permits one Secrets Store per account. The harness discovers
that existing store, creates one uniquely named synthetic test entry, and never
creates or deletes the account store. All mutation/deletion targets are checked
against the generated name and observed entry ID. Other entries are observed as
metadata only. No actual application credential is copied into the test value.

The separate fixture Vault exposes the real application service methods plus
operator-key-gated recovery RPCs. Its DO instances join the constructor inventory
and native bookmark checkpoints. An active workload grant has an expiry cleanup
alarm; freezing deliberately records and suspends that Vault-only cleanup alarm
before taking the checkpoint. Other classes must still have no alarms, sockets,
unpublished objects or active import. Verification reads reschedule expiry and
revocation must remove the final alarm. Actual idle runtime eviction remains
under Cloudflare's control.

The acceptance requires secret rotation without redeploying the Vault, revoked
workload access after the current restore, and an older restored grant resolving
the latest provider value rather than rolling the value back. Reconciliation
must revoke that grant again across restart. Disconnect/reconnect must retain
the provider value, and a complete return to the current repository checkpoint
must pass again. Retained R2 bytes and D1 state are checked for absence of both
synthetic value revisions. DO PITR stays in Cloudflare; no provider-value export
or custom plaintext Vault backup is introduced.

Cleanup first removes the application service caller, explicitly retires/deletes
the fixture Vault and then deletes only its synthetic provider entry before R2
purge. A Vault observation/cleanup failure keeps the keys and prevents bucket
deletion. Resume with the same script's `--cleanup` option. Production Vault,
main Worker and existing provider entries remain separate from the fixture.

The extended Git return check accepts a new feature-branch commit between the
two checkpoints. Each point retains its own refs, graph and R2 inventory. Before
restoring, every current R2 object's bytes must match a verified retained copy;
unknown or changed unretained content stops recovery while closed. Only backed
objects absent from the selected checkpoint may be removed. Independent clones
verify the older graph and the later return to the newer graph, in addition to
the authority and provider-value checks.
