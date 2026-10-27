# Local cold recovery acceptance — 2026-10-27

The [machine receipt](cold-recovery-receipt.json) records the actual isolated
run, source file hashes and verification scope. This extends restart tests to
physical application storage loss. The production Worker, vault service,
repositories and credentials were untouched. No hosted restore was attempted.

## Verified result

The fixture stops all Workers before taking a private snapshot of Durable
Object, D1 and R2 persistence. The accepted checkpoint contains 78 files and
3,307,546 bytes. Application state and cache are physically removed, and the
test observes a missing repository, missing D1 identity table and empty R2
inventory before restoring. Both source and restored file bytes are checked
against the expected digests. Corrupting a saved file rejects restoration
before removing the current fixture state.

After restoration, actual Git mirror clone/fsck and comparisons verify all
refs and reachable objects, an annotated tag, a Unicode branch, a binary asset
over 1 MiB, executable mode and a symlink. The canonical owner/repo address,
default configuration, graph, policy/ruleset objects and revisions, policy audit,
Room issue and agent work record match the checkpoint. PR state, independent
review and the unresolved hunk conversation match too. Removed reviewers retain
historical attribution and contribute no approval authority.

Protected direct pushes, locked branch creation, tag deletion and an unready
merge remain rejected. Hub, Sequencer and Room retain a second repository's
archive fences; even its owner cannot create an issue there. Anonymous reads
remain denied. D1 identity links and the revoked CLI row are recovered exactly.
Git, CLI, agent/MCP, runner and workload credentials revoked at the checkpoint
remain denied, as does the removed collaborator.

The separately simulated Cloudflare Secrets Store is not in the snapshot and
is not removed. Neither the original nor rotated secret value appears in the
application backup. A newer provider rotation survives restoration of either
application checkpoint. A fresh authorized workload grant resolves the rotated
value; revoking it leaves no vault wake-up alarm.

## Older backup authority hazard

The test deliberately restores an older checkpoint taken before the same
removals/revocations. The removed collaborator can read again. The old Git and
CLI credentials work, the official MCP SDK can reconnect and list tools, the
runner can claim, and the old workload grant can redeem. This is confined to
synthetic loopback resources and is a **negative recovery finding**, not an
accepted production reopening path.

Using the independently retained intended authority, the fixture reapplies
membership removal and all five credential/grant revocations through ordinary owner APIs.
Those requests are denied again after another Worker restart. No privileged
production recovery endpoint or authentication shortcut was added.

The [hosted recovery gate](../recovery.md#hosted-recovery-release-gate) therefore
requires independent current-authority reconciliation before exposure. The
current application does not automatically distinguish an older restored valid
credential from its original valid record. A backup's integrity alone cannot
establish current authorization.

## Other gates and limits

All 267 API unit tests and 210 repository unit tests pass, along with the complete
real Worker/Git repository chain including this drill. Pinned tsrs passes all
three workspaces. The focused recovery command passes again with explicit D1,
R2, private-read and nonempty PR/discussion inventory assertions. Diff checks
pass. No runtime or frontend source changed, so deployment and UI builds were
not repeated for this test/documentation change.

This is Miniflare persistence recovery, not a Cloudflare PITR receipt. It does
not establish live bookmarks, retained independent production backups, full
resource enumeration, active imports or alarms during recovery, an atomic
cross-service checkpoint, automated revocation reconciliation, recovery from
account/infrastructure loss, a measured RPO/RTO, unattended hosted CI, staging
acceptance or traffic capacity. The production-readiness recommendation remains
a controlled private beta with backup mirrors.
