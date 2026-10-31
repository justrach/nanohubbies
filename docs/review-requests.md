# Requested reviewers

Candidate CLI **0.4.19** and the local PR UI add individual reviewer requests.
Source and local acceptance are available; production remains on CLI 0.4.17.
The preceding secret commands in candidate 0.4.18 are included in 0.4.19.
Both candidates still need full cloud acceptance and release validation.

The PR's **Reviewers** panel lets a repository writer request, remove or renew
a request. A submitted independent review answers the outstanding request,
including reviews published with pending hunk comments. The original requester
and CLI provenance are retained separately from the submitted review.

Requests ask for feedback. They neither supply an approval nor change branch
protection, CODEOWNERS, change requests, conversation resolution or CI gates.
Removing or renewing a request preserves every submitted review. Agent work
records, private drafts and non-independent agent reviews do not answer requests.

## CLI

```sh
nh pr reviewers 12 -R your-handle/app --json
nh pr request-review 12 --reviewer codegraff:account-id --revision 0 -R your-handle/app
nh pr remove-reviewer 12 --reviewer codegraff:account-id --revision 1 -R your-handle/app
```

Use the revision returned by `pr reviewers`. `--reviewer` also accepts a
comma-separated list of up to 15 distinct account IDs. Both aliases, `nh` and
`nanohub`, use the native API. Reads require `read`; mutations require
`pulls:write` and the account's current repository writer access.

The CLI reads the current PR head and comparison anchor, then sends them with
the explicit request revision. Stale request revisions return 412; a changed
diff or closed PR returns 409. An uncertain response is never replayed
automatically. Inspect `pr reviewers` before deciding whether to repeat a write.

## Eligibility and boundaries

Nanohub's existing independent review policy requires current writer access.
Requested people must therefore be current owners, admins or writers, and
cannot be the PR author. Native repositories offer the eligible account IDs;
externally managed rooms use an account-ID field and current Codegraff membership
verification. Invitations grant no review eligibility before acceptance.

The final Sequencer writer rechecks the requesting account and requested people.
CLI edits also check the current original credential, repository, origin, expiry
and `pulls:write` permission. Connected-team outages deny new requests rather
than treating an old role as current. Membership proofs are bounded to 30 seconds;
cross-service membership and revocation do not form a distributed transaction.

People with read access can inspect request history but cannot edit requests.
Agent/Git credentials do not become account-level request-management credentials.
Archived and closed repositories/PRs retain request history and deny edits.
Removing a stale request does not require its former reviewer to remain eligible.

At most 15 requests may be outstanding on a PR, with up to 100 distinct requested
accounts retained over its lifetime. Repeated requests for an already waiting
person are idempotent at the current revision. A submitted answer or each changed
request row advances the revision. Revisions are opaque: batches and older
writers can advance them more than once. Old revisions cannot resurrect a removed
request. Request edits, answers, revisions and audit records commit atomically
with their corresponding operation. The admin review-activity API includes
request, removal and answer events without credential values.

## API and rollout

`GET /api/trunks/:id/pulls/:number/requested-reviewers` returns `protocol: 1`,
revision, request history, current pending-reviewer eligibility and management
capability. Owner/repo aliases expose the same route. Writer views receive the
native candidate directory; read-only callers do not receive that directory.

`POST` requests reviews and `DELETE` removes requests. Both accept only:

```json
{
  "reviewers": ["codegraff:account-id"],
  "revision": 0,
  "commit": "observed PR head",
  "anchor": "observed comparison anchor"
}
```

Both require `If-Match: "review-requests-0"` matching the body's revision.
Actor and credential identity come from authentication; request JSON cannot
override them. Browser mutations require same-origin account access. Metadata
responses are private/no-store. Reads and mutations require the receiver's
`revisionTracking: "storage"` and `answerTracking: "storage-v2"` capabilities.
An older or incomplete receiver returns 503 before the mutation RPC is called;
there is no fallback to a legacy writer. Retry after deployment completes,
then inspect the current revision before editing.

This is an incremental compatibility feature. [GitHub permits requests to
readers and teams and supplies notifications and automatic CODEOWNERS
requests](https://docs.github.com/en/pull-requests/how-tos/create-pull-requests/requesting-a-pull-request-review).
Reader reviews, team selection, automatic CODEOWNERS requests, notifications,
assignment inboxes and hosted mixed-version validation remain open here.
Request metadata is advisory; it never stands in for the independently enforced
review/merge decision or the current-authority recovery procedure.

## Stored answers across code rollback

The current backend advertises `answerTracking: "storage-v2"` and
`revisionTracking: "storage"` without changing the HTTP protocol or CLI artifact.
Every new request has an opaque generation and a private high-water mark in the
review-ID history. Persisted SQLite hooks answer it when a later independent
review is inserted, including the storage write used by older receivers. Wall
clock order is not used. The request, revision and answer audit update atomically
with that review; a late audit failure rolls the review back too. Ordinary
requests still have no authority over approvals, policy or repository access.

A missing hook can be repaired transactionally. When the exact current request
generation and ordering receipt survive, the first qualifying later review is
reconciled once and its audit event records `reconciled: true`. Missing revision
authority keeps changes closed rather than treating the request as revision zero.
Legacy request writes acquire a generation through stored hooks, so remove/re-add
cannot reuse an older view even when timestamps repeat.

Pending rows predating ordering receipts are preserved. Migration starts tracking
future submissions; it does not guess whether a historical review followed the
request. Likewise, an untracked replacement establishes a new baseline. Remove
and renew a request when a new review is needed. A full backup restore can still
restore old authority; the independent-authority recovery requirements remain.

[Storage validation](evidence/review-request-storage-validation.md) covers the
legacy SQL write boundary in real local Workers, restart, cold DO/D1/R2 recovery
and repair/rollback cases. It is not a hosted deployment of historical Worker
versions. Persisted hooks rely on [SQLite trigger semantics](https://www.sqlite.org/lang_createtrigger.html)
and schema repair uses [Durable Object synchronous transactions](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).
