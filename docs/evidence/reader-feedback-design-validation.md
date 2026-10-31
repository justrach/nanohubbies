# Reader feedback design validation

Recorded 2026-10-31 for the local pull-review Operate extension. The authority is
the incumbent [PRODUCT.md](../../PRODUCT.md), [DESIGN.md](../../DESIGN.md),
[design sidecar](../../.impeccable/design.json) and the
[pull-review surface contract](../../.impeccable/surfaces/pull-review.md).
Harness Paper/Graphite typography, palette, components and shared top navigation
remain the visual direction. No new token or redesign is introduced.

## Evidence inspected

This documentation pass directly read the current local source below and
visually inspected all six captures with `view_image`. It did not run a new
browser session or repeat functional tests. The finish reviewer reported no
material desktop UI fixes. Its final disposition is **recapture**: genuine
mobile evidence is required before release acceptance; no release approval is
claimed.

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
wrapping rule; hunk headers wrap below 900px. These source rules do not establish
actual mobile rendering or accessibility conformance.

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

## Open validation gates and release boundary

**Mobile gate: OPEN.** The supplied workflow attempted
`viewport.set({width:390,height:844})`, reloaded and opened a new tab, but the actual DOM
viewport remained 1280×720. No current reader-feedback mobile screenshots exist.
None of these six captures is mobile evidence. Genuine narrow-viewport
rendering and interaction checks remain necessary before mobile acceptance;
desktop acceptance does not close that gate.

The Impeccable context launcher and single detector attempt failed with
permission denied / exit 126 in the parent workflow. No detector verdict or
QUALITY BAR result is claimed. The launcher was not repaired or rerun by this
documentation pass.

The pre-existing shared review `Notice` danger-token drift remains out of
scope: its `border-danger/30` / `bg-danger/5` usage is not promoted to a new
design token or repaired here. Error, stale, closed, suggestion application,
keyboard and assistive-technology paths were inspected only where described in
source; no dedicated capture or new interaction test for those paths is claimed.

Current local source candidate CLI **0.4.21 is unpublished**. Deployed CLI
**0.4.20** and the deployed server remain unchanged. This design documentation
does not establish deployment, production validation, complete GitHub parity,
release approval or readiness.

## Persistence

This pass writes only
[pull-review.md](../../.impeccable/surfaces/pull-review.md) and this validation
record. `PRODUCT.md`, `DESIGN.md`, `.impeccable/design.json`, runtime source,
tests, captures and unrelated content are preserved. Existing global design
artifacts remain the source of visual tokens and shared component guidance.
