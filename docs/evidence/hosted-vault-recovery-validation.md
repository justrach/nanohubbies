# Hosted Vault recovery — 2026-10-28 JST

The vault-inclusive hosted drill passes at implementation
`3e8e9e31ecd01364add82d0aebd6b7a7f740f6cd`. It uses the real separate Vault
service and a real Cloudflare Secrets Store binding, alongside the full
repository recovery fixture. Production application data and actual provider
credentials are not used. The [receipt](hosted-vault-recovery-receipt.json)
records the tested scope and the newer, still-pending extension separately.

## Passed live scope

The controller ran from `2026-10-27T22:53:30Z` to `23:02:43Z`, including
provisioning, two checkpoints, loss/restore, reconciliation, a return to the
current checkpoint and cleanup. This elapsed time is not a production RTO.

The fixture retains **15 instances across ten DO classes**, D1 state and all
17 R2 objects. The extra Vault instances cover staging and a rejected grant in
the wrong environment. The account's existing Secrets Store holds one uniquely
named synthetic entry; the store itself is never created or deleted. Other
entries are observed as metadata only.

The actual application APIs register the binding and issue a workload grant.
An authorized workload reads synthetic revision A; the same token is denied in
the wrong environment. The first checkpoint precedes revocation. Cloudflare
then rotates that entry to B, without redeploying the Vault. A fresh grant reads
B before the current checkpoint is captured.

All application DO contents, fixture D1 identity/CLI tables and R2 objects are
cleared, with loss observed before restoration. Restoring the current point
preserves Git, policies, reviews, anchored hunk threads, archive enforcement,
Room data and MCP attribution. Protected pushes, locked branch creation,
release-tag deletion and unready merge remain denied. Revoked Git, CLI,
agent/MCP, runner and workload access remains denied. A fresh workload grant
still reads **B**.

Restoring the older checkpoint revives the old workload grant privately, but
that grant also reads **B**: restoring application/Vault metadata cannot roll
the Secrets Store value back to A. The independent latest-authority file is
then replayed through real administration APIs. After forced restarts, every
old credential and removed collaborator is denied again, including the workload
grant. Disconnecting the reference retains the provider entry; reconnecting it
and issuing a fresh grant still reads B.

The drill returns to the current checkpoint, compares repository/D1/R2 state,
repeats denials and verifies B again. These two checkpoints have the **same Git
graph**; their permissions and Vault grant metadata differ, and the provider
value was rotated separately between those points.
This live result does not establish return-path acceptance for a newer Git pack.

## Custody, quiescence and idle state

Both known synthetic values are absent from the retained R2 bytes and D1 state.
Vault schemas store references and grant hashes; native DO PITR stays within
Cloudflare, without exporting a plaintext Vault database or provider values.
Detailed artifacts remain private. Public evidence omits provider IDs,
bookmarks, cookies, grant tokens and raw value revisions.

A valid grant has an expiry cleanup alarm. The fixture records and suspends
that Vault-only janitor alarm while checkpointing; grant expiry remains checked
on every redemption. Other classes must have no alarm, socket, unpublished
objects or active import. Verification reads schedule cleanup again; revoking
the final grant removes the alarm. The ending Vault has no grants and no alarm,
while retaining its reference to B. Actual runtime eviction is Cloudflare's
decision and is not claimed as directly observed.

Normal routes remain held across all phases, including deliberate authority
resurrection. **44 held-response checks** cover API, Git and GET/HEAD assets.
The private operator transport ends frozen; no public reopening occurs.

## Cleanup and independent checks

Cleanup removes the application caller, explicitly retires all nine application
classes and the separate Vault class, deletes all three Workers, purges R2 and
deletes the bucket/database. Only the generated synthetic provider entry is
deleted. The account store and its one pre-existing entry remain.

A separate observer confirms all owned resources and that synthetic entry are
absent, both retirement receipts exist, the existing store/entry remain, and
private ingress/grant files are removed. It independently runs strict fsck and
compares all three refs, ten reachable objects, binary bytes, modes, Unicode
branch and annotated tag with the source. The binary is 1,048,593 bytes. The
runtime trace contains 719 sanitized events with zero write failures.

