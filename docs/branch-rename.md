# Branch renaming

Branch rename is published in CLI **0.4.20** and the production UI. The
[release acceptance](evidence/branch-rename-release-validation.md) includes nine
frozen Linux gates, public installation, a live rename and lock rejection.
This follows GitHub's [head-PR closure and base-PR retargeting behavior](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-branches-in-your-repository/renaming-a-branch),
with the explicit restrictions and compatibility limits below.

## UI and CLI

On **Branches**, choose **Rename** beside a branch. Enter the new name, then
review its actual default-branch and PR effects before confirming. The inline
form preserves the entered name on errors. A stale preview requires another
review; an uncertain response offers branch inspection and is never replayed
automatically. Escape from the input closes the form and returns focus to its
row action. Confirmed completion focuses the result notice.

```sh
nh branch list -R owner/repository
nh branch rename feature/old feature/new -R owner/repository
# Optional: require the exact opaque revision previously inspected.
nh branch rename main trunk --revision REVISION -R owner/repository
```

Both `nh` and `nanohub` use the native API. The CLI observes the current source
commit and storage revision before sending one conditional write. It does not
rename a local branch or change local configuration. Existing CLI credentials
gain no permission: authorize the separate **branches:write** scope explicitly.
This scope does not grant Git clone or push permission.

Current repository writers may rename unprotected non-default branches.
Default branches and branches covered by classic protections or configured
branch rulesets require current admin/owner authority. Readers, ordinary agent
tokens and Git-only credentials cannot use the rename writer. The sequencer
independently refreshes native/external membership and delegated CLI authority.

## Atomic effects and protections

One synchronous sequencer transaction:

- Renames the ref while preserving its exact commit and tree IDs; changes the
  symbolic default when needed, without rewriting Git objects.
- Retargets open PRs based on the branch. Open PRs with that head close with
  their final head/tree retained; reviews and conversations remain available.
- Retains original reviewable-push provenance. A rename administrator does not
  become the code pusher or make the original pusher an independent approver.
  A derived audit entry links back to the original event and names the renamer.
- Combines source and destination classic requirements into the new exact rule
  when source protection exists. Exact source rules move; wildcard rules keep
  their other targets. Their captured requirements also protect the new name.
- Updates applicable ruleset includes in place, preserving IDs, rules, bypass
  actors and enforcement modes. A moving default target follows the pointer.
- Supersedes old-name CI and its read/completion leases. The new-name run is
  queued afresh; an older same-SHA result cannot stand in for that event.
  Shared capacity is still held until the existing controller confirms cleanup.
- Saves branch-browser aliases and attributed rename/policy audit events.

Locks block rename, including for admins. Allowed-pusher and applicable graph
and deployment restrictions still apply. The destination passes its existing
normal ref-creation policy before source requirements move. Source creation,
deletion and naming rules can also block rename; explicit ruleset bypass stays
human-only and attributed, as on other ref writes. CLI credentials do not inherit
a browser bypass. No rename changes permission membership or secret grants.

A ruleset that deliberately excludes the destination is not silently weakened.
Reconcile it explicitly first. Classic combined requirements, rule-pattern counts
and stored aliases retain their bounds; an unrepresentable combination fails and
rolls back. A late failure restores refs, default, policies, PRs, CI, aliases,
revisions and audit together. These restrictions are stricter than unrestricted
administrative renames and are not presented as complete GitHub equivalence.

## Revision and compatibility contract

`GET /api/trunks/:id/branch-rename` returns protocol 1, the current branches,
default, permissions and an opaque SHA-256 revision. Add `from` and `to` query
parameters for a preview. Owner/repo namespace aliases expose the same resource.

`POST` accepts only `{from,to,commit,revision}`. Delegated CLI writes require
`If-Match: "branch-rename-REVISION"`. Missing headers return 428; stale writes
return 412 for CLI or 409 for browser requests. Request JSON cannot supply graph
proofs, actor identities or credential IDs.

Persistent triggers fence refs, PR rows and aliases, including older SQL writers
and ref ABA changes. The revision also incorporates classic/ruleset/default and
archive authority. Recreating a lost revision ledger creates a new generation;
it does not reconstruct an earlier token. This is a conditional-write mechanism,
not protection against restoring an entire older authority checkpoint; the
[recovery release gate](recovery.md#hosted-recovery-release-gate) still applies.

Older RPC receivers return retryable 503 before rename, with no create/delete
fallback. Branch alias reads similarly report an updating receiver. Deploy and
verify the server before distributing a client that uses this new operation.

## Links and local clones

Only the branch file browser resolves rename aliases. Its URL changes to the
current canonical name while keeping the selected path. A real branch recreated
under the old name wins over that alias; a missing target is not redirected.
Chains flatten and reverse renames do not create loops. The alias cap is 10,000.

Git fetch/pull and raw endpoints do not redirect old names. Workflows and external
branch references are not rewritten. Update local tracking branches and any
workflow filters deliberately. Existing commit-addressed history remains intact.
