# Reader feedback design validation

Recorded 2026-10-31 for the local pull-review Operate extension. The authority is
the incumbent [PRODUCT.md](../../PRODUCT.md), [DESIGN.md](../../DESIGN.md),
[design sidecar](../../.impeccable/design.json) and the
[pull-review surface contract](../../.impeccable/surfaces/pull-review.md).
Harness Paper/Graphite typography, palette, components and shared top navigation
remain the visual direction. No new token or redesign is introduced.

## Evidence inspected

This documentation workflow directly read the local source below and inspected
all seventeen captures with `view_image`: six desktop and eleven narrow-context
images. It also read the retained narrow-viewport observations and reproduction
fixture. It did not run a new browser session or independently repeat functional
tests. The fresh finish reviewer inspected the seven UI sources, associated CSS
and all seventeen captures and returned the canonical disposition **ship**, with
no material fixes. This supersedes the earlier **recapture** disposition for
missing narrow evidence. It closes the narrow-layout gate at 390×640 only and
does not grant release approval.

| Source | Evidence recorded |
| --- | --- |
| [PullDetail.tsx](../../apps/web/src/trunk/review/PullDetail.tsx) | Reader role and author identity, immediate decision labels/disabled author options, reader-feedback results, current-writer eligibility messages and review gate display. |
| [PullFiles.tsx](../../apps/web/src/trunk/review/PullFiles.tsx) | One-file review, private pending review, current revision matching, own-root or broader-capability resolution, suggestion capability gate, earlier threads, status/error and focus targets. |
| [PendingReview.tsx](../../apps/web/src/trunk/review/PendingReview.tsx) | Private-comment explanation, edit/remove/discard, stale/closed submission restrictions, reader decision labels and author Comment-only behavior. |
| [RequestedReviewers.tsx](../../apps/web/src/trunk/review/RequestedReviewers.tsx) | Member selection including reader feedback-only labels, manager capability, request status and explanation that branch protection determines required approvals. |
| [HunkReview.tsx](../../apps/web/src/components/issues/review/HunkReview.tsx) | Line/chunk selection, same-hunk/side range bound of 201 lines, initial 200-row display with incremental reveal, immediate/private posting and after-side suggestion composition. |
| [ReviewThread.tsx](../../apps/web/src/components/issues/review/ReviewThread.tsx) | Reply, Resolve/Reopen capability, suggestion display and gated apply/batch controls. |
| [cli-scopes.ts](../../apps/web/src/lib/cli-scopes.ts) | `reviews:write` copy describes submitting review feedback and inline comments. |

The associated `PullFiles.module.css` and `Review.module.css` were also read.
They use incumbent theme variables, compact type, flat bordered surfaces,
bounded scrolling and visible focus styles. The file toolbar has a 600px
wrapping rule; hunk headers wrap below 900px. The narrow captures below now
provide rendered evidence; source rules alone do not establish accessibility
conformance.

## Captured desktop states

All captures below are 1280×720, independently checked from image metadata.
They are local browser review evidence, not generated artwork or shipping
raster assets. Native captures were JPEG bytes under `.png` names; identical
bytes are retained here with `.jpg` extensions, without conversion.

| Capture | Direct visual observation and limit |
| --- | --- |
| [reader-feedback-desktop.jpg](reader-feedback-desktop.jpg) | Paper diff/thread followed by published reader approval, “Reader feedback,” its non-counting explanation and a reader review form. Another member's visible thread has a reply action and no Resolve control. The closed decision select does not show its option list. |
| [reader-feedback-pending.jpg](reader-feedback-pending.jpg) | One private pending inline comment, path/line metadata, edit/remove controls, feedback-only warning, review summary, decision, Submit pending review and Discard review. The Reviews area points back to Finish your review. |
| [reader-feedback-success.jpg](reader-feedback-success.jpg) | Published reader Request changes feedback with one inline comment and the non-blocking explanation; the reader's visible thread is Resolved with Reopen. This captures the resulting state, not an independent replay of submission or resolution. |
| [reader-feedback-dark.jpg](reader-feedback-dark.jpg) | Graphite counterpart of the published reader feedback and review form, preserving charcoal surfaces, pale ink, dividers and compact controls. It is a desktop capture. |
| [reader-feedback-author.jpg](reader-feedback-author.jpg) | Author-specific explanation and Comment form beneath the reader feedback. The source, rather than this closed select, proves Approve and Request changes are disabled. Visible Dismiss review actions follow the separate dismissal capability. |
| [reader-feedback-request.jpg](reader-feedback-request.jpg) | Manager's reviewer request form selects a reader with feedback-only labeling and adjacent explanation. The merge area still requires one independent approval and has zero; requesting reader feedback does not satisfy it. |

