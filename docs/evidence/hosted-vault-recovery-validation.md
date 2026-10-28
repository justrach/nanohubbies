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
