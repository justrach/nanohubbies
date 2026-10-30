# GitHub compatibility and restrictions

Nanohub is a standalone private Git host with repository membership, PRs, protected refs, native check storage and a Codegraff execution backend. It is not yet a drop-in GitHub replacement. This document tracks the requested parity work against [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) and [ruleset controls](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets).

## Current coverage

| Capability | Implemented behavior | Remaining differences |
| --- | --- | --- |
| Repository storage | Standard Git objects and immutable IDs; UTF-8 branch/tag names with a full-ref byte bound, annotated/lightweight tags, binary files, executable modes and symlinks; atomic compare-and-swap and native `git push --atomic` negotiation; up to 10,000 atomic initial creations with independent empty-state fencing, ordinary updates capped at 100; [actual complete Meld graph verified locally](evidence/initial-import-validation.md) | HTTP transport only; heads/tags only; non-UTF-8 ref bytes, LFS and submodules rejected; [pinned hosted full-graph acceptance passes](evidence/hosted-import-validation.md); application CI/staging and cutover remain open; see [name contract](git-ref-names.md) |
| Default branch and PR targets | Choose an initial Git default or select an existing branch as owner/admin; native clone HEAD, browsing, new PR defaults and default-target rules follow it; existing PR targets and exact-name protections stay put | No branch rename or automatic retarget on selection; legacy snapshots retain main; see [default branch contract](default-branch.md) |
| Git clients and agents | Repository-scoped expiring Git tokens work with ordinary HTTP Git clients without agent registration; optional agent tokens retain their own identities and API scope | Human hosted sign-in still uses the current Codegraff account flow; Git-only tokens intentionally cannot use application APIs |
| Agent contributions | Optional stateless MCP work tracking through the official TypeScript SDK; credential-bound agent/owner, reported client/model labels, native Git ref observations, repository showcase and PR-linked history | Reported work is not vendor attestation, commit authorship or review approval; custom-header clients only, no MCP OAuth discovery or historical backfill; see [MCP contract](agent-mcp.md) |
| Hosting CLI | Explicit clone/fetch and push scopes with a repository-local Git helper; `nh` / `nanohub` agent-free complete Git import with verification-only recovery, native PR list/view/diff/create/close/review, private CLI batch reviews, bounded inline comments, resolve/reopen, protected merge and Actions history; revision-checked classic protection, ruleset and deployment-environment export/edit/delete, plus default-branch selection and archive/unarchive behind separate explicit current-admin permissions; owner-only runner registration/recovery/revocation with private credential files; browser code authorization or manual expiring scoped API credentials, OS helper storage and server revocation | Native device protocol rather than a general OAuth server; account-wide grants, Windows launchers and native runtime binaries remain open |
| Names and membership | Stable internal IDs, owner/repo namespaces, rename aliases, identity-bound invitations and reader/writer/admin roles | No organizations, teams, ownership transfer, email invitations or GitHub role/API equivalence |
| Protection management | Owners and admins can add/edit/delete rules under Settings → Rules; same-origin browser session or separate explicit current-admin CLI grants for classic protections and rulesets; revision-checked CLI edits and audit retained; CI runner management through Actions or a separate owner-only CLI grant | No organization-level policy inheritance |
| Pattern targeting | Exact names, `*`, `?`, `**`, positive ASCII character classes/ranges; rulesets support include/exclude, `~ALL`, `~DEFAULT_BRANCH`; overlapping rules compose | Not GitHub's classic single-rule precedence or complete fnmatch syntax; bounded pattern/class grammar. Backslash quoting and `[^set]` are unsupported in GitHub's documented ruleset grammar too |
| PR/review requirements | Required PRs and independent human approvals from current writers; fresh native/external membership at preview and final merge; configurable stale dismissal or retained approvals; outstanding change requests remain blocking after pushes; pending/rejected reviews on another open PR at the same live head block protected merges; merge UI reflects the server's current gate | No reviewer-team selection; strict policy remains the compatibility default; shared-head blocking is deployed and covered by frozen Linux acceptance; live mutation checks remain separate |
| Review dismissal | Reason required; signed-in current writers only; optional stable-account restrictions intersect across matching rules; original review retained, actor/reason/time visible, atomic audit, idempotent retry | No team mapping; open PRs only; no implicit administrator bypass; historical reviews without tree evidence retain conservative exact-ID eligibility |
| Code owner reviews | Base-branch CODEOWNERS, location priority, last-match ownership, changed-path coverage and required independent approvals from current writers; native @handle identity resolution and archived merge decision | Team/email identity mapping and automatic review requests are not implemented; unmatched individual handles have no assignment; unsupported owner kinds cannot silently waive a required group |
| Last push approval | A fresh approval of the latest file-changing push and comparison base must come from someone other than that pusher; metadata-only commits preserve the reviewable-push identity | Agent pushes inherit the owning human's identity; legacy audit events are conservatively reviewable |
| Hunk review and conversation resolution | Bounded file-by-file PR reviewer; line/range and hunk comments, replies, resolve/reopen, original-code excerpts for earlier revisions; unresolved PR-scoped threads block final merge across pushes and deleted files | New inline writes require signed-in human writers; legacy version comments retain their commit scope; dismissing a review does not resolve conversations |
| Code suggestions | Insert selected after-side code into a suggestion; preview and apply one or up to 50 non-overlapping suggestions as one protected commit; atomic ref, resolution and retry receipt; stale approval and CI behavior follows ordinary branch writes | Current exact head/comparison and root comments only; regular UTF-8 text files up to 1 MiB; no offset suggestion syntax or automatic reanchoring; generated commits use pseudonymous account identities and are unsigned |
| Signed commits | Account-bound public SSH/OpenPGP keys; current verified committer email or stable account noreply address; cryptographic checks across introduced history; classic protection and `required_signatures` rulesets; immutable repository verification records survive key/email removal | S/MIME and hardware SSH formats, fork-network receipt sharing, automatic verification of every unprotected push, and server signing of web-generated commits remain open; SSH signing does not enable SSH transport |
| Pending reviews | Private browser reviewer-scoped and CLI credential-scoped drafts; multi-file collection, editing/removal/discard; atomic publication of all comments with Comment/Approve/Request changes; optimistic draft revisions and idempotent submission receipts | Exact head/comparison required at submission; stale drafts stay private and must be discarded before starting on a new diff; pending replies and attachments are not supported; CLI 0.4.17 is published; draft mutations are covered by frozen Linux Worker tests |
| Required deployments | Named case-insensitive environments, optional trusted runner source, exact candidate/current-default workflow-base terminal deployment evidence; required account reviewers, self-approval prevention and durable wait timers; classic and `required_deployments` rulesets; current source/revision checks in the final writer; merge-time receipts retained | Reviewer teams, explicit environment admin bypass, `jobs.environment`, pending/in-progress/inactive statuses and environment-scoped secret release remain open |
| Required checks | Separate trusted runner credentials, exact head/current-default workflow-base results, strict up-to-date PR target, optional checks before opening a PR; success/neutral/skipped satisfy ordinary named checks; explicit success-only mode blocks neutral/skipped as required for Meld; other terminal conclusions block; source pins and revocation checked at PR open and final merge | Runner registrations are the native source identity rather than GitHub Apps; legacy staging still requires verified successful deployment evidence; no loose check mode, merge queue or code scanning gates; see [conclusion contract](check-conclusions.md) |
| Force push/deletion | Server-side force-push and deletion blocks; selected account force exceptions with independent ordinary-write permissions; allowed deletions are independent of PR requirements; tag replacement is configurable through rulesets | Default branch and branches with open PRs cannot be deleted; any tag replacement is treated as a force update |
| Ref rulesets | Branch/tag creation, update, deletion, non-fast-forward and linear-history controls; active/evaluate/disabled enforcement; admin management under Settings → Rules | No organization inheritance; PR/check requirements remain in the branch protection editor |
| Metadata restrictions | Branch/tag names, complete commit messages, author email and committer email; literal or bounded RE2 patterns, optional negation; multiple constraints per field; every introduced commit checked | 512-character patterns, bounded compiled complexity/work; UTF-8 metadata required; new refs check reachable history; no metadata policy for legacy snapshot mode |
| Push rulesets | All refs: restricted paths/extensions, path character length, file size; path and size rules support scoped allowed-path exceptions; inspects every introduced commit, including intermediate add/delete and merge side parents; peels annotated tags | Case-sensitive matching; new refs check full history; direct blob tags fail closed under path rules; no fork network yet |
| Ruleset bypass | Explicit stable account IDs and exact current admin/writer roles, signed-human-only always/PR-merge modes; fresh role membership at final write, attributed bypass audit/insights; overlapping rules and classic protections still apply | No teams, maintain/custom roles, GitHub Apps, silent exemption or GitHub numeric user-ID mapping; Git/CLI/agent credentials do not inherit browser bypass |
| Protection history | Admin-only activity browser with immutable revisions, accepted ref writes and bypass identities; stable filters; comparison and revision-checked restoration; current/historical JSON downloads and reviewed JSON imports | Separate bounded rule-insight list/detail API includes accepted/rejected final ref transactions; no full GitHub REST schema or aggregate dashboard; old audit records have only the after-state |
| Repository archive | Repository-wide read-only fence for content, reviews, issues/channel, permissions, releases, settings and deployments; resumable monotonic lifecycle; authorized reads/clones preserved; explicit reopening retains branch policies; revision-checked native CLI archive/unarchive with a separate current-admin grant | Native feature scope; external deployments already dispatched may need separate cancellation; reopening activation can require retry after an outage |
| Deployment source restrictions | No restriction, protected branches, or separate branch/tag patterns; empty selection blocks all; canonical source refs and annotated-tag targets; checks at request, review, authorization, completion and required-deployment merge | Native path-aware glob syntax; the current default commit remains the trusted workflow base; no fork deployment model |
| Branch lock | Blocks push, HTTP branch mutation, restack and merge, including owners/admins | No read-only fork synchronization exception |
| Allowed pushers | Stable account allowlist, applied to create/update/delete and PR merge; overlapping allowlists intersect; empty list blocks everyone | No teams/apps or bypass roles; membership remains a prerequisite |
| Linear history | Checks every introduced commit against previous-ref ancestry; merge commits below the tip are rejected; applies to push, HTTP branch creation, restack and PR merge | Git mode only; strict squash/rebase and merge-method settings are deployed and covered by frozen Linux acceptance; automatic rebase requires linear feature history |
| Actions execution | Trusted controller reads accepted-base workflow, creates a fresh Codegraff VM per job, transfers a credential-free Git bundle, runs an isolated candidate, records private logs and cleans up | Explicit limited workflow dialect; expressions, matrices, arbitrary marketplace actions, services, reusable workflows, scheduled events, cache and artifact actions are not supported yet |
| Runner pool | Configurable concurrent candidates/jobs, per-process sandbox cap across repositories; atomic leases; named registrations and immediate revoke/reassignment; deployed shared deployment/account reservation API across controllers with retained uncertain allocations and cleanup repair | Hosted dispatcher activation remains open; provider capacity/credit still bounds allocations; repository credentials remain separately scoped; project CI still requires its sandbox-scoped key, verified toolchain image and running dispatcher; account-specific compute tiers remain open |
| Secrets | Private on-demand service with Cloudflare Secrets Store bindings, scoped references, bounded/revocable grants and audit; Cloudflare retains values when runtime idles | Static binding changes require deployment; values managed directly in Cloudflare; no GitHub-compatible secret upload API or automatic candidate injection |
| Staging | Exact head/base approval, staging version/acceptance evidence contract and controller adapter | Live deployment, real-service acceptance and Meld migration still need activation and evidence |