Production main remains `993b659a-8d24-442b-92b4-f5270a94029a`, with normal
traffic, 27 bindings and its 50,000-subrequest budget. Production Vault remains
`02dcb88b-5c99-49d9-a4b6-cb95451e6bb5`. Those control-plane observations are
recorded at `23:03Z`. A later public main check at `2026-10-28T00:53:34Z` returns
HTTP 200 and reports the expected main version.

At the live-tested commit, pinned tsrs and 43 local fixture tests pass. No main
or production Vault deployment occurred. Source is committed locally and has
not been pushed to GitHub.

## Changing-Git extension: not yet cloud-accepted

Implementation `e677947d88fdf5f7aad10fec371797eb5f0cffdf` accepts another Git
commit between points and retains each point's refs/graph. Before overwriting
or deleting R2 data, it requires every live object to match a verified retained
return copy. Unknown keys or changed unretained bytes stop the restore while
closed. Only verified newer objects absent from the selected point can be
removed. Older and returned-newer clones must independently pass fsck and exact
graph comparisons. Pinned tsrs and **46 local tests** pass, including refusal
tests for unretained data.

Two hosted attempts stopped before application/Vault deployment: bucket creation
failed with Wrangler `fetch failed`, then a fresh attempt failed during D1
creation with the same connectivity error. Both lifecycle cleanups confirmed
their generated resources absent. Later independent reads confirm both databases
remain absent; the first attempt also has a separate bucket-absence check. Neither
attempt requested a Secrets Store entry. Subsequent
IPv4/IPv6 control-API connections timed out, while Nanohub's public endpoint
responded. No credential rotation or scope change was made in response.

The stronger live gate remains pending. Do not use the earlier passing run as
evidence for that newer controller or for changing-Git-point recovery. Long-term
backup operations, namespace-loss recovery, general production draining,
independent current-authority acquisition, measured RPO/RTO, safe public reopening
and actual application CI/staging/cutover also remain release requirements.

## Later attempts and resumable cleanup

Two further attempts on October 28 still did not reach the recovery probe.
The first stopped at provider-entry metadata discovery with `fetch failed`,
before requesting a provider entry or deploying the application/Vault. During
cleanup, a lost control-plane response left the bucket already deleted. A
subsequent fence deployment tried to bind that deleted bucket and failed with
Cloudflare error 10085. Commit `c01df26` corrects this isolated-fixture resume
path: observe actual resources and deploy the purge-only gate without an R2
binding when the bucket is already absent. The purge endpoint cannot report
successful deletion without a bucket binding. Cleanup then completed, with an
independent all-resources-absent observation at `2026-10-28T02:21:21Z`.

The next attempt provisioned the synthetic provider entry and separate Vault,
uploaded application assets and then lost the application deployment response
with another `fetch failed`. Recovery checkpoints were never reached. Cleanup
observed the possible deployment, explicitly retired all nine application
classes and the Vault class, deleted the synthetic provider entry and removed
all three Workers, bucket and database. A supported-Node observer independently
confirms absence, required retirement receipts, retention of pre-existing
provider entries and removal of private key files at
`2026-10-28T03:39:31Z`.

That second attempt experimentally ran Wrangler under Bun. Wrangler reported
this runtime unsupported, and a bucket observation returned an incomplete
success response that the strict verifier correctly refused as absence proof.
Cleanup finished using Wrangler's supported Node runtime. Commit `9cc2190`
removes the experimental override; Bun still launches the commands through
`bun x`, without npm. These attempts establish cleanup behavior, not successful
changing-Git recovery.

The current fixture checks pass pinned tsrs plus **53 cases**: 23 lifecycle,
10 proxy/provider-observation and 20 recovery cases. Read-only provider
observations have a three-attempt limit, 30-second per-attempt timeout and
one/three-second backoff for recognized connectivity failures. Mutations,
authorization denials and explicit missing-resource responses are not retried
by that helper. Unknown mutation outcomes require fresh observations and the
resumable cleanup path. No production application/Vault deployment occurred.

