# Draft pull requests

The source candidate adds draft PRs and CLI **0.4.22**. Production still serves
0.4.21 until frozen release and hosted acceptance complete. These controls follow
[GitHub's draft PR lifecycle](https://docs.github.com/en/pull-requests/reference/pull-requests):
unfinished work can stay open for feedback, but cannot merge until marked ready.

## Behavior

Choose **Create as draft** when opening a PR. Drafts remain in the Open list,
display a Draft status and retain their live branch, comments and reviews.
**Mark ready for review** enables the ordinary merge path; **Convert to draft**
blocks it again. Readiness never supplies an approval or waives a branch lock,
required check, deployment, conversation or current-membership requirement.
Changing readiness does not change Git refs or erase reviews. Later file/base
changes still follow the normal stale-review policy.

Draft creation runs the same pre-PR checks as ordinary creation, including any
required staging check. It cannot open an early draft to bypass Meld's pre-PR
deployment gate. Drafts also retain the existing open-PR branch-deletion fence.
Closed or merged PRs retain their historical draft metadata and deny readiness
edits. Automatic CODEOWNERS requests, notifications and draft-specific reviewer
assignment behavior are separate parity work; this feature does not add them.

## CLI

```sh
nh pr create --title "Work in progress" --head feature/example --draft -R owner/repo
nh pr ready 12 -R owner/repo
nh pr ready 12 --undo -R owner/repo
nh pr ready 12 --revision 3 -R owner/repo
```

Both aliases use the native API. `pr ready` reads the current head, comparison
and draft revision, then makes one conditional edit. Optional `--revision`
also refuses a changed observation before writing. Inspect `pr view` after an
uncertain response; the CLI never silently repeats a mutation. Lists and views
identify drafts while JSON keeps `state: "open"` with `draft: true`.

`nh pr draft` continues to mean the credential's private code-review draft.
It is separate from a draft pull request. Creation/readiness require
`pulls:write` and current repository writer access. Readers can leave permitted
feedback but cannot change draft status. Any client can use the scoped CLI API
credential without agent registration; optional registered agents can use their
own native API credential and the owning account's current authority.

## API and final writer

`POST /api/trunks/:id/pulls/drafts` takes the ordinary PR creation fields.
Owner/repo aliases and `/api/cli/...` expose the same operation. It is a distinct
route so an older API cannot silently ignore a draft flag and create a ready PR.
Ordinary `POST /pulls` creates a ready PR. Native clients require the snapshot's
`pullReadiness: "storage-v1"` capability; missing receiver methods return 503
without falling back to ordinary creation or an older readiness writer.

`POST /api/trunks/:id/pulls/:number/readiness` accepts only:

```json
{"draft":false,"revision":3,"commit":"observed head","anchor":"observed comparison"}
```

It requires `If-Match: "pull-readiness-3"`. A stale revision returns 412; a changed
diff or closed PR returns 409. Metadata is private/no-store. Actor, credential
and origin come from authentication, not request JSON. The final Sequencer
rechecks current writer membership, CLI scope/revocation/expiry or the optional
agent credential. Proofs are bounded to 30 seconds and credential expiry;
cross-service membership/revocation is not a distributed transaction.

A separate SQLite authority row holds draft state and a monotonic revision.
Legacy JSON rewrites cannot clear it or reset its revision. A persisted trigger
rejects an older serialized merge writer's attempt to mark a draft merged,
rolling its ref write back with the transaction. Current route, preview and
final merge checks also deny drafts, including every generated merge method.
Readiness, mirrored metadata, revision and attributed audit commit together.

Missing authority remains closed rather than resetting to revision zero.
Initial migration keeps existing PRs ready; interrupted installation resumes
without resetting established authority. Missing hooks can be reinstalled.
The normal recovery procedure must retain these tables and triggers. A complete
older backup can still restore older readiness/authority, so production recovery
still needs its independent-authority reconciliation and request hold.

## Validation

[Local validation](evidence/pull-drafts-validation.md) covers source, bundled and
exact candidate CLI bytes, real Git/Worker/RPC/SQLite/D1/R2 operations, scoped
credentials, concurrent edits, old receivers, pre-PR checks, protected merges,
restart, physical storage loss and verified restore. It distinguishes browser
interaction from narrow-layout observations and does not claim deployment.
