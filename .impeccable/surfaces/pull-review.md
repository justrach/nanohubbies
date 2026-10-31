# Pull review · reader feedback extension

Mode: Operate. Repository members inspect bounded diffs, discuss code and submit
review feedback. This ordinary local extension uses familiar GitHub-style review
actions within the incumbent Harness Paper/Graphite workspace. It introduces no
new visual identity, tokens, fonts, imagery or navigation.

## Direction contract

THESIS: Let readers participate in code review while making the difference
between feedback and merge authority explicit beside the decision and result.

OWN-WORLD: Inherit [DESIGN.md](../../DESIGN.md) and the existing
[design sidecar](../design.json): warm Paper or charcoal Graphite surfaces,
Geist interface text, Geist Mono code and identifiers, amber primary actions,
thin dividers, flat cards and compact shared controls. Preserve the shared top
navigation and all unrelated content. Global design artifacts stay unchanged; PRODUCT.md records the candidate and
deployment boundaries.

STORY: Choose a changed file, select a line/range or chunk, then post one comment
or save it to a private pending review. Finish the review with a summary and
decision. Published reader decisions remain visibly marked as feedback. Reply,
resolve or reopen within current permissions; suggestion application remains a
separate writer action.

FIRST VIEWPORT: Preserve the pull title, branch/protection information, merge
area, reviewer sidebar and PR stack. Continue into the existing Files changed
surface, one file at a time, followed by Reviews. This is an extension of the
existing layout; the supplied captures show desktop and genuine narrow-context
states, including the page top.

FORM: Code-led, bounded review using existing cards, fields, buttons, native
selects and thread components. No concept roll or design-system replacement is
needed. Keep permission explanations adjacent to their actions.

FINISH: The fresh reviewer inspected the seven UI source files, associated CSS
and all seventeen captures and returned **ship**, with no material UI fix. The
narrow-layout gate is closed at 390×640 only. Preserve the earlier recapture
history, unavailable detector result and device-testing limits; this scoped
design verdict is not release approval.

## Permission and feedback contract

| Account or action | Required behavior |
| --- | --- |
| Current repository reader reviewing another author's PR | May comment, reply, save private pending feedback, and submit Comment, Approve or Request changes as feedback. Reader decisions do not satisfy required approvals or block merging as a change request. |
| Required approval | Still requires an independent, currently eligible writer under repository protection rules. The review list explains when write access was removed or cannot be verified. A review request itself grants no approval authority. |
| PR author | Comment only, in both immediate and pending review decisions. Approve and Request changes are disabled; nearby copy explains that another reviewer must decide. |
| Thread resolution | A reader may resolve or reopen a thread they started, not another member's root thread. Broader resolution follows the server-provided `canResolveAll` capability. Replies do not make a reader the root author. |
| Conversation protection | Unresolved review conversations can still block merging, including reader threads and threads on earlier revisions, when repository rules require resolution. This is separate from the reader's decision. |
| Suggestions | Readers may propose a suggestion on after-side code. Applying a suggestion or selecting it for a batch is exposed only with repository mode, commenting permission and the server-provided `canApplySuggestions` capability; application remains writer-only. |
| Reviewer requests | Managers may choose another repository member, including a reader labeled “feedback only.” Management requires `canManage`, an open PR and a writable workspace. Requests ask for feedback; branch protection determines required approvals. |
| CLI review grant | `reviews:write` is labeled “Submit review feedback and inline comments.” Credential scope does not itself confer repository write access or merge authority. |

Server authorization remains authoritative. The UI derives reader status from
`reviewRole`, commenting from the discussion capability plus session/open state,
and suggestion application from its explicit capability. Read-only workspace
state disables writes. Preserve these distinctions rather than treating a
reader as an anonymous visitor or as a writer.

## Interaction and state details

- Review one changed file at a time, with previous/next navigation, a Viewed
  marker, file counts and a full-file link. The diff panel scrolls within a
  bounded height. Hunks initially show 200 rows and reveal more in increments
  of 200; a selected range stays on one side of one hunk and spans at most 201
  lines. Binary or unavailable inline diffs have an explicit fallback message.
- Line-number buttons and “Comment on chunk” open the existing composer.
  “Start a review” / “Add to review” saves private feedback; “Post single
  comment” publishes immediately. After-side selections may insert a suggestion.
  Keep the draft when a request fails, and clear it after successful saving.
- Pending feedback has a count, original path/line context, privacy explanation,
  edit/remove actions, summary, decision and discard confirmation. A changed
  commit/base disables submission and explains how to start on the latest diff;
  a closed PR retains pending feedback privately.
- Published reviews show the decision, “Reader feedback,” inline-comment count
  when present, and the statement that reader feedback does not count toward
  required approvals or block merging as a change request. Submission status
  announces that inline comments are now visible to collaborators.
- Threads preserve their original code context and explicit Resolved/Reopen
  labels. Earlier revisions retain their original commit/base and optional hunk
  excerpt; unresolved threads remain represented in conversation protection.
- Keep source focus targets, named fields, status/alert semantics and busy
  states. The source returns focus to saved comments, review results and thread
  containers. These source behaviors are not a claim of a complete keyboard or
  assistive-technology test.

## Evidence and validation limits

The [design validation record](../../docs/evidence/reader-feedback-design-validation.md)
records the seven UI source files, six 1280×720 desktop captures and eleven
390×640 narrow captures in Paper/Graphite. All captures were visually inspected.
The fresh reviewer's canonical disposition is **ship**, with no material fixes.

**Narrow-layout gate: CLOSED at 390×640 only.** Earlier
`viewport.set({width:390,height:844})`, reload and new-tab attempts left the DOM
viewport at 1280×720, leading to the earlier recapture disposition. The later
evidence uses the unchanged app inside a temporary same-origin HTML parent's
390×640 iframe. Its actual `innerWidth`/`innerHeight` were 390/640, HTML
`scrollWidth` was 390 and the 600px media query matched; the outer browser stayed
1280×720. Native screenshots were clipped to the iframe rectangle without image
resizing or app CSS alteration. The temporary public fixture was removed and a
private reproduction copy and observations retained, as detailed in the record.

Narrow checks exercised reader private saving, publication and own-thread
resolution; reader requests; author Comment-only decisions in both forms and
author publication; and native Tab focus. The corrected inline-composer capture
uses the existing local PR author and the same shared `HunkReview` actions as
the reader. Start a review, Post single comment and Cancel all fit within 390px.
This is genuine narrow browsing-context layout evidence, not iOS/Android device,
touch, virtual-keyboard or comprehensive accessibility QA. Stale, closed, error
and suggestion-application paths remain source-inspected only.

The context launcher and the single detector attempt failed with permission
denied / exit 126. No detector verdict or QUALITY BAR result exists. The shared
`Notice` danger-token drift is pre-existing and outside this extension. At the time of the design documentation pass, CLI 0.4.21 was unpublished.
The later [release acceptance](../../docs/evidence/reader-feedback-release-validation.md)
records its deployment and production smoke separately. This design record
establishes neither overall production readiness nor full GitHub parity.
