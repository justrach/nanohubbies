# Reader feedback — local source candidate

The unpublished **0.4.21** candidate adds [reader review feedback](../reader-feedback.md)
to the browser, API and native CLI. Production CLI 0.4.20, its immutable release
catalog and deployed Workers are unchanged by this work. This is scoped local
acceptance, not a release, complete GitHub parity or traffic-readiness claim.

## Implemented boundary

Readers can submit decisions and bounded inline/private batch reviews. Reader
opinions retain their requested decision under `feedback`, while the durable
review remains `COMMENT` / `independent: false`. Current and older approval,
CODEOWNERS and shared-head gates therefore cannot count those opinions or let
them supersede writer decisions. Stored guards reject conversion or marker and
identity changes. Promotion does not turn an existing opinion into approval.

Separate private draft tables prevent reader drafts from entering the legacy
shared-head pending-review veto. Browser and exact delegated-credential ownership,
cross-store identity/ownership fences, combined capacity limits and retry receipts
survive role transitions. Publication derives authority from current membership;
retry metadata derives from the published review, not a later promotion. A
historical writer draft keeps its existing pending gate until explicit action.

Reader reviews answer requested reviews without supplying required approvals.
The storage-v2 generation/high-water ordering hooks extend compatibly and can
reconcile a later reader insert after an older hook. Late audit failures roll
back reviews, comments, answers and private-draft removal. Authors can Comment
only. Own-thread resolution is separate from writer/PR-author resolution;
suggestion application and all other protected writes remain separately guarded.

## Checks run

| Command | Observed result |
| --- | --- |
| `bun run --filter @swarm/api test:unit` | 451 passed, zero failed |
| `bun run test:cli` | 103 passed, zero failed |
| `bun run test:repository` | 343 selected unit cases plus the full configured real Worker/Git/CLI/protection/recovery sequence passed |
| `bun run --filter @swarm/api test:reader-feedback` | 26 focused storage/route cases, real Worker/Git source and actual portable CLI distribution passed |
| `bun run --filter @swarm/api test:cli-pending` | Existing private-draft storage and source/portable CLI lifecycle passed after receipt/output changes |
| `bun run check` | All three typed workspace tasks passed using pinned tsrs; one task was cached |

Focused real-worker acceptance covers reader approval non-counting before and
after promotion, retained writer approvals/change requests, shared-head private
and submitted feedback isolation, reader requests and answers, browser/CLI/sibling
privacy, review-scope consent, own versus other-root resolution, archive and
protected-write rejection. It directly calls the final writer after credential
revocation/expiry and membership removal, injects answer-audit failure and proves
atomic retry, then restarts, performs a protected merge and clones/fscks the real
repository, including binary content.

The portable CLI is built into a fresh private distribution using the production
publisher. Both review and pending-review text explicitly call reader decisions
feedback only; JSON preserves the legacy-safe row/receipt metadata. The candidate
module is 101,486 bytes, SHA-256
`b7b663508a22af420f74ec4caaf16690c9fefb5ba49b2405459bd5452df5885e`.
No public 0.4.21 release or catalog entry is created. The older help-only 0.4.21
record remains historical private-candidate evidence, with different bytes.

## Corrections retained in the private test record

The first expanded storage fixture selected the peer PR instead of PR #1; its
lookup was corrected. The old-receiver draft route case now explicitly tests the
verified browser-writer GET-only fallback and reader/CLI refusal. Requested-review
route mocks declare the new reader-aware capability and RPC; older mocks still
fail closed without mutation.

The broader regression run initially expected reader writes to be denied and
author self-approvals to succeed but not count. Tests now assert permitted reader
feedback, deny writer-only content/management scopes, reject author decisions at
the new human writer, and retain a direct historical self-approval storage case
that cannot satisfy CODEOWNERS. Device demotion still denies writer-only scope
exchange. A later full-suite repeat exposed the plain-Git fixture inheriting
global macOS credential helpers; its Git environment now ignores global/system
configuration while retaining its actual local credential helper and server
authentication checks. The isolated push/clone/revocation fixture passes. A simulated older answer-hook test uses the actual raw storage insert,
rather than the new ReviewStore that already repairs that hook. No merge,
CODEOWNERS, scope or current-authority guard was weakened to pass these tests.

## UI evidence and remaining gates

A real local disposable repository was exercised as reader and PR author. The
browser saved private hunk feedback, published Request changes as reader feedback,
resolved its own thread while another member's thread had no Resolve action,
and showed disabled author Approve/Request changes options. The writer's request
form included the reader with feedback-only labeling. The required-approval gate
still showed zero writer approvals. Paper and Graphite states were captured.

The [design record](reader-feedback-design-validation.md) and surface contract
preserve that scope. The finish reviewer found no material desktop UI fixes;
its final disposition is **recapture** pending genuine narrow-viewport evidence.
Attempts to set 390×844, reload and create a visible tab left actual DOM dimensions
at 1280×720. No current mobile acceptance is claimed. Skill context/detector
launches failed with permission denied/126; no detector or QUALITY BAR result is
claimed. Global design tokens remain unchanged.

Full frozen Linux acceptance, production build/asset delivery, compatible live
rollout and multi-account production reader checks remain open. No cloud sandbox
was allocated or production credential issued in this work. The intended Actions
account's existing sandbox-scope blocker, real application CI/staging/cutover,
full production recovery, sustained-load/SLO and operations gates are not closed.
Closed-PR feedback, reviewer teams, notifications and full GitHub API/Actions
compatibility also remain separate work.
