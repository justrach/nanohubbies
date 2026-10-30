# Hosted changing-Git rollback and return — 2026-10-30

**The complete isolated changing-Git/Vault recovery drill passes.** Source
`25e22154f1f2dbda522667c591a5fd3049171c47` runs as `mvusx0y3-8f6333fc5e`.
The controller exits zero, reports acceptance and cleanup complete, and a
separate observer independently verifies Git data, cleanup and production
versions. The [receipt](hosted-changing-git-recovery-receipt.json) records the
checks and retained evidence hashes. Earlier failed attempts remain failed.

This is an in-place exercise on newly owned application resources, with private
operator endpoints and ordinary requests held. It is not a production restore,
namespace-loss recovery, actual Meld backup, unattended recovery service or
permission to reopen a production repository.

## Checkpoints, loss and return

The synthetic repository has three refs, including a Unicode branch and an
annotated tag, a 1,048,593-byte binary, executable and symlink modes, reviews,
hunk conversations, locks, rulesets, archive state and multiple credential types.
One accepted Git commit changes the graph between checkpoints. A separate Vault
uses one synthetic entry in the existing account Secrets Store; other entries
are observed only as metadata and are not resolved or modified.

| Checkpoint | DO instances/classes | Retained R2 objects/bytes | Git objects |
| --- | --- | --- | --- |
| Before revocations | 15 / 10 | 17 / 18,846 | 10 |
| After revocations and Git update | 15 / 10 | 19 / 20,440 | 13 |

The drill rejects corrupted backup content before storage loss. It then observes
the application storage empty and restores the newer checkpoint using native
Cloudflare DO/D1 recovery points and independently retained, checksum-verified
R2 bytes. Exact Git refs, graph, binary bytes, modes and tags match. Reviews,
archive and protection metadata match, prohibited push/tag deletion/merge
operations remain denied, and revoked authority remains denied.

Next, restoring the older checkpoint produces its distinct older Git graph and
demonstrates the authority hazard: an older backup can revive credentials and
workload grants revoked afterward. The latest captured revocations are retained
outside that selected checkpoint and explicitly reapplied while normal traffic
stays held. Restart checks deny access again. This does not establish how an
operator would independently acquire every latest production authority record.

The final return to the newer checkpoint succeeds. Fresh clones of the older
point and newer return pass `git fsck --strict` and match each point's refs and
object graph. The observer separately verifies refs, tree, binary hash, modes,
Unicode branch and annotated tag. Two extra R2 objects are removed only after
their bytes match retained copies and the selected older point excludes them.
Unknown or unretained changed objects cannot be discarded to make restore pass.

## Cloudflare-owned values and runtime idling

The provider value is rotated without deploying the Vault again. Both the newer
restore and an older revived workload grant resolve the latest provider value;
restoring application metadata does not roll the saved value back. Both
synthetic value revisions are absent from retained application backup data.
Disconnect/reconnect retains the value. Workload revocation is denied after
restart, and the final Vault has no active grants or scheduled cleanup alarm.
Actual runtime eviction remains Cloudflare-controlled.

## Phase deployment, cleanup and production preservation

All 15 held phase deployments retain the existing asset collection and pass
complete provider resource comparison after normalizing only the phase value.
Each acknowledged version is confirmed on the data plane. There is no replay
of an unknown deployment result. The [retained-assets correction](recovery-retained-assets-validation.md)
avoids another asset completion token for these phase updates. The initial
deployment still uploads the actual built assets normally.

There are 44 explicit held-traffic checks. The trace retains 1,211 events with
zero write failures. All functional assertions complete before automatic cleanup.
The application and Vault explicitly retire all ten DO classes; the owned API,
gate and Vault Workers, bucket, database and synthetic provider entry are then
deleted. A separate provider observer confirms absence and verifies retirement
receipts, retained account store/original entry metadata, and removal of private
fixture keys and grants.

Fresh before/after provider and public reads agree: production main remains
`a37ab061-a029-4480-9fb9-2b7cefeb19e3` at 100%, with 27 bindings, a 50,000-subrequest
budget and normal traffic enabled. Production Vault remains
`02dcb88b-5c99-49d9-a4b6-cb95451e6bb5`. No production ref, request hold, grant or
secret value is changed. The controller and both independent observers are terminal.

The parent process receipt's broad resource label is clarified after completion:
production application resources are not bound, but the existing account Secrets
Store hosts the owned synthetic entry. Its original receipt is retained privately;
the native fixture manifest already distinguishes these resource categories.

## Validation scope and remaining requirements

Local acceptance passes 95 Bun and 27 Node fixture/protocol cases, including an
actual Wrangler multipart dry-run, plus pinned tsrs, eight operator binding
targets and the three cached workspace type tasks. Counts overlap; operator
checking is a binding/syntax check, not full JavaScript type checking. All source
hashes from that correction still match the cloud run. No fresh nine-gate Linux
acceptance is claimed for this operator-only change.

Production inventory and isolation/draining, independently acquiring latest
authority, lost namespace identities, retained long-term backups, production-scale
RPO/RTO, resumption and safe reopening remain open. The fixture is small and its
exercise duration is not a production recovery-time objective. Actual Meld
CI/staging/cutover, hosted Actions activation, traffic/security/operations and
broader GitHub parity remain open in [production readiness](../production-readiness.md).