Additional signature formats, merge queues, organizational policies and full Actions compatibility remain open work. A signature header alone never counts as a verified signature. These gaps are not silently presented as supported options.

Published CLI **0.4.17** adds [native deployment requests and
reviews](cli-deployments.md): independent request/reviewer permissions, current
native and connected-team membership, reader consent, revision-checked decisions
and final credential checks. [Local acceptance](evidence/cli-deployments-validation.md)
covers source, standalone bundle and exact release module. The
[release acceptance](evidence/cli-deployments-release-validation.md) adds all nine
frozen Linux gates, public installation, unchecked consent and state preservation.
Actual hosted deployment execution and Meld staging/cutover remain open.

Published CLI 0.4.16 adds [collaborator administration](cli-collaborators.md):
explicit current-admin delegation, private client-generated invitations with
lost-response recovery, revision-checked role/removal/cancel operations and final
Hub authority checks. The [shared Actions capacity API](actions-capacity.md) is
also deployed. [Release acceptance](evidence/access-capacity-release-validation.md)
includes eight frozen Linux gates, exact public assets/installer checks and live
consent/state preservation. Hosted dispatch is not activated, and account-specific
compute/pricing tiers remain open.

## Protection API

`GET /api/trunks/:id/protection` lists stored rules. `PUT` adds or replaces one; `DELETE` with `{ "branch": "release/**" }` removes it. The owner/repo aliases expose the same endpoints under `/api/repos/:owner/:repo/protection`.

```json
{
  "branch": "release/**",
  "pullRequest": true,
  "approvals": 1,
  "checks": ["test", "typecheck"],
  "beforeOpen": [],
  "successOnlyChecks": true,
  "preventForce": true,
  "preventDelete": true,
  "requireLinearHistory": true,
  "requireLastPushApproval": true,
  "dismissStaleReviews": true,
  "requireConversationResolution": true,
  "requireCodeOwnerReview": true,
  "requireSignedCommits": false,
  "locked": false,
  "allowPush": ["codegraff:account-id"],
  "allowDismiss": ["codegraff:account-id"]
}
```

Omit `allowPush` to allow all existing writers who satisfy other rules. An explicit empty list blocks all accounts. Allowed pushers cannot bypass PRs, approvals or checks. Owners and admins can change policy, but cannot bypass it during a ref update. Overlapping rules union required checks, take the maximum approval count, enable any requested restriction and intersect configured pusher lists. Removing one rule leaves overlapping rules enforced.

All ref changes re-read policy inside the sequencer's final serialized transaction. Trusted routes derive linear-history evidence from Git objects and bind it to the exact old/new refs; user JSON cannot assert that evidence. Approved PR merges still pass locks, pusher restrictions and graph checks. Legacy text snapshot landing also observes locks, push restrictions and review gates, while Git mode rejects text submissions entirely.

## Git pull request merge methods

The deployed PR view and CLI 0.4.17 offer explicit merge-commit, squash and rebase
choices. The existing fast-forward default remains unchanged.
Every method requires the head to contain the current target commit; loose
checks and divergent three-way merges remain open work.

| Method | Result |
| --- | --- |
| Fast-forward | Move the target to the exact existing reviewed commit |
| Merge commit | New commit with target/head parents and the reviewed tree |
| Squash | One new commit with the target as parent and the reviewed tree |
| Rebase | New linear commits preserving original authors/messages and final reviewed tree |