## Restore failure and data-plane phase guard — October 28

A later supported-Node run at controller commit `ddb6df2` reaches the recovery
probe. It captures distinct Git points with 17/19 retained R2 objects and accepts
a Git commit between them. Both points cover 15 Durable Objects across ten
classes. Corrupt retained bytes are refused before loss; physical application
loss and a provider-side rotation without Vault redeployment are observed.

Acceptance then fails: the repository read after restoring the newer point
returns HTTP 503. The original response body/code is not retained, so the cause
is unproven. Older-history clone and newer-return clone checks are not reached.
The [guard receipt](recovery-phase-guard-receipt.json) records this failed gate
without converting partial results into a successful recovery claim.

Independent provider reads at `2026-10-28T13:24:43Z` confirm all three Workers,
the database, bucket and generated provider entry absent, ten class retirement
receipts present, original provider entries retained and private keys/grants
removed. Production main remains `c5be9de5-8aa1-4a54-bcd9-5f4e067a542a`; production
Vault remains `02dcb88b-5c99-49d9-a4b6-cb95451e6bb5`.

The controller previously checked deployment metadata before advancing a phase,
without observing the data plane. The new candidate adds a private, read-only
phase/version observation, both before seeding and after each phase deployment.
It waits at most 90 seconds for the exact deployed version and phase with the
ordinary traffic hold still present. Unknown configuration, failed reads and
timeouts stop the drill closed. Only those metadata observations are polled;
application and storage writes are not retried. Future failures retain only the
known `fixture_frozen`/`recovery_hold` codes from a bounded error body, never
arbitrary application messages or credentials.

Pinned tsrs and **57 fixture cases** pass: 23 lifecycle, ten proxy/observation
and 24 recovery cases. A supported Node 24 helper check also passes. This closes
a harness readiness/diagnostic gap and addresses a possible deployment
propagation race; it does not prove the original 503 cause or successful hosted
changing-Git recovery. Fresh cloud acceptance remains required.

## Distinct Git points expose a stale reconciliation assertion

The next hosted run at `f563f7d` passes the new phase/version observations and
does not reproduce the 503. It restores the newer Git point after loss, then
rolls back to the older point. Independent local verification of the two clones
passes `git fsck --strict` and exact checkpoint refs/graphs: three refs each,
with **10 older objects and 13 newer objects**. The rollback removes two R2
objects only after matching retained return copies. Older credential
resurrection is demonstrated while the Cloudflare value remains current.

The drill then fails its ref comparison after known-authority reconciliation:
it still expects the newer point while the selected older point is correctly
present. This assertion came from the earlier same-Git-point drill. The
[checkpoint invariant receipt](recovery-checkpoint-invariant-receipt.json)
preserves the failure, partial clone evidence, phase observations and independent
cleanup; it does not claim the return to the newer point passed.

The correction requires exact **older checkpoint refs** through authorization
reconciliation. It also requires distinct refs and object graphs before the
changing-Git drill starts loss, so an identical-point fixture cannot satisfy
this gate. The later restore and independent newer-return clone remain
mandatory. Pinned tsrs, all 24 recovery cases and Node syntax checks pass; a new
complete hosted run is still required.

Independent reads at `2026-10-28T13:52:17Z` confirm all generated resources gone,
required class retirement receipts present, original provider entries retained,
private keys/grants removed and both production Worker versions unchanged.

## Operator binding preflight

The first `c188939` attempt stops at D1 creation with Cloudflare authentication
error 10000. The existing login subsequently verifies with D1 write scope. A
second attempt creates both checkpoints but stops before physical loss: the new
assertion incorrectly references `older`, while the captured snapshot variable
is named `old`. Syntax checks and the TypeScript-only fixture check do not catch
that JavaScript name error. The [binding-preflight receipt](operator-binding-preflight-receipt.json)
records both failed attempts and independent all-resources-absent observations;
neither is counted as recovery acceptance.

