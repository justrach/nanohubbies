# Reader review feedback

Published **0.4.21** and the deployed review UI add reader participation.
[Release acceptance](evidence/reader-feedback-release-validation.md) covers all
nine frozen Linux gates, the exact downloadable CLI, both installed aliases,
desktop and 390×640 layout evidence, and a production author COMMENT with a
private hunk comment and thread resolution. Multi-account reader mutations are
covered by real local Worker/Git tests; they were not repeated in production.

Repository readers can submit Comment, Approve or Request changes feedback and
leave bounded inline comments on an open pull request. Required approvals still
need current eligible write access, including CODEOWNERS and latest-push checks.
The pull request author can submit Comment only. An empty Comment review needs
at least one pending inline comment.

Reader approvals never become counted approvals after promotion. Reader change
requests do not create a review veto. Later reader feedback cannot replace an
earlier writer approval or change request, including on another open pull
request at the same head commit. Existing writer decisions retain their normal
current-membership, staleness and dismissal rules. Unresolved conversations can
still block merging when the branch requires conversation resolution.

Readers can resolve or reopen threads they started. The PR author and current
writers can resolve other threads. Suggestion application, pushes, branch and
PR management, merging, protections, secrets and runner administration retain
their separate permissions. Reader feedback does not grant those capabilities.

## Private hunk reviews and requests

Readers can collect private pending inline comments, edit/remove them, discard a
review, or publish the whole batch with a decision. Browser drafts belong to an
account; delegated CLI drafts belong to that account and exact credential. A
browser or sibling CLI credential cannot inspect or submit another workspace.
Stale-diff submission stays closed and retains private comments.

New reader drafts use separate storage from the legacy writer drafts inspected
by shared-head merge gates. Promotion does not move a private draft into that
legacy gate. An existing writer draft remains owned and discoverable after
demotion; it keeps its prior pending gate until its owner submits/discards it or
the PR closes. The role verified at actual publication determines the new
review's authority. Already published reader opinions stay non-authoritative.

A writer can request review from any current repository member other than the
PR author. A submitted reader review answers that request without satisfying
required approvals. Private drafts, agent work records and non-independent
agent reviews do not answer it. Request management still requires writer access
and `pulls:write` when delegated through the CLI.

## CLI and wire representation

`nh` and `nanohub` use the same commands:

```sh
nh auth login -R owner/repository --scopes read,reviews:write --days 1
nh pr review 12 -R owner/repository --verdict approve --body "Reviewed"
nh pr comment 12 -R owner/repository --draft --revision 0 --path src/parser.ts --line 24 --body "Check empty input"
nh pr draft 12 -R owner/repository --json
nh pr review 12 -R owner/repository --pending --revision 1 --verdict request-changes --body "Please handle empty input"
```

Explicit private-draft access requires `reviews:write` plus current read access;
ordinary `read` alone cannot inspect a credential's private draft. Device and
browser credential issuance allow that scope for current readers, while content,
merge and administrative scopes keep their existing restrictions. Current role,
origin, expiry, revocation and the parent CLI grant are checked again at the
serialized mutation boundary. Archived repositories remain read-only.

For rollback safety, the stored/public review keeps `verdict: "COMMENT"` and
`independent: false`, with the requested opinion under
`feedback: {"role":"reader","verdict":"APPROVE"}` (or Comment/Request changes).
The UI displays the opinion with **Reader feedback**; CLI text explains that it
does not supply required approval. JSON preserves the full representation.
Pending publication receipts include that same feedback marker when applicable,
including exact retries after a role change. Legacy merge gates therefore see
non-authoritative comments. Stored guards reject conversion into independent
reviews or removal/change of a published opinion's identity and marker.

The new routes require reader-aware RPC receivers and fail with private/no-store
503 responses when those methods are unavailable. They do not retry a write
through a legacy receiver. Only a verified browser writer's GET of its own
pending draft retains the older read-only fallback. Reader and delegated CLI
requests never use that fallback. Requested-review storage extends the existing
v2 ordering hooks, preserving revision fences and reconciling only reviews after
a retained request-generation high-water mark.

## Scope and remaining differences

This addresses read-access review participation described by
[GitHub's review reference](https://docs.github.com/en/pull-requests/reference/pull-request-reviews),
while preserving the distinction between feedback and
[required protected-branch approvals](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).
It does not establish complete GitHub compatibility. Reviews and new inline
feedback currently require an open PR; closed-PR review participation, team
review requests, automatic reviewer assignment, notifications and GitHub REST
schema compatibility remain outside this implementation. Hosted Actions
activation, production recovery and traffic-readiness gates also remain open.

Run `bun run --filter @swarm/api test:reader-feedback` for focused storage/route,
real Worker/Git and portable CLI acceptance. See
[validation evidence](evidence/reader-feedback-validation.md) and
[the UI review record](evidence/reader-feedback-design-validation.md). The build
gate also runs `test:cli-reader-distribution` against the actual release module,
checking its manifest, version, byte length and SHA-256 before fixture credentials
are issued.
