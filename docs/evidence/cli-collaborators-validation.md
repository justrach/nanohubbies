# Collaborator CLI — local acceptance, 2026-10-29

Local CLI 0.4.16 adds `nh access list/invite/recover/role/remove/cancel` and the
separate `collaborators:write` permission. This is source/packaged local acceptance,
not a production deployment or publication. Public CLI 0.4.15, the main Worker,
Vault bindings/values, production credentials and Git refs were not changed.

## Checks

- **361 API unit cases** pass. These include five new collaborator administration
  cases and the existing access/vault, runner, review, protection and quota tests.
- **64 CLI cases** pass, including private invitation files, same-ID recovery,
  canceled-invitation rejection, exact confirmation/revision checks, capability
  refusal, secret redaction and default-versus-explicit device permissions.
- The focused access gate passes eight unit cases plus the existing real
  collaborator/vault Worker test and both source and packaged collaborator CLI
  Worker integrations. Counts overlap the API unit suite.
- The clean final repository chain passes **278 unit cases** and the complete
  real Worker/Git/review/protection/CLI/archive/cold-recovery integrations, ending
  with cold recovery at `2026-10-29T08:21:18.780Z` and process exit 0.
- Root operator binding validation and pinned tsrs checks pass. Next's optimized
  web build passes. Bun 1.4.4 frozen/offline install accepts the workspace version
  change with no package/dependency changes. `git diff --check` passes.

## Behavior verified

The real local Worker creates an independently managed Git repository with an
owner, admin, writer and reader. A source or bundled CLI saves a mode-0600
recipient-bound invitation file before POST. The test-only proxy drops a
successful invitation acknowledgement; the file remains usable and `access
recover` returns exactly the same invitation without another record, audit
event or extended expiry. Server storage contains token hashes; neither hashes,
tokens nor the acceptance URL appear in CLI output or returned metadata. The
private file contains the fragment-based browser acceptance URL.

Wrong-account acceptance fails. Revoking the original issuing CLI grant denies
new CLI requests but preserves the invitation's independent lifetime. The
intended recipient accepts with their own session. Later CLI role change to
reader allows a real clone/fsck but rejects a push using that recipient's earlier
write-capable credential. Removing the recipient denies subsequent API/Git
requests. Recovery cannot resurrect the accepted invitation after that removal.

Ordinary read grants and unrelated repository grants cannot administer access.
Writer issuance is denied. Missing/incorrect If-Match, stale observations after a
browser invitation and unknown fields are rejected. Admins can change ordinary
member roles, but cannot grant/remove admin access; owners cannot remove their
own immutable owner entry. A direct final Hub RPC after admin demotion is denied
independently of the earlier gateway read. Archive preserves inspection and
rejects edits/new grants. Rename aliases and Worker restart retain state/audit.
An external-team connection rejects the new scope and does not inherit direct
collaborator overrides. Explicit device consent grants the new permission;
default CLI login does not request it. CLI revocation takes effect on the next
request. Audits retain actor/target/action/time and CLI credential ID.

Unit tests additionally verify expired/canceled invitation tombstones, altered
recovery-token conflicts, storage-level revision changes, isolation between
repository revisions, mixed RPC receiver refusal without legacy fallback and
schema initialization after a transaction rollback. CLI file tests reject
symlinks, oversized/readable files, checkout locations and another host/repository.
Existing runner private-file tests pass after extracting their common primitives.

## Regression correction and limits

The first broad repository run stopped at an old ruleset test expecting 404 for
the unsupported collaborator resource. The new resource correctly returns 403
for a grant lacking `collaborators:write`. Three older ruleset/protection/general
CLI tests now assert that explicit insufficient-scope response and its challenge;
other unsupported resources still return 404. The remainder of the chain,
including cold recovery, passes with those assertions, followed by a clean final
repository run.

No live production grant, invitation or membership change was made. The local
packaged CLI is not a published release; mixed old/new servers must fail closed
until deployment. Retained invitation recovery records have no pruning policy.
Current production Actions activation, intended-application staging/cutover,
changing-Git hosted recovery, load/SLO and broader GitHub parity remain open.
See [the command and permission contract](../cli-collaborators.md).
