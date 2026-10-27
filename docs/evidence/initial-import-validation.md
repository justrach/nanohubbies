# Complete initial ref publication and actual Meld migration

The [sanitized receipt](initial-import-receipt.json) pins implementation
`411dc97`, executed source, the actual Meld graph, deployment and cleanup.
Main Worker `d8d8a177-a2db-469a-9b18-d6d630a0ade5` serves the receiver changes.
CLI 0.4.11 retains its existing immutable bytes.

## Initial publication and limits

Meld has 178 branches. Storage supported 10,000 refs, but the planner and final
writer capped an atomic push at 100. The migration would upload objects and
then fail to publish the complete ref set.

Empty Git repositories now accept up to 10,000 creations atomically. The final
transaction independently rechecks emptiness and creation-only operations.
Populated repositories retain the ordinary 100-update cap. Graph, name, archive
and policy checks still apply; a denied late ref rolls back all refs and CI
scheduling. Discovery uses the actual writer's supported limit. Older/mixed
receivers default to 100, and oversized imports stop before upload. Shallow
sources are refused before contacting a destination.

Both configurations and the deployed version explicitly budget 50,000
subrequests. Cloudflare's [paid-plan default is 10,000](https://developers.cloudflare.com/changelog/post/2026-02-11-subrequests-limit/);
graph validation can read R2 once per object. This budget does not prove hosted
memory/CPU/latency capacity. Upload and graph bounds remain. No binding, secret
or runtime value is added or replaced by this configuration change.

## Actual complete Meld graph, local receiver

Existing Git access fetched full branch/tag history into a separate private
non-shallow bare snapshot. Original worktrees and remote refs remain unchanged.
The source has **178 branches, 957 commits, 7,402 trees and 9,738 blobs**:
**18,097 objects and 621,196,033 expanded bytes**. Its largest object is
3,681,359 bytes. It has no tags; synthetic Git acceptance covers tag preservation.

The actual tool uploads this graph into real isolated local Worker/DO/D1/R2,
publishes all refs together, then independently mirror-clones it. Strict fsck,
exact branch/tag object IDs and branch trees/modes pass. Content-addressed graph
identity covers binary assets and history. The source ref digest stays unchanged.
The run takes 304,928 ms including upload and clone verification; the fixture is
destroyed. This is a local measurement, not a production SLO.

This verifies committed Git migration, not Meld application CI, GitHub
issues/reviews import or hosted Nanohub migration. It neither deploys Meld nor
changes staging or primary remotes. LFS and submodules remain unsupported.

## Regression and fresh Linux acceptance

Local gates pass **294 API unit cases**, **225 repository cases plus the full
real Worker/Git chain**, three-workspace pinned tsrs, full OpenNext build and
Wrangler dry run. A late creation-rule denial proves zero partial refs/CI
attempts; removing only that synthetic rule permits the large import. HTTP and
direct final-writer tests reject large follow-up batches. Preflight tests prove
old receivers receive no uploads and shallow sources cause no HTTP requests.

Fresh source `3f55045f1059a1272c204d60ef4f2c0f37c6054a` passes all eight real
Codegraff gates: frozen offline install, unit, full repository, CLI, access/vault,
hosting/pool, build and tsrs. All 11 changed runtime/configuration/test files
match by SHA-256. The candidate runs offline in the retained private image,
without control keys, npm/npx or Docker socket. VM destruction is independently
confirmed. This VM runs Nanohub's gates; it does not receive the private Meld
graph or establish hosted callback acceptance.

## Production scope

Fifteen assets match exact build bytes and appropriate MIME types. Public CLI
0.4.11 executes with its unchanged manifest/hash. All 27 binding metadata entries
are unchanged; Worker-first routing stays enabled and the hold stays off.
Cloudflare version metadata confirms `subrequests: 50000`.

Nine canary resources match before/after: branches including PR/review/CI state,
protections, rulesets, default branch, archive, environments, collaborators,
secret metadata and runners. Read-only discovery advertises 10,000 initial refs
and preserves the canary's six refs. The temporary verification tab is closed.
No production credential, ref, policy, secret, runner or review is created or
changed. No vault deployment or GitHub push occurs. Hosted large-graph import,
unattended CI/staging callbacks, hosted recovery and traffic/security acceptance
remain release gates.