The reference now uses `old` consistently. A pinned tsrs binding/syntax preflight
checks the four critical Node operator modules before a fresh recovery run can
create provider resources. It also runs in the project check and recovery test
commands. Cleanup skips this preflight so a source error cannot prevent cleanup.
The compiler reproduces all three unresolved references before correction and
passes afterward. Two real-compiler regression cases cover ordinary references,
object shorthand, corrected bindings and missing inputs.

This is explicitly a scope-only JavaScript check using `--noResolve`, with the
used Node declaration files supplied directly. Other JavaScript type errors are
outside its claim. Full API/Worker tsrs checks remain separate. All 26
recovery/compiler cases pass, as does the project check across three workspaces
(one unchanged workspace result is cached). The supported Node 24 preflight
also passes. No dependency or production deployment is added. Complete hosted
changing-Git acceptance remains pending.

## Native checkpoint observation failure and bounded read retry

The next run at `dcc4a79` passes the new binding preflight and accepts a Git
commit after the first checkpoint. Capturing the second point fails with HTTP
500. The stack identifies the private Vault checkpoint RPC, before physical
application loss. The original provider exception/flags are not retained, so
its cause and retryability remain unknown. The
[checkpoint-read receipt](checkpoint-read-retry-receipt.json) preserves this
failed gate and cleanup evidence.

Independent reads at `2026-10-28T14:28:21Z` confirm all generated Workers, D1, R2
and the synthetic provider entry absent; required class retirement receipts and
original provider entries remain, private keys/grants are removed and production
main/Vault versions are unchanged. A public production version read during the
drill also returns HTTP 200 from the unchanged main Worker.

