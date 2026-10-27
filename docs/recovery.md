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

The fence is implemented and verified in an isolated hosted Worker. Main-site
rollout is pending the full regression gate; see the [rollout evidence](evidence/recovery-hold-validation.md).
An earlier main-site build does not honor this variable. Verify an aware
deployment and actual held responses before relying on it.

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
