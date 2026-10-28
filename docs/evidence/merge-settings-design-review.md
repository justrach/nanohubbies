# Merge settings design review

Date: 2026-10-29. Scope: an ordinary extension of the incumbent repository Settings, pull request merge controls, activity filter and CLI permission copy. This work retains Nanohub's Harness palette and component system while using familiar repository administration patterns. It does not establish a new visual world.

## System comparison

The implementation reuses the source of truth in `apps/web/src/design-system.css`, the Tailwind bindings in `apps/web/src/styles.css`, the local Geist and Geist Mono setup in `apps/web/app/layout.tsx`, and the shared Card, Button and review field patterns. Source and sampled screenshots agree:

| Concern | Incumbent source | Extension outcome |
| --- | --- | --- |
| Palette | Paper page/surface `#faf8f3`, warm ink `#1a1813`; charcoal dark page `#16140f` and surface `#1f1c16` | Existing theme variables supply the card, text, borders and dark mode. |
| Actions | Amber action `#c77d20` in light mode and `#e8a33d` in dark mode; darker amber link token in light mode | Save and merge use shared primary buttons; explanatory links use existing series color. |
| Typography | Geist interface text, Geist Mono for identifiers; shared body token 14px, label 12px, title 24px | Local section titles use 18px semibold, labels/help use 14px. No new font is introduced. |
| Geometry and depth | 8px panel radius, 6px control radius, line borders and `--shadow-panel: none` | New Settings card remains a flat bordered Card with normal padding and vertical flow. |
| Responsive behavior | Compact desktop workspace; existing native fields and shared buttons | `MergeControls.module.css` scopes 44px minimum controls and 16px native input text below 640px; desktop compact sizing resumes above that breakpoint. These are local accessibility accommodations rather than replacement global tokens. |

Observed local rules: reuse semantic theme tokens; maintain a single clear save action per Settings card; keep explanatory text with its control; use native checkboxes and select controls. These observations describe this extension and do not add new system-wide prohibitions.

## Interaction and content evidence

`RepositoryMergeSettings.tsx` is placed immediately after Default branch in `Collaborators.tsx`. The form lists four allowed methods and a default drawn only from the enabled methods. Unchecking the selected default chooses an enabled fallback; an empty allowed list gives inline guidance and prevents save. Readers receive an allowed/default summary. Save feedback distinguishes the saved default from the draft, and errors receive programmatic focus with an explicit reload action available. Snapshot mode omits the card.

`MergeAction.tsx`, `merge-choices.ts` and `PullDetail.tsx` share method names and descriptions, use the repository default when available, and explain when repository/branch rules leave no suitable method. The selected revision keys the controls; role denial has an explicit sentence. Optional commit messages remain behind a native disclosure. CLI authorization and scope labels describe merge settings administration as a current repository admin capability using the existing authorization layout.

`ProtectionActivity.tsx` includes merge setting events under the existing `settings` activity kind. The visible filter now reads **Repository settings**, covering both default branch and merge settings changes.

## Review disposition and limits

The delegated full visual review covered this extension and returned a **fix** disposition for one history-filter label mismatch. The subsequent one-line correction renamed the visible filter to **Repository settings**. The follow-up review returned **ship**, with that finding resolved. This ship verdict applies to the supplied fix list and its visual evidence; it is not a new full application review or production validation. Backend, protocol and test evidence are recorded separately by the implementation owner.

The detector was run once on the target scope and returned `[]`, as reported by the review workflow. This report did not rerun the detector or broaden that result into a whole-project claim.

All screenshots are synthetic local review evidence, originally captured under `.impeccable/review/merge-settings/` and retained byte-for-byte in [merge-settings/](merge-settings/); they are not product raster assets. The supplied set comprises `desktop.png`, `mobile.png`, `desktop-panel.png`, `mobile-panel.png`, `pr-mobile.png`, `pr-dark.png`, `stale-edit.png`, `pr-unavailable.png`, `reader-settings.png`, `pr-reader.png`, `activity-desktop.png`, `activity-panel.png` and `activity-mobile.png`. This documentation pass directly inspected the desktop/mobile panel crops, dark PR, stale edit, unavailable-method PR, reader Settings, reader PR and corrected activity panel. The remaining captures are retained as supporting review evidence. No new browser session, test run or production access was performed for this documentation pass.

## Documentation outcome and inherited drift

No `PRODUCT.md`, `DESIGN.md` or `.impeccable/design.json` existed at the project/app roots before this work. Their absence is inherited documentation drift. The coherent incumbent CSS and components remain the source of truth. The documenter role explicitly preserves the system during ordinary extensions and reports pre-existing drift rather than repairing it unasked; this pass therefore creates only this narrow evidence report. It does not invent product positioning, a new named visual world, token sidecars or global design rules.

No inherited visual defect or documentation gap was canonized into a design rule. Existing compact controls outside the scoped merge form and unrelated inherited screen content remain outside this extension's documentation and fix verdict.