The new private-fixture helper retries only a checkpoint observation explicitly
marked `retryable === true`. Each attempt creates a fresh stub. Overload,
malformed flags, authorization and unclassified failures stop immediately.
Three attempts with one/two-second backoff are the maximum. Loss, restore
scheduling, ref changes and other application/storage writes are not passed
through this helper. Successful checkpoint responses retain the read-attempt
count. This follows [Cloudflare's error-handling guidance](https://developers.cloudflare.com/durable-objects/best-practices/error-handling/),
which distinguishes retryable idempotent operations from overload and recommends
recreating a stub after exceptions. It does not retroactively classify the
unobserved original exception.

Pinned tsrs and **63 local cases** pass: 23 lifecycle, ten proxy/observation,
28 recovery and two real-compiler cases. Tests include the actual private
control handler, fresh stubs/backoff, bounded exhaustion, rejection of overload
and malformed flags, and exactly one invocation of a failed mutating loss RPC.
No production service is redeployed. Full hosted changing-Git recovery,
including return to the newer point, remains a required unpassed gate.

## Phase-only asset session failure reconciliation

The run at `647bcd2` captures both distinct Git checkpoints and restores the
newer point after physical application-state loss. Exact Git graph/binary/mode/tag
checks pass and the restored application still reads the latest provider value.
All 30 checkpoint observations succeed on their first attempt; this run does not
exercise the checkpoint-read retry on an actual provider exception.

Before older-point rollback starts, the next phase deployment stops at the
owned Worker's `/assets-upload-session` endpoint with Cloudflare error 10013.
Older rollback and return to newer therefore remain unpassed. Independent reads
at `2026-10-28T14:54:04.798Z` confirm all generated resources and private keys gone,
original provider entries retained, required namespace retirement receipts
present and production main/Vault versions unchanged. The
[phase deployment receipt](recovery-phase-deploy-receipt.json) retains the failed
gate and cleanup hashes.

The installed Wrangler 4.151.0 deploy path awaits `syncAssets` before its Worker
code upload and deployment requests. The controller now permits one retry only
for that exact asset-session error, only for its already-existing generated
repository/Vault recovery app. Before the first attempt it verifies the current
version and owned binding graph. Before retrying it independently re-reads the
active version and complete immutable resource metadata, including bindings,
script and runtime settings. The previous version, complete resource hash and
traffic hold must be unchanged. A private proof receipt must persist before the
second attempt. Success requires one valid version acknowledgement, matching
active provider version, target phase and the existing data-plane phase barrier.

Authentication, transport/timeouts, killed or truncated CLI execution,
post-upload acknowledgements, unknown outcomes, changed metadata, failed reads
or failed receipt persistence stop closed. A second failed attempt stops too.
Initial deployments, secret changes, restoration, Git writes and resource
deletion do not use this helper. The generic provider wrapper still retries
only its allowlisted observations. Ten new fault-injection cases pass under
both Bun and Node. All **73 local cases** pass (23 lifecycle, ten proxy/provider,
28 recovery, ten phase-deployment and two compiler cases); both fixture tsrs
checks and the five-operator binding/syntax preflight pass. The project check
also passes with three unchanged workspace results cached. These local results
do not substitute for complete fresh hosted recovery acceptance.

The fresh `b32ed7a` run passes 13 phase deployments and data-plane observations,
all on their first attempt. No actual provider failure exercises the new
conditional deploy retry. The newer checkpoint restores successfully; the
older rollback passes clone/fsck and exact refs/graphs, removes only two backed
newer R2 objects and reproduces old credential resurrection with the latest
provider value retained. Reconciliation denies the independently known revoked
access again, including after restart, and preserves the selected older Git
point. Disconnect/reconnect also retains the current provider value.

The final return to the newer point stops on a connection reset during a
mutating DO restore-scheduling control request. The outcome is unknown; the
controller does not retry that mutation. The full gate remains failed. The
controller used Bun 1.4.4; Wrangler subprocesses used supported Node. This
identifies the runtimes, not the cause of the connection reset. The controller
now records its own runtime separately from Wrangler's runtime for future runs.

Independent checks at `2026-10-28T15:28:52.968Z` confirm all generated resources
absent, original provider entries retained, private keys/grants removed and
production versions unchanged. Separate Git checks at `15:29:56Z` pass strict
fsck and exact checkpoint refs/graphs for both completed clones: three refs each,
13 newer objects and ten older objects. The receipt retains these partial
results without claiming successful return to the newer point.

The fresh Node 24.14.1 controller run at `d3dee71` stops before repository
seeding with `UND_ERR_CONNECT_TIMEOUT` on an initial HTTP fetch. It does not
establish a fix for the preceding reset or any new recovery acceptance.
Independent checks at `2026-10-28T15:34:05.247Z` again confirm all generated
resources and keys absent, original provider entries retained and production
versions unchanged. No destructive request from either failed run is replayed.

Subsequent read-only connectivity checks are mixed: Node times out connecting
to the public production host, then receives the expected 404 from the deleted
owned test host. Bun receives 200 from production and 404 from that test host;
curl also receives 404. These observations show intermittent connectivity, not
its cause, nor evidence that a controller runtime change fixes it. Both runs
are terminal and independently cleaned; no full gate is inferred from the
successful read-only requests.

At `4ee6539`, four read-only Node checks return the expected production 200 and
deleted-test-host 404 responses. A further immediate two-host check also passes
before starting fresh isolated resources. The ensuing Node controller run
passes provisioning and its first phase/version barrier, then stops during the
first snapshot after three successful checkpoint reads. The fetch cause is
`read ECONNRESET`. No complete checkpoint or destructive-loss phase is reached;
the exact interrupted request is not identified by the retained Node stack.
The failed gate is preserved rather than classified as an eligible mutation
retry. The new dispatcher access check does not run inside this recovery probe
and does not resolve the transport failure.

Independent checks at `2026-10-28T15:53:58.124Z` confirm all generated resources,
provider entry and private keys absent, original provider entries and required
retirement receipts retained, and production main/Vault versions unchanged.
The trace retains 144 events with zero write failures. This attempt is terminal
and cleaned; full changing-Git recovery acceptance remains unpassed.

Three later attempts against the current runtime are recorded in
[recovery readiness validation](recovery-readiness-validation.md). They exposed
phase refusal, startup readiness and transport failures, with independent cleanup
and unchanged production versions. Controller and CI corrections pass local
validation; the complete changing-Git rollback-and-return gate remains open.