These follow the [GitHub merge-method shapes](https://docs.github.com/en/pull-requests/reference/pull-request-merges).
Automatic rebase currently requires a linear feature history of at most 200
commits and 16 MiB of commit metadata. It drops originally empty commits,
preserves raw author/timezone/message/encoding bytes, changes the committer and
never copies invalidated signatures. Nonlinear features need a local rebase or
merge/squash. Automatic coauthor trailers and server signing remain parity gaps.

The deployed release adds repository method allowlists/defaults in Settings and
CLI 0.4.15, with a separate current-admin grant, storage revisions and a final
merge-writer recheck. It preserves all four methods and fast-forward until an
explicit edit; new clients honor the selected repository default. This feature
passes local and frozen Linux acceptance plus live settings/archive checks. See
the [settings contract](merge-settings.md) and [release evidence](evidence/merge-settings-release-validation.md). GitHub message
templates and branch-specific merge-method rules remain open.

The final writer distinguishes reviewed head H from generated result M. Current
review/CODEOWNERS/conversation/shared-head and trusted CI gates still bind to H.
The generated result must have H's exact tree; its actual graph separately
passes current linear-history, signature, file and metadata restrictions.
Classic/ruleset required deployments may use H's successful deployment only
through that trusted old/new/tree-bound proof, with the current workflow base.
Ordinary pushes cannot supply such proof or inherit that deployment mapping.

Generated commits are unsigned. Where signing is required, choose fast-forward
with a verified signed head; generated methods cannot waive it. A merge commit
cannot satisfy linear history; squash/rebase may. Locks, allowed pushers,
archive, current membership and ref compare-and-swap apply at final mutation.
The source branch is never rewritten. Merge records retain H, M, method, target
and workflow base; the reviewed diff remains based on H.

Custom merge/squash messages are optional, bounded at 64 KiB UTF-8. Rebase keeps
the original messages. New methods use a dedicated RPC; an older receiver
returns retryable 503 without falling back to another strategy. Lost responses
never trigger an automatic mutation retry. See [behavioral validation](evidence/merge-methods-validation.md)
and [frozen Linux, deployment and installer evidence](evidence/merge-methods-release-validation.md).
Production checks preserve the canary's refs and settings; generated-merge
mutations are verified in local/frozen Linux Workers. The source feature branch
is now [published on GitHub](evidence/source-publication-validation.md); its
GitHub workflow remains queued pending Codegraff runner registration.

## Repository-wide archive

Under Settings → General and access, **Archive repository** requires the current
repository name. Owners/admins can archive and unarchive; neither they nor an
agent can bypass the fence while it is active. All native content, ref, review,
issue, permission, release and setting writes become read-only. Existing members
retain read/clone access and private review drafts. The UI preserves branch/file
browsing, filters and review inspection while disabling mutation controls.

`GET/POST /api/trunks/:id/archive` exposes state and accepts
`{archived,revision,confirmation}` under same-origin human admin authorization.
The owner/repo alias uses the same resource. A revision-checked operation locks
the Hub metadata writer and the final Room/Sequencer writers. Interrupted
transitions survive restarts and can be retried. Committed reopening with
incomplete replica activation is explicit; newer archive revisions cannot be
undone by delayed messages. Archival cancels pending CI and revokes its leases;
unarchiving does not automatically rerun checks or relax branch protection.

Cloudflare secret values are retained. Workload reads pause during archival;
the vault retains its separate grant expiry and ownership model. Account
credential revocation and Git read-token creation remain available. Repository
deletion retains its owner-only path. The feature covers Nanohub's existing
native surfaces, rather than claiming support for GitHub features absent here.
See [archive verification](evidence/archive-validation.md).

## Hunk code review

Native pull requests show one changed file at a time in a bounded diff panel.
Choose a file, use Previous/Next, and mark files Viewed while reviewing. Line
numbers select code; Shift-click extends a selection on the same side within one
hunk, up to 201 lines. **Comment on chunk** selects that hunk's first side, capped
at 201 lines. Drafts survive file switching in session storage, scoped to the
person, repository, PR, head, comparison and path. Viewed marks last for the
current page and reset when the revision changes.

Choose **Start a review** or **Add to review** to collect private feedback, or
**Post single comment** to publish immediately. Each public thread belongs to one PR and stores its
original head, comparison base, file, side and line range. A new push or changed
comparison moves old threads to **Earlier revisions** without relocating them
onto unrelated lines. The original server-derived hunk remains inspectable;
very large excerpts are explicitly truncated. Replies retain the root's original
selection. Binary or omitted diffs offer the full-file link instead of a false
line anchor.

`GET /api/trunks/:id/pulls/:number/comments` returns the discussion.
`POST` accepts `{id,commit,anchor,path,side,startLine,line,body}` for a new thread,
or `{id,commit,anchor,replyTo,body}` for a reply. `PATCH` accepts
`{id,commit,anchor,resolved}`. Here `commit`/`anchor` always identify the currently
observed PR; the server derives an outdated reply's original anchor from its
root. IDs are 8–80 ASCII letters/digits/hyphens; bodies are nonempty, up to
16000 characters with a 32 KiB request cap. Unknown fields are rejected.

Inline mutations require a signed-in current writer or an explicitly scoped
CLI account credential through its bounded gateway, and an open PR. Browser
mutations require same-origin requests. CLI feedback is attributed to the
delegating account and marked via CLI. Agent, Git and CI credentials cannot
impersonate an account inline reviewer. Read access can inspect discussions. The sequencer rechecks membership
and the exact observed head/comparison before its serialized write, so a raced
push returns 409. Identical comment retries are idempotent; an ID cannot be reused
for different feedback or another PR. Closed and merged PRs retain discussions
read-only. Limits are 1000 comments per PR and 10000 per repository.

With `requireConversationResolution`, all unresolved PR roots block final merge,
including earlier comparisons, deleted files and old heads. Resolving or
reopening changes that gate; submitting or dismissing a general review cannot
resolve a thread. Legacy published-version comments are still checked using the
existing initial/subsequent head history rule. See [hunk review validation](evidence/hunk-review-validation.md).

## Private pending reviews

The hunk composer supports the [documented private pending-review flow](https://docs.github.com/en/pull-requests/get-started/reviewing-pull-requests-quickstart):
collect inline comments, then finish with Comment, Approve or Request changes.
Pending feedback is stored separately from public reviews and discussions. Only
the current signed-in reviewer can retrieve their own draft; repository owners,
other writers, readers and agent credentials cannot inspect another person's
pending comments. Drafts do not contribute approval, requested changes or
unresolved conversations until publication.

**Finish review** lists private comments across files. Each can be edited or
removed; **Discard review** confirms before discarding the whole draft. Draft
comments survive a page reload. The review summary is a page-local composer.
Submitting publishes one verdict and every inline comment in the same sequencer
transaction, associates each thread with that review, and removes its private
draft. A late failure rolls back the entire batch. Exact submission retries
return the recorded review without duplicate feedback, even after the head moves
or the PR merges. Discarded IDs remain reserved so delayed requests cannot
recreate a discarded draft.

Drafts bind to their initial head and comparison. A concurrent push or base
change never silently rebinds their lines or approves new code. Stale drafts
remain private and editable/removable; submission or adding lines from a new
diff returns 409. Discard and start a new review to review the new comparison.
Each draft has a revision number that prevents concurrent tabs overwriting one
another's edits.

`GET /api/trunks/:id/pulls/:number/pending-review` returns only the signed-in
writer's draft. `POST` takes `{reviewId,revision,commit,anchor,comment}` where
`comment` contains `{id,path,side,startLine,line,body}`. First add uses revision 0.
`PATCH` takes `{reviewId,revision,commentId,body}`. `DELETE` takes
`{reviewId,revision,commentId}` to remove one comment, or omits `commentId` to
discard all. `POST .../pending-review/submit` takes
`{reviewId,revision,commit,anchor,verdict,body}`. The server derives author,
excerpt, timestamps and review/comment association. Unknown fields are rejected.

Same-origin human writer authentication, current membership and exact revision
checks apply. There is one pending review per person/PR, with at most 100 comments
and a 1 MiB encoded draft limit; at most 1000 active drafts per repository. The
existing 1000 public-comment/PR and 2000 review/repository limits still apply.
Pending replies and attachments remain future work.
See [pending-review validation](evidence/pending-review-validation.md).

## Reviews on another PR at the same commit

For a branch requiring PRs, approvals, latest-push approval or code owner review,
another open PR whose current head branch points to the exact candidate commit
can block merging. An undismissed latest Request changes verdict or any pending
browser/CLI review on that peer must be resolved. This follows
[GitHub's shared-head review restriction](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-pull-request-reviews-before-merging).
The PR targets may differ; this remains repository-local.

The final serialized writer re-reads live refs, peer PR state, submitted verdicts
and pending-review existence. HTTP JSON cannot supply or clear that evidence.
A blocker added after preview still rejects the merge. The UI links the related
PRs; `nh pr view --json` includes `reviewGate.sharedHeadBlockers`, and native
`nh pr merge` receives the same server denial. New routes use a dedicated merge
RPC and return retryable 503 if an older receiver lacks it, without falling back
to the older writer. The final legacy `review({op:"merge"})` RPC also enforces
the rule on an upgraded receiver.

Only a peer PR number and generic pending/requested-change flags become public
merge status. Private draft authors, bodies, excerpts, comment IDs, credential
IDs and counts stay private. Earlier-diff or empty pending reviews still count
until submitted/discarded or their PR closes. Revoking a CLI credential does not
publish or discard its private draft; closing the related PR clears that blocker
if the credential can no longer access it.

A different live commit does not block, even when its tree is identical. Closed
and merged peers do not block. Comment-only feedback cannot clear a prior Request
changes verdict; a later approval or explicit dismissal can. A dismissed latest
review does not resurrect an older verdict. Peer approvals and conversations do
not transfer to the current PR, whose own review/conversation gates still apply.
Existing submitted change requests are not silently waived on reviewer demotion.

The [local validation](evidence/shared-head-reviews-validation.md) covers real
source/packaged CLI and Worker/Git behavior. The
[0.4.14 release](evidence/merge-methods-release-validation.md) includes this
guard and passes the full frozen Linux repository suite. Production rollout
checks preserve existing canary state. Loose check mode, divergent merge
strategies and the other parity gaps remain open.

## Apply code suggestions

Select after-side lines and choose **Suggest change** to insert their current
contents into a fenced suggestion. Publish it immediately or collect it in a
private pending review. Published root comments can be applied singly or added
to a batch across files. **Review selected suggestions** previews every selected
path/range and replacement before **Commit suggestions** creates one commit on
the PR's source branch. A custom one-line subject can satisfy commit-message
rules. The generated commit attributes the applying human and adds pseudonymous
co-author trailers for other suggestion authors; it claims no verified email or
cryptographic signature.

`POST /api/trunks/:id/pulls/:number/suggestions/apply` accepts only
`{id,commit,anchor,commentIds,message}`. The server reads the published comments,
validates their original after-side ranges against the current visible diff,
constructs the Git objects, derives protection evidence and rechecks membership
before its serialized write. It rejects replies, already-applied suggestions,
earlier revisions, left-side selections, overlapping ranges and no-op changes.
Each root must contain exactly one complete plain `suggestion` fence; multiple,
incomplete and offset fences cannot apply. Empty contents remove selected lines;
a blank content line remains a blank line. A batch contains 1–50 different roots,
each at most 201 selected lines; source and resulting regular UTF-8 text files
must each fit 1 MiB. Binary files and symlinks cannot receive suggestions.

The ordinary source-branch policy path enforces locks, allowed pushers, PR/check
requirements, metadata and push rules. Only a successful atomic write marks
selected threads resolved and records their applied commit. Stale approvals are
dismissed when configured, existing pending drafts become stale, CI candidates
are queued, and unrelated unresolved threads remain blocking. Exact retries
return the same receipt even after later pushes or merge; reusing a request ID
for different input is rejected. Other Git object IDs, binary bytes, executable
modes, symlinks, line endings and final-newline style are preserved. No automatic
line relocation occurs. See [suggestion validation](evidence/suggestion-validation.md).

## Required deployment environments

[GitHub required deployments](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-deployments-to-succeed-before-merging)
are separate from test statuses. Create a named environment under Settings →
Rules, optionally choosing its trusted repository runner registration. Names are
case-insensitive, 1–255 characters; environment IDs are stable. A different name
requires a new environment. There are at most 100 per repository.

Select required environments in a classic protection or use a branch ruleset:

```json
{
  "type": "required_deployments",
  "parameters": { "required_deployment_environments": ["staging"] }
}
```

This retains [GitHub's parameter shape](https://docs.github.com/en/rest/repos/rules).
Each policy/rule accepts up to 30 distinct names. Environments must already exist
when saving/importing/restoring a requirement. Overlapping requirements combine;
unknown/deleted environments block. An explicit human ruleset bypass cannot waive
classic requirements. Evaluate mode records missing deployments without blocking.

Protected branch creation, updates and PR merges require terminal successful
deployment evidence for the exact candidate and current main base. The serialized
writer rereads requirements, environment revision, the authenticated reporter and
its current revocation state. Atomic batches use their pre-push main base for
every ref. Test success or caller-supplied `deployed`/`ready` flags do not count.
Initialize main before enabling required deployments in an empty repository.

The latest deployment report for an environment/candidate/base controls the gate;
a later failure/cancellation supersedes success. Changing an environment's source
requires fresh verification after that change. Reusing a revoked registration's
display name or deleting/recreating an environment cannot revive old receipts.
A run retry does not erase a real historical deployment; exact candidate/base,
current environment revision and reporter trust still apply. Merged PRs retain
what satisfied the gate at merge, independently of later environment changes.

`GET /api/trunks/:id/environments` lists configuration and sanitized sources.
`POST` creates with `{name,runner?,reviewers?,preventSelfReview?,waitTimerMinutes?}`; `GET`/`PUT`/`DELETE .../environments/:id`
read/edit/remove one environment. These native management routes require a
signed-in current admin; writes are same-origin, private/no-store and audited.
Deleting configuration retains historical deployment records and does not alter
branch requirements or any secret value.

A trusted leased runner may include `deployments` when posting CI completion:

```json
{
  "attempt": 1,
  "results": [],
  "deployments": [{
    "environment": "staging",
    "head": "<exact 40-character candidate ID>",
    "base": "<exact 40-character main base ID>",
    "state": "success",
    "deploymentId": "external-deployment-run-id",
    "url": "https://staging.example.invalid/deployments/run-id",
    "verifiedAt": 1793050000000
  }]
}
```

The authenticated lease derives runner ID, run, attempt and environment revision;
JSON cannot assert those fields. Up to 30 distinct reports fit the shared 100 KiB
completion limit. Terminal states are `success`, `failure`, `cancelled`. URLs must
be HTTP(S) without embedded credentials. Verification cannot predate the run or
current environment configuration, or be more than 30 seconds in the future.
All reports validate before insertion. Deployment rows and CI completion commit
or roll back together, including late SQL errors; exact retries are idempotent.

The existing owner-approved staging adapter can satisfy an environment named
`staging` automatically when its exact-version/real-service acceptance succeeds.
`tools/ci-runner.mjs` also accepts optional trusted `stagingEnvironment` config
and forwards named reports returned by a trusted pipeline adapter. Candidate
jobs cannot supply environment reports or obtain deployment credentials. This is
trusted-controller attestation, not sandbox attestation. Live Codegraff/Meld
execution still needs its existing activation prerequisites.

These environment settings do not grant or release secrets. The private
Cloudflare vault retains its separate scoped references and expiring grants.
Reviewer teams, environment admin bypass, deployment-branch
policies, workflow `jobs.environment`, full deployment status/history APIs and
GitHub REST response-schema equivalence remain open work. See
[deployment validation](evidence/deployment-validation.md).

## Deployment approvals and timers

Environment settings can require one of up to six current repository readers,
prevent the initiating account from approving, and delay dispatch by up to 30
days. The request's timer starts at creation and runs alongside review. Actions
shows the exact branch, head, main base and environment revision, with approval,
rejection and current status. Writers can request review for a queued/running
candidate; trusted controllers also request it automatically before deployment.

Human routes are `GET/POST /api/trunks/:id/deployment-requests` and
`POST .../deployment-requests/:request/reviews` with
`{decision:"approve"|"reject",comment?,revision}`. Reviewers need current read
access. Writers can create requests; CI and agent credentials cannot review.
Writes require a same-origin session and optimistic request revision.

Trusted runner routes under `POST .../ci/deployments` are `/request`
`{runId,attempt,environment,optional?}`, `/authorize` `{requestId,attempt}`, and
`/defer` `{requestId,attempt,results}`. Authorization is checked before dispatch;
completion reports for protected environments include `authorizationId`.
Deferral releases both leases and persists successful checks. A later claim by
the same registration resumes the same generation with a new attempt. An
unstarted combined adapter defers with empty results and executes after review.

Retries and environment/ref/source changes require fresh request context.
Current reviewer membership is rechecked before authorization and completion.
Receipts expire with the CI lease and cannot be replayed on another run,
generation, source or attempt. Rejection requires an explicit retry. There is no
implicit admin bypass. These controls do not grant access to vault secrets.
See [approval evidence](evidence/environment-approvals-validation.md).

## Deployment branches and tags

Each deployment environment can select no restriction, protected branches only,
or selected branch/tag name patterns. This follows the three modes in
[GitHub's environment controls](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments#deployment-branches-and-tags).
The native protected mode recognizes current classic branch protection and active
branch rulesets. With no such definitions, any branch is allowed; tags remain
excluded. Evaluate/disabled/tag/push rulesets do not make a branch protected, and
an actor's bypass eligibility does not change whether protection exists.

The same admin environment endpoints accept `deploymentBranchPolicy`:

```json
{
  "name": "production",
  "deploymentBranchPolicy": {
    "mode": "selected",
    "rules": [
      { "type": "branch", "name": "release/*" },
      { "type": "tag", "name": "v*" }
    ]
  }
}
```

Omit the field or use `{"mode":"all"}` for no ref restriction. Use
`{"mode":"protected"}` for protected branches. Selected mode permits up to 100
patterns, each up to 128 characters; an empty rules array blocks every ref.
Patterns use the existing case-sensitive path-aware branch glob grammar:
`*`/`?` stay within a segment, `**` crosses `/`, and positive ASCII classes are
supported. A branch pattern never authorizes a same-named tag. Matching patterns
combine with OR; other environment restrictions still apply.

Ref context is derived from accepted Git objects and stored in CI, not supplied
by report/review JSON. Lightweight and annotated tags pointing to commits get
distinct runs; non-commit tags remain valid Git objects without executable jobs.
Annotated tags retain both the raw tag object ID and peeled commit SHA. Rewriting
an annotation or deleting its ref supersedes only that tag's runs/read leases,
including when the peeled commit is unchanged. A same-named branch is independent.

All restricted environments require pre-deployment authorization. Current policy
is checked when requesting, reviewing, authorizing and completing. Environment
edits invalidate old approval/authorization/success revisions. Protected mode also
rechecks current protection when using stored success for a required deployment.
No owner/admin or reporter can waive the ref policy.

The trusted runner recognizes `on.push.tags`/`tags-ignore` independently from
branch filters and emits canonical `GITHUB_REF`, `GITHUB_REF_NAME` and
`GITHUB_REF_TYPE`. It still reads workflows from the pinned main base. A release
tag may point to an older commit; exact checkout identity is checked without
requiring that older commit to descend from current main. Rerunning an unchanged
tag after main moves creates a fresh comparison context and requires new
approval, without rewriting the tag. This remains the limited native Actions
dialect, not full GitHub Actions compatibility.

See [deployment ref validation](evidence/deployment-refs-validation.md).

## Hosting CLI

The Bun `nh` / `nanohub` CLI supports browser code authorization, repository-scoped
API commands for PRs/reviews/hunk conversations and Actions history, and ordinary
Git through explicit clone/fetch and push scopes. Existing API-only credentials
gain no Git rights. A repository-local helper reads the stored CLI credential;
normal membership and protection checks still apply. Independent Git-token
login and browser entry points remain available. Full GitHub CLI compatibility,
account-wide grants and native runtime binaries remain open. A checksum-verified
Bun installer now distributes the portable CLI for macOS/Linux.
See [CLI usage](hosting-cli.md) and [Git scope validation](evidence/cli-git-validation.md).
The [portable distribution](evidence/cli-distribution-validation.md) is published
under `/nh/` and tested independently of the source checkout.

## Current reviewer write access

Required approval follows [GitHub's write-access requirement](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).
General, retained, latest-push and code-owner approvals all require current
verified write access. Native owner/admin/writer roles are checked in one coherent
Hub read. External team reviewers require fresh provider membership using their
verified linked account. Readers, removed accounts and unverifiable memberships
cannot supply an approval. Native repositories do not require Codegraff room
availability for this check.

The sequencer obtains eligibility for its own repository again before its final
merge transaction. That transaction rereads policies, reviews and refs, requires
membership evidence no older than 30 seconds, and excludes every approval whose
account was not verified. Reviews arriving during the asynchronous lookup cannot
make an unverified account count or hide a new requested-change verdict. HTTP
JSON cannot assert membership, independent status or a trusted lookup. Creating
a new independent human review also rechecks current write access.

Role loss does not erase or dismiss original feedback. The review UI explains
that an approval is excluded, and required counts update immediately on refresh.
An undismissed approval can count again if current write access is restored and
all revision/independence rules still pass. Previously dismissed approvals never
revive. An outstanding change request continues to block until replaced with an
approval or explicitly dismissed; removing that reviewer's access does not
silently waive it.

An unavailable external reviewer is excluded individually. If there are too few
other verified approvals, the gate reports the verification problem. No positive
membership cache is used. Native lookups support at most 2000 candidates and
external lookups 128 candidates, in batches of eight. Legacy unbound workspaces
recognize only their creator's authority; configure a repository membership
boundary before requiring independent collaborators there. Cross-service
membership reads and the sequencer commit are separate operations, not a claimed
distributed transaction. See [validation evidence](evidence/reviewer-access-validation.md).

## Expected required-check sources

Settings → Rules offers an **Expected check sources** selector for every check
required at PR opening or merge. **Any trusted runner** preserves the existing
name-based requirement. Selecting a registration requires its exact stable ID;
the source comes from the authenticated run lease, never a result field or
display name. Multiple dispatcher processes and concurrent Codegraff sandboxes
can share one registration. The pin does not impose a sandbox-count limit.

This is the native counterpart to [requiring checks from an expected GitHub
App](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks#required-status-checks-from-unexpected-sources).
Nanohub runner IDs are not GitHub App IDs. Protections accept optional
`checkSources: [{"name":"test","runner":"<registration-id>"}]`. Each pin must
name a check in `checks` or `beforeOpen`, and a runner registered in that same
repository. Up to 60 unique names are supported across both lists. Owners manage
CI registrations; signed-in owners/admins configure protections. Public-to-the-
repository source metadata contains only ID, name and revocation state, never
credential hashes or token values.

Overlapping rules retain every source restriction: an any-source rule cannot
erase a pin, and conflicting exact pins fail closed with an explanation. Final
merge and PR opening read current SQL policy, exact candidate/base results and
source revocation. A revoked pinned registration cannot satisfy a check even
when its old result succeeded. Recreating its display name does not restore
trust; an administrator must explicitly select the replacement registration and
rerun the check. Unpinned historical successes retain their previous semantics.
PRs display the authenticated source and explain missing, mismatched, revoked
and conflicting source requirements. Policy changes retain their normal audit.

The source is a trusted reporting principal, not proof that the provider
executed a particular sandbox. The limited workflow dialect and pending live
Codegraff activation remain separate. See [source validation](evidence/check-sources-validation.md).

## Verified signed commits

Account menu → **Signing keys** manages public signing keys at
`/settings/signing-keys`. The page supplies a stable account noreply email and
any currently verified account email. SSH Ed25519, RSA (2048–8192 bits) and NIST
ECDSA P-256/P-384/P-521 keys are supported. Armored OpenPGP public keys must have
a valid self-certified user ID matching an allowed email; verification uses
pinned OpenPGP.js 6.3.2 with its normal algorithm/security checks. Oversized,
expired, revoked and private key material is rejected. Private keys remain on
the user's computer; no hosted private signing key was created.

`GET /api/signing-keys` lists only the current human's keys and signing emails.
`POST` accepts only `{label,publicKey}`. `DELETE /api/signing-keys/:id` revokes an
owned key (URL-encode the ID). Writes require a signed-in human and same-origin
request; Git, agent, CI and mixed credentials cannot enroll account keys.
Names are at most 100 characters. SSH public input is at most 16 KiB, OpenPGP
input 64 KiB; at most 50 active/500 total keys per account. Revocation retains
ownership and history; a revoked key cannot be reassigned or re-enrolled. Add a
new key to resume new verifications.

Classic branch protection uses `requireSignedCommits`. Rulesets use
`{"type":"required_signatures"}` without parameters, including JSON transfer
and history. Updates inspect every commit introduced since the target's old
head, including intermediate commits and merge side parents. A signed tip cannot
hide unsigned history even when that history already exists on another branch.
For ruleset branch creation, commits already reachable from a pre-push branch
are exempt. The complete branch snapshot is checked again at final write, and
atomic multi-ref pushes share their initial snapshot. Classic protection does
not verify an initial branch creation; add a signature ruleset to cover it.
This follows [GitHub's distinction between classic protection and ruleset
creation checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets#require-signed-commits).
Tag rules inspect commits beneath the peeled target and reject non-commit
targets; they do not claim verification of the tag object's own signature.

The exact Git payload is verified after removing its folded `gpgsig` header.
The committer email must match an email bound at key enrollment and a current
verified auth email or the account's noreply address. Non-noreply email proof is
read again after cryptographic work. The final Hub transaction rechecks key
ownership/revocation before recording success. Auth storage and Hub SQL are
separate services; the fresh email reads are not a distributed atomic transaction
with a simultaneous auth-data change. SSH signatures require the `git`
namespace, supported SHA-2 hashes and supported key/signature algorithms.
Backdated OpenPGP signatures cannot revive a currently expired signing subkey.

Success records the commit ID, SHA-256 digest of its exact bytes, signer,
key/fingerprint, committer email and verification time. Records are immutable
within that repository and remain valid after later key or email removal,
following [GitHub's persistent-verification behavior](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification).
A new commit still requires active trust. The protected writer checks exact
old/new/ref evidence, current rules revision and creation snapshot. Explicit
human ruleset bypass remains audited and cannot waive classic protections.
Client JSON cannot assert verification.

PRs show an introduced-history signature gate, with Merge disabled when it fails.
Push, HTTP branch creation, restack, suggestions and final merge all use the
same trusted evidence path. Web-generated commits are unsigned; a required
signature rule rejects them rather than implying a valid signature. Sign and
push those changes locally. Bounds: 256 KiB commit objects, 64 KiB signatures,
1000 introduced commits per protected update, 100000 ancestor commits,
200000 graph reads/2 GiB. Larger updates must be split.

Verification is triggered by a protected update or PR signature gate; it is not
yet an automatic badge for every unprotected push. S/MIME, hardware-backed SSH
formats, vigilant mode, fork-network receipt sharing and server signing remain
separate work. See [signature validation](evidence/signature-validation.md).

## Review dismissal

On an open pull request, an allowed human writer can choose **Dismiss review**,
enter a reason and confirm. The original verdict and feedback remain visible
with the dismissing account and time. Dismissal removes that review's approval
or blocking effect without reviving any older verdict from the same author.
It also removes an approval from code owner and latest-push requirements.
Unresolved review conversations remain independently enforced.

Settings → Rules optionally restricts dismissal using `allowDismiss`. Omitted
allows current human writers; an empty list blocks everyone, including admins.
Overlapping configured lists intersect. Being listed never grants repository
membership. Agent, Git and CI credentials cannot dismiss reviews, including
when accompanied by a human cookie. Write membership is checked again immediately
before the sequencer transaction; that transaction re-reads branch restrictions.

`PUT /api/trunks/:id/pulls/:number/reviews/:reviewId/dismissals` accepts
`{"message":"Reason for dismissal","event":"DISMISS"}` (`event` is optional).
Only these fields are accepted. The message must be nonempty and at most 16000
characters; same-origin human authentication is required. Identical retries
are idempotent; changing an existing dismissal returns 409. Dismissals and their
audits commit atomically. Admin activity includes a **Review dismissals** filter,
reason and link to the original review; these are not counted as ref writes.

This follows [GitHub's reasoned review dismissal](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/dismissing-a-pull-request-review)
and configurable restrictions, using native account identities. See
[validation evidence](evidence/review-dismissal-validation.md) for tested boundaries.

## Stale approvals and latest-push review

`dismissStaleReviews` defaults to **true** for existing and new branch protection
rules. Any matching strict rule requires dismissal; an overlapping rule cannot
turn it off. The form displays this effective compatibility default even when
an older stored policy did not have the field.

With dismissal enabled, accepted file changes automatically dismiss prior
approvals in the same transaction as the ref update. The original feedback is
retained with a system dismissal reason and an audit event. Restoring the old
files or disabling dismissal later cannot resurrect those reviews. Review
creation records trusted head and comparison-tree IDs: metadata-only commits
with the same trees preserve approvals and do not change the latest reviewable
pusher. Older review records without these IDs keep conservative exact-commit
and anchor matching until a fresh review is submitted.

For Git PRs, reading/reviewing/merging refreshes the comparison to the current
merge base with a serialized head/base check. A changed comparison tree also
automatically dismisses approvals, even when the PR head did not move. An
unchanged comparison tree preserves approval across base metadata changes.
Stale review/merge submissions receive 409 and must refresh their comparison.

Explicitly setting `dismissStaleReviews:false` retains undismissed independent
approvals across changed files and comparison bases, including for code owners.
PR authors and agents still cannot supply independent approval. In this mode a
prior reviewer who later pushes can retain their general approval; enabling
`requireLastPushApproval` separately requires a fresh review of the current files
and comparison by someone other than the latest reviewable pusher. Under the
strict default, the latest pusher is excluded from the general independent count
as before. Change requests and unresolved conversations remain blocking in both
modes. CI continues to require the exact head/base candidate in either mode.

The private production canaries retain strict dismissal. See
[stale-review validation](evidence/review-staleness-validation.md).

## Required code owner review

Enable **Require review from code owners** under Settings → Rules. The native
policy field is `requireCodeOwnerReview` (Git repositories only). It composes with
overlapping policies and forces updates through a PR even when the separate
`pullRequest` flag and general approval count are zero. Deletion remains governed
by the independent deletion restriction.

Ownership is read from the current base commit, checking `.github/CODEOWNERS`,
`CODEOWNERS`, then `docs/CODEOWNERS`. A proposed head cannot rewrite its own
review requirements. The last valid matching line controls a path; an ownerless
line removes its assignment. Matching is case-sensitive and supports root paths,
directory patterns, `*`, `?`, `**` and escaped spaces. Invalid lines are reported
and skipped. One eligible owner approval per matched group suffices.

`@handle` means a Nanohub owner namespace, resolved to its stable account ID and
current repository write permission. It is not a commit-author name, an agent
identity or an assumed mapping from another host's username. The sequencer
reverifies this authority immediately before its final merge transaction.
Independent repositories do not call Codegraff room membership services. Bound
Codegraff-team repositories require fresh provider evidence for mapped accounts.

General independent-review rules still apply: author, agent and dismissed
approvals never satisfy ownership. The strict default also excludes the latest
pusher. Retained older approvals can satisfy ownership when
`dismissStaleReviews` is explicitly false; the latest-push gate remains separate.
The full Git changed-path set
is checked, including binary files, removed/renamed paths and mode changes; the
UI's truncated diff is not used as enforcement evidence. Evidence binds exact
base/head IDs, and the final transaction rechecks current policy and candidate.
Public merge JSON cannot supply a trusted ownership decision or account map.

The PR response includes `codeOwners` status with file, groups, path samples,
counts, notices and missing approvals. Required missing/unverifiable ownership
disables the UI merge control and blocks the server operation. A successful merge
retains its base/head ownership decision in the PR's archived record.

Unknown individual handles or accounts lacking write access receive no assignment.
A missing CODEOWNERS file, or one at least 3 MiB in size, adds no assignments;
the latter produces a notice. Add a matching owner for CODEOWNERS itself when
protecting ownership edits. Team and email tokens are parsed but lack identity
mapping: a group depending on those tokens remains blocked unless another mapped
owner validly approves. They are not treated as an empty ownership rule.
Unreadable/binary/symlink ownership files and exhausted traversal/evaluation
budgets report blocking errors when owner review is required. These explicit
platform limits and mapping gaps prevent claiming complete GitHub CODEOWNERS parity.

See [CODEOWNERS validation](evidence/codeowners-validation.md).

## Repository rulesets

The [ruleset API shape](https://docs.github.com/en/rest/repos/rules) is available
under `/api/trunks/:id/rulesets` and `/api/repos/:owner/:repo/rulesets`.
`GET` returns `{revision,rulesets}`; `POST` creates a ruleset. `GET`, `PUT`, and
`DELETE` on `/:rulesetId` read, replace, and remove one. Mutations require a
signed-in human admin and the same origin. Readers can inspect configured rules.
IDs are repository-local integers; User bypass actors use Nanohub account strings,
while RepositoryRole actors use the explicit numeric role IDs 4 and 5.
Unsupported types, enforcement modes, conditions, and parameters are rejected.
Bypass account identities are returned only to signed-in human rule editors;
ordinary members and agents see the requirements without the bypass list. This
also applies to branch/PR snapshots and mutation responses.

```json
{
  "name": "Release tags",
  "target": "tag",
  "enforcement": "active",
  "conditions": {
    "ref_name": { "include": ["refs/tags/v*"], "exclude": [] }
  },
  "bypass_actors": [],
  "rules": [{ "type": "deletion" }, { "type": "non_fast_forward" }]
}
```

Push rules use `target: "push"` without conditions, for example
`{"type":"file_path_restriction","parameters":{"restricted_file_paths":["private/**"]}}`,
`{"type":"file_extension_restriction","parameters":{"restricted_file_extensions":[".key"]}}`,
`{"type":"max_file_path_length","parameters":{"max_file_path_length":255}}`, or
`{"type":"max_file_size","parameters":{"max_file_size":10}}` (MiB).
Path and size parameters may include `"allowed_file_paths":["**/gradle/wrapper/*.jar"]`.
An exception skips only that one rule for a matching filename. It cannot waive
an extension/path-length rule, another ruleset, branch protections, or the host's
object-size limits. Exceptions never give a raw blob tag an invented filename.
To permit selected files of a blocked type, use a path pattern such as
`**/*.jar` with a specific exception; extension rules do not accept exceptions.

GitHub's [product guidance](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)
documents path/size exceptions, while its published REST schema currently omits
an exception parameter. `allowed_file_paths` is Nanohub's native parameter for
that behavior; unchanged GitHub REST import/export of this field is unverified.

Graph proofs bind the exact old/new object IDs and current rules revision.
Changing any ruleset during graph validation invalidates the proof before a
protected ref moves. Object uploads alone publish no refs. Multi-ref rejection
rolls back the entire ref transaction. Traversal/evaluation limits fail explicitly.

An explicit bypass entry is
`{"actor_type":"User","actor_id":"codegraff:account-id","bypass_mode":"always"}`
or `"pull_request"` for branch merge-only bypass. The human must still have
repository write access. Owning an agent credential does not grant that agent
the human's bypass; submitted `human` and `proof` JSON fields have no authority.

## Metadata restrictions

Branch and tag rulesets support `commit_message_pattern`,
`commit_author_email_pattern`, `committer_email_pattern`, and the corresponding
`branch_name_pattern` or `tag_name_pattern`. These use
[GitHub's metadata parameters](https://docs.github.com/en/rest/repos/rules):

```json
{
  "type": "commit_message_pattern",
  "parameters": {
    "name": "Conventional subject",
    "operator": "starts_with",
    "pattern": "feat:",
    "negate": false
  }
}
```

`operator` is `starts_with`, `ends_with`, `contains`, or `regex`. `name` and
`negate` are optional. Literal operators treat wildcards as ordinary text;
matching is case-sensitive. Multiple metadata restrictions of the same type are
allowed and all must pass. The editor, JSON import/export and history restoration
retain these separate restrictions. A restriction's optional description appears
in rejection messages so contributors can identify the failed rule.

Name patterns check the unprefixed branch/tag name during the final ref
transaction. Commit rules inspect complete raw messages, including trailers and
trailing newlines, and distinguish author from committer email. Use `\n?$` for
an optional terminal newline in a regex. Metadata fields that cannot be decoded
as UTF-8 or whose required identity header cannot be parsed fail explicitly;
a negated rule cannot turn missing metadata into an accepted identity.

Commit rules check every introduced commit, including intermediate and merge-side
commits, and peel nested annotated tags. Updates exclude the previous ref's
ancestry; new refs check reachable history. A metadata-restricted tag must point
to a commit. Metadata rules do not obstruct deletion by themselves; separate
lifecycle restrictions govern deletion. These checks enforce formatting only
and do not establish verified authorship or commit signatures.

Trusted graph evidence binds the target ref, exact old/new IDs and current
ruleset revision. The final serialized writer rechecks these bindings. A clean
proof for a different ref, stale policy or caller-supplied JSON cannot skip a
metadata restriction. Ordinary Git, HTTP branch creation, restack and PR merge
use this boundary. Explicit human-only ruleset bypasses remain scoped and audited.

Regex matching uses pinned `re2js` 2.9.0 with a bounded per-proof cache and DFA
memory. Limits are explicit: 512 pattern characters, 64 nested groups, counted
repetitions up to 1000, conservative pre-compilation expansion budget, at most
4096 compiled instructions, and 20 million matching-work units per proof.
Unsupported RE2 constructs and exceeded budgets reject the operation rather than
weakening the rule. See [metadata validation](evidence/metadata-rules-validation.md).

## Validation and activation

Local checks use pinned tsrs across API, web and vault. Unit cases cover rule overlap, stale approvals, same-SHA repushes, changes requested on old revisions, unresolved old threads, locks/allowed pushers on merge, and topology proof binding. The native Git integration exercises linear branch pushes, rejection of real merge topology, HTTP creation from a merge-bearing source, locks and allowlists, plus exact-candidate CI/approval and fresh-clone `git fsck --strict`. Access integration verifies admin protection management without CI-owner escalation.

Ruleset cases additionally cover tag lifecycle and exclusions, atomic mixed-ref
rollback, binary size, Unicode path length/globs, intermediate and merge-side
prohibited files, nested tag peeling, config races, HTTP proof forgery, and
human-only bypass. Real Git and HTTP integration verifies that a PR opened
before a new push rule cannot merge prohibited history, and that an owner agent
cannot use the same account's signed-human merge bypass. The editor was saved
and reopened against the synthetic local repository.
Exception cases cover nested binary allowances, neighboring denied files,
separate path/size and overlapping rules, exception removal during validation,
intermediate rename history, raw blob tags, malformed patterns and array limits.
Real Git accepts a 2 MiB wrapper binary under a 1 MiB rule only at its configured
exception, while HTTP branch creation and annotated tags use the same rules.
Saved UI evidence: [tag ruleset](evidence/repository-tag-ruleset.png) and
[push ruleset](evidence/repository-push-ruleset.png).

The UI fixture uses synthetic data only: [saved protection settings](evidence/branch-protection-settings.png). Nanohub and the private vault are deployed. A real Cloudflare Secrets Store binding scoped only to the production test repository passed hosted lifecycle checks; no real credentials were migrated. The Codegraff runner image/sandbox-scoped key and live staging validation remain outstanding. Hosted validation is recorded below.

## Protection activity

Following GitHub's [ruleset history and insights](https://docs.github.com/en/enterprise-cloud%40latest/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/managing-rulesets-for-a-repository),
admins can open **Settings → Rules → Protection activity**. This is recorded successful
activity and configuration history; it does not claim to be failed-push insights.
New rule/protection edits retain the normalized before and after configuration in
the same serialized transaction as the change. Deletion retains the old revision.
Existing older records remain readable and are labeled “Saved” when their original
create/update distinction was not recorded.

`GET /api/trunks/:id/repository/audit` (also under the owner/repo alias) requires a
signed-in human repository admin, including for previously deleted rulesets.
Members, readers and agent credentials cannot use this endpoint. Responses have
`Cache-Control: private, no-store`. Query parameters are `kind` (`all`, `rulesets`,
`protections`, `refs`, `bypasses`, `ci`), exact `ref`, numeric `ruleset`, `limit`
(1–100, default 25), and exclusive `before` event ID. The response is
`{events,nextCursor}` in descending event-ID order. Use the returned cursor for
the next page. New events do not shift older pages; refresh to see them.
The history reads the full audit table, not a latest-200 display window. Filters
compose, including ruleset edits/deletions and refs that bypassed that ruleset.
Future internal audit fields are excluded unless explicitly exposed by this API.

The local tests exercise 261 events with concurrent insertion during pagination,
filter validation, deleted ruleset history, human bypass receipts, before/after
configurations, real HTTP role checks and owner/repo isolation. Rule evaluations,
including rejected final ref transactions, are recorded separately below. Full
GitHub REST schema compatibility remains open work.

### Evaluate mode and rule insights

This follows [GitHub's evaluate-mode and rule-insight workflow](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/managing-rulesets-for-a-repository) with native account identities and APIs.

Select **Evaluate (log only)** to observe a ruleset without rejecting a ref
write. Active rulesets and classic branch protections still enforce normally.
Evaluation-only graph work has its own bounded budget and separate signature
and metadata evidence; it can neither satisfy nor invalidate an active proof.
Unavailable observation evidence records **Could not evaluate** and does not
block an otherwise compliant write. Disabled rulesets produce no observations.
Imported/exported/restored configurations preserve the selected mode.

**Rule insights** under Settings → Rules lists matching rulesets, their mode,
pass/fail/bypass/error outcomes and rejection reasons, the exact old/new refs,
actor, source operation and rules revision. A failed evaluation may accompany
an accepted write; the UI shows both outcomes. Success evidence commits with the
ref transaction. Failed-attempt evidence is retained after rollback, with one
batch ID for all attempted refs. Passing one ref in a rejected atomic batch does
not claim that ref was updated. Human bypass remains scoped and cannot waive
classic protection. The existing accepted-write audit is unchanged.

`GET /api/trunks/:id/rulesets/rule-suites` accepts `limit` (1–100, default 25),
exclusive `before` observation ID, exact `ref`, `actor`, `ruleset`, `result`
(`pass`, `fail`, `bypass`, `error`), and inclusive `from`/`to` epoch milliseconds.
Filters compose and keyset pagination is stable under new arrivals.
`GET .../rule-suites/:id` reads one retained observation. Both routes require a
signed-in current repository admin and return private/no-store responses.
Runner, agent and Git credentials cannot read them. Owner/repo aliases work
through the same native routing.

Retention is bounded by 30 days, 2,000 observations and 32 MiB per repository.
Only attempted refs that reached final rule evaluation are recorded. Upload,
authentication, malformed-object, preflight graph-validation failures and
unattempted refs after the first rejection are not presented as rule suites.
Graph restrictions retain the first discovered violation per ruleset; this is
not a complete per-rule/per-commit trace. No backfill, aggregate dashboard or
full GitHub rule-suite response-schema compatibility is claimed.

Native Git repositories advertise the `atomic` capability: an explicit
`git push --atomic` negotiates the existing serialized all-or-nothing ref writer.
Each atomic batch accepts at most 100 ref commands. Legacy snapshot repositories
do not advertise atomic support.

See [rule insight validation](evidence/rule-insights-validation.md).

### Compare and restore a ruleset

**Compare and restore** on a ruleset event shows the changed fields and optional
complete current/selected configurations, including bypass accounts. A matching
version needs no restore. Restoring applies the selected enforcement mode,
patterns, restrictions and bypass list immediately; it does not change separate
branch protection rules.

`GET /api/trunks/:id/rulesets/:rulesetId/restore?event=:eventId` returns the
admin-only `{eventId,rulesetId,revision,recordedAt,current,selected}` comparison
with `Cache-Control: private, no-store`. `POST` to that path accepts only
`{eventId,revision}`. The server loads and revalidates its own archived snapshot;
client-supplied rules cannot replace that source. Both endpoints require a
signed-in human admin; the mutation additionally requires the same origin.
Owner/repo aliases use the same implementation.

The restore, rules revision increment and before/after audit entry run in one
sequencer transaction. Any intervening ruleset edit returns HTTP 409 without
applying anything; the UI requires a new comparison instead of silently retrying.
An existing ruleset keeps its ID. A deleted ruleset creates a new ID, explicitly
shown in the comparison, and obeys the 100-ruleset limit. A deletion event selects
its recorded pre-deletion version. Unsupported historical restrictions fail
instead of being omitted.

The new audit entry contains `restoredFrom: {rulesetId,eventId}` alongside its
current and restored snapshots. Filtering the original deleted ID includes the
recreation event. See [restore validation](evidence/ruleset-restore-validation.md).

### Portable ruleset JSON

**Download JSON** on a ruleset exports its current configuration. **Download
version JSON** in activity exports the selected recorded version, including the
pre-deletion configuration of a deleted ruleset. Following GitHub's documented
export behavior, both omit bypass accounts. They also omit source IDs and audit
metadata while preserving supported restrictions, targeting, enforcement and
native allowed-path exceptions.

`GET /api/trunks/:id/rulesets/:rulesetId/export` downloads the current configuration
for repository members. Add `?event=:eventId` for an admin-only historical export.
Responses are JSON attachments with deterministic numeric filenames,
`Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`.

**Import JSON** accepts a file or pasted JSON, shows the normalized configuration
and any scope/metadata translation notes, then requires **Create imported
ruleset**. Editing or replacing the source invalidates the preview. Import always
creates a new repository-local ID; it never overwrites an existing rule. Active
imports begin enforcement when created. Normal rule-count limits, permissions,
validation and atomic creation/auditing apply.

`POST /api/trunks/:id/rulesets/import/preview` accepts `{configuration}` and returns
`{configuration,notes}` without writing or changing the rules revision. `POST`
to `/rulesets/import` validates again and creates the ruleset. Both require a
same-origin signed-in human admin. UI source size is limited to 120 KiB; the API
request envelope is limited to 128 KiB.

Only known source display metadata (`id`, `node_id`, `source`, `source_type`,
`created_at`, `updated_at`, `_links`) is omitted, with a preview note. An explicit
`repository_name` selector covering `~ALL` with no exclusions can map to the
selected repository, also with a note. Selective repository conditions, unknown
policy fields, unsupported rule types and nonempty imported bypass
lists are rejected. Bypass accounts must be configured locally after import.
This supports the common configuration shape and supported subset of GitHub
recipes, not all GitHub rules or organization-level policies. The native
`allowed_file_paths` extension retains its compatibility limitation above.

See [transfer validation](evidence/ruleset-transfer-validation.md).

## Hosted validation

Nanohub and the private vault service have been deployed. Real Git transport,
branch/tag/file protection and token revocation passed against an isolated private
production repository; see [the production receipt](evidence/production-validation-2026-10-26.md).
Hosted Cloudflare secret-value lifecycle also passed using an isolated synthetic
value: private RPC and production workload reads, scope isolation, revocation,
expiry, rotation without redeployment and retention after disconnect. The idle
scope has no scheduled alarm; actual runtime eviction remains platform-controlled.
This does not prove full GitHub parity or Meld migration/staging acceptance.
A later [live cloud smoke](evidence/codegraff-live-validation.md) verifies actual
Codegraff workflow execution against an isolated local Nanohub repository;
the later [full Linux toolchain acceptance](evidence/codegraff-toolchain-validation.md)
proves the image build and offline project gates. [Private toolchain distribution](evidence/private-toolchain-registry-validation.md)
and fresh offline Linux acceptance now pass. Unattended hosted CI and staging
activation remain outstanding.
Rules and protection administration is now under **Settings → Rules**, with a
link from Branches. Staging approval is under Actions.

## Selected force-push accounts

Classic branch protections support `allowForcePush`, following the distinction
between ordinary writers and selected force pushers in
[GitHub's force-push controls](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#allow-force-pushes).

| Configuration | Rewrite behavior |
| --- | --- |
| `preventForce: true`, list omitted or empty | No account can rewrite history |
| `preventForce: true`, `allowForcePush: ["codegraff:account-id"]` | Only selected accounts with current write access and a write-capable credential may rewrite |
| `preventForce: false`, list omitted | Ordinary repository writers may rewrite, subject to every other requirement |

Lists contain at most 100 stable account IDs, at most 256 characters each.
Duplicates are removed. A list with force blocking disabled is rejected so a
selected list cannot give a false impression of restricting everyone else.
Snapshot workspaces do not accept this Git-only option. Under Settings → Rules,
**Restrict force pushes** keeps the default block; **Allow selected accounts to
force push** enables the separate account list. Existing CLI `rules get/set`
commands preserve the new field and use the existing revision/admin grant.

These accounts still need ordinary update access. The option cannot waive a
branch lock, deletion block, PR/review/check requirement, signatures, linear
history, deployment evidence, file restrictions or another ruleset. Ordinary
fast-forward pushes remain governed by normal write/pusher access. Agent and
CLI Git credentials use their owning account's explicitly configured permission;
they gain no browser-only ruleset bypass. Current role, credential validity and
archive checks still apply. All matching force-blocking policies intersect their
exception lists; one unconditional block defeats another rule's exception. This
retains Nanohub's documented overlap semantics rather than GitHub's single-classic
rule precedence. Teams and app-specific force grants remain unsupported.

Actual HTTP restack uses the same rewrite boundary. Accepted native rewrites
record `force: true`, actor and old/new IDs in admin activity and display as
**Force pushed**. Historical records without that evidence are not relabeled.
Content-changing rewrites dismiss stale approvals and supersede old-head CI as
normal; metadata-only rewrites retain the existing tree-bound review semantics.

File rules inspect both the actual ref-tree transition and every introduced
commit. Rewinding to an older commit or adding a descendant of an older ancestor
cannot restore a newly restricted path/extension/size merely because those
objects were already reachable. Annotated-tag replacements use the peeled tree
transition too. Existing unchanged files remain grandfathered; this does not
scan every unchanged path in the current tree. Evaluate mode observes the same
transition without blocking. New final writers require `fileTransitions: true`
in trusted file-rule evidence; older producers must retry on updated code rather
than skipping the added check.

`GET /protection` advertises `forcePushActors: true` once its stateful receiver
supports the new permission. New list writes wait with retryable 503 until that
capability is visible. Older builds cannot grant the exception: they retain the
force block. Keep a force-aware application deployed when using this feature.
See [validation](evidence/force-push-actors-validation.md).


## CLI lifecycle administration

`nh repo archive-status`, `nh repo archive` and `nh repo unarchive` use the same
repository-wide fence as browser settings. An explicit `repository:archive`
current-admin grant, current repository-name confirmation and conditional revision
are required. Admins can delegate lifecycle control while archived without
obtaining content or rule-edit access. Lost answers never trigger an automatic
write retry. Accepted CLI transitions retain actor/credential audit across
interruption and restart. Reopening preserves locks, rules, refs and retained
Cloudflare secret values. See [CLI contract](hosting-cli.md#repository-archive-and-unarchive)
and [verification](evidence/cli-archive-validation.md).


## Ruleset bypass by repository role

Rulesets may explicitly permit current repository admins (including owner) or
current writers to bypass that ruleset. Both start at **No bypass** in Settings
→ Rules → Bypass permissions. Branch rules offer **Always** or **Pull request
merges only**; tag/push rules accept **Always**. No membership role bypasses a
rule implicitly. This follows GitHub's
[role bypass model](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository),
with the credential and role limits below.

```json
"bypass_actors": [
  {"actor_type":"RepositoryRole","actor_id":5,"bypass_mode":"pull_request"},
  {"actor_type":"RepositoryRole","actor_id":4,"bypass_mode":"always"}
]
```

Role ID **5** selects native owner/admin; **4** selects native writer. These
numeric role identifiers match the GitHub integration's
[documented built-in role IDs](https://github.com/integrations/terraform-provider-github/blob/main/docs/resources/repository_ruleset.md).
Each role has one configured mode. Writer is an exact role, with admins selected
separately. Unknown IDs, numeric strings, maintain/custom roles and silent
`exempt` mode are rejected. Individual User actors still use stable local
account IDs; numeric role IDs cannot masquerade as account IDs.

Bypass remains limited to signed-in human changes. Ordinary Git tokens, scoped
CLI credentials and agent credentials retain their existing no-inheritance
boundary, even when their owning account has the selected role. A bypass cannot
waive a repository archive, a classic branch lock/pusher/PR/review/check rule or
another matching ruleset. PR-only bypass does not permit direct branch changes.
The selected ruleset's signature and deployment preview follows the same decision
as its final PR merge; classic requirements remain independent.

The Sequencer obtains current native roles from one Hub snapshot or fresh
external membership evidence when role bypass is configured. External owner maps
to native owner/admin selection and external member maps to writer. Evidence is
bound to the exact account, checked again at final ref mutation, and expires
within 30 seconds. A missing role, changed account, expired proof or unavailable
provider cannot grant bypass. This is a bounded membership observation across
separate services, not an atomic cross-service membership/ref transaction.

Accepted ref audit includes the observed role/time; rule insights also identify
which User or RepositoryRole actor and mode matched. Existing records are not
backfilled. Suggestions and protected merges use the same final role boundary.
Native CLI 0.4.8 full ruleset export/update preserves numeric role actors and
uses its existing `rulesets:write` admin scope. Portable cross-host JSON continues
to omit bypass authority and reject imports with nonempty bypass lists. Configure
local grants deliberately after importing.

Stateful `GET /rulesets` advertises `roleBypass: true` only after both the rules
engine and Hub role receiver support the feature. New role edits wait with
retryable 503 during propagation; they never downgrade to an earlier writer.
See [role validation](evidence/ruleset-roles-validation.md).