The visible desktop hierarchy and spacing retain the incumbent workspace. Reader
status is expressed in text beside decisions and reviews, pending privacy is
explicit, and thread state is labeled rather than communicated by color alone.
The finish review found no material desktop correction. These scoped
observations do not constitute a full accessibility, performance or cross-browser
audit.

## Captured narrow-context states

All eleven new images are native JPEG captures at 390×640, independently checked
from metadata and byte-compared with their originals in `.impeccable/review/`.
They are not resized desktop screenshots. This documentation pass inspected
each image directly; the interaction and DOM measurements below were supplied
by the implementation workflow and retained in its observations file.

| Capture | Direct visual observation and limit |
| --- | --- |
| [reader-feedback-mobile.jpg](reader-feedback-mobile.jpg) | Reader decisions, feedback-only explanations and immediate review form wrap within the narrow page. The viewport shows a scrolled section, not the entire page. |
| [reader-feedback-mobile-composer.jpg](reader-feedback-mobile-composer.jpg) | Actual inline after-side hunk composer, Suggest change, textarea and all three footer actions: Start a review, Post single comment and Cancel. The capture uses the existing local PR author, with the same shared `HunkReview` component/actions as the reader. |
| [reader-feedback-mobile-pending.jpg](reader-feedback-mobile-pending.jpg) | Reader private pending comment, edit/remove actions, privacy and feedback-only explanations, summary, decision, submit and discard controls. Actions wrap within the viewport. |
| [reader-feedback-mobile-published.jpg](reader-feedback-mobile-published.jpg) | Published reader Request changes feedback with one inline comment and the explanation that it supplies neither required approval nor a change-request veto. |
| [reader-feedback-mobile-resolved.jpg](reader-feedback-mobile-resolved.jpg) | Reader's published thread shows Resolved/Reopen, while another member's thread has a reply action and no reader Resolve control. |
| [reader-feedback-mobile-dark.jpg](reader-feedback-mobile-dark.jpg) | Graphite reader feedback and immediate review form, including a visible native Tab focus ring on Submit review. |
| [reader-feedback-mobile-author.jpg](reader-feedback-mobile-author.jpg) | Author Comment-only explanation and immediate form with visible Submit review focus. Closed-select disabled options were checked in the recorded DOM observations. |
| [reader-feedback-mobile-author-pending.jpg](reader-feedback-mobile-author-pending.jpg) | Author private pending review with Comment-only explanation, summary, decision, submit and discard; the submit focus ring remains visible. |
| [reader-feedback-mobile-request.jpg](reader-feedback-mobile-request.jpg) | Reviewer request form selects the reader with feedback-only labeling and explanatory text; Send request has visible focus. |
| [reader-feedback-mobile-request-sent.jpg](reader-feedback-mobile-request-sent.jpg) | Requested reader now shows Waiting for review, Reader · feedback only, and Remove request. Required independent approvals remain at zero above it. |
| [reader-feedback-mobile-top.jpg](reader-feedback-mobile-top.jpg) | Narrow shared top navigation, repository tabs, wrapped PR title, metadata and protection panel. Horizontal tab scrolling remains local to its row. |

The corrected composer capture replaces the earlier inadequate composer
evidence. Recorded button right edges are 142.28125px, 296.125px and
364.4453125px, all inside the 390px context. The supplied workflow exercised
reader private save, publication and own-thread resolution; reader requests;
author Comment-only decisions in both forms and author publication; and native
Tab focus. Both author decision selects recorded Comment enabled and Approve /
Request changes disabled. These are supplied interaction results, not new
runtime tests by this documentation pass.

## Narrow capture provenance and verdict history

The first review correctly returned **recapture**: attempts to call
`viewport.set({width:390,height:844})`, reload and open a new tab left the actual
DOM viewport at 1280×720. Those desktop images supplied no mobile evidence.

The later workflow used a temporary same-origin HTML parent hosting the
unchanged app in an iframe set to 390px wide and 640px high. CUA observations
recorded actual iframe `innerWidth:390`, `innerHeight:640`, HTML
`scrollWidth:390` and a matching `max-width:600px` media query. The outer browser
remained 1280×720. Native browser screenshots were clipped to the iframe
rectangle `(0,0,390,640)` with no image resizing or app CSS alteration. This is
genuine narrow browsing-context layout evidence. The temporary public HTML was
removed; it was excluded from the frozen build.

Private reproduction evidence is retained at
`/Users/blackfloofie/.config/nanohub/reader-feedback-release-2026-10-31/responsive-fixture.html`
and
`/Users/blackfloofie/.config/nanohub/reader-feedback-release-2026-10-31/mobile-observations.json`.
This pass read both files. They describe the capture method and measurements;
the reproduction HTML does not change app styles.

The fresh reviewer's **ship** verdict follows inspection of all seventeen
captures, the seven UI sources and associated CSS, with no material UI fix.
**The narrow-layout gate is CLOSED at 390×640 only.** This does not establish
iOS/Android touch, device, virtual-keyboard or comprehensive accessibility QA.

## Permission meaning

Readers can contribute review decisions and inline feedback; their Approve and
Request changes decisions remain feedback only. Required approvals still need
independent, currently eligible writers under the repository's rules. Author
decisions are Comment-only in both review forms. A reader may resolve/reopen
their own root thread; broader resolution depends on `canResolveAll`. Unresolved
reader conversations can still block merging when conversation protection is
required, even though the reader's Request changes decision does not.

Readers may propose suggestions, but application remains writer-only. The
review UI exposes application controls only when repository mode, commenting
permission and `canApplySuggestions` are all present. Reviewer requests can
include readers and explicitly distinguish feedback from required approvals.
The CLI grant wording makes the same feedback distinction without granting
repository write authority. Server authorization, current membership and
credential scopes remain authoritative; this pass inspected presentation and
capability use rather than independently validating server enforcement.

## Validation limits and release boundary

The Impeccable context launcher and single detector attempt failed with
permission denied / exit 126 in the parent workflow. No detector verdict or
QUALITY BAR result is claimed. The launcher was not repaired or rerun by this
documentation pass. No second detector attempt was made.

The pre-existing shared review `Notice` danger-token drift remains out of
scope: its `border-danger/30` / `bg-danger/5` usage is not promoted to a new
design token or repaired here. Error, stale, closed, suggestion application,
and assistive-technology paths were inspected only where described in source;
no dedicated capture or new interaction test for those paths is claimed. Native
Tab focus was exercised within the narrow context, as recorded above; it does
not establish comprehensive keyboard or assistive-technology coverage.

Separately, the implementation owner supplied Linux acceptance for frozen
source `b04e1eb178e7fb6ffa40e818068b3443901b6d04`: all nine frozen gates passed,
including 451 API and 103 CLI cases. The exact candidate 0.4.21 CLI was 101486
bytes with SHA-256
`b7b663508a22af420f74ec4caaf16690c9fefb5ba49b2405459bd5452df5885e`.
The sandbox provider was destroyed after the run. These are supplied parent
results, not independent runtime validation performed by this documentation
pass.

At the time of this design documentation pass, candidate CLI **0.4.21 was
unpublished**, with CLI 0.4.20 and its server unchanged. The implementation owner
subsequently deployed 0.4.21; [release acceptance](reader-feedback-release-validation.md)
records the separate delivery and production smoke evidence. This design
documentation itself does not establish deployment, production validation,
complete GitHub parity, release approval or readiness.

## Persistence

This pass writes only
[pull-review.md](../../.impeccable/surfaces/pull-review.md) and this validation
record. `PRODUCT.md`, `DESIGN.md`, `.impeccable/design.json`, runtime source,
tests, captures and unrelated content are preserved. Existing global design
artifacts remain the source of visual tokens and shared component guidance.
