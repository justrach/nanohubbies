# Requested reviewers design validation

Reviewed 2026-10-31: `apps/web/src/trunk/review/RequestedReviewers.tsx` and its `PullDetail.tsx` integration. Disposition: ship the ordinary Operate-mode extension; no material visual fixes identified within the evidence below.

The panel follows the incumbent Harness paper/charcoal system in `apps/web/src/design-system.css`, reusing `Card`, `Button`, the review `field` styles, and Lucide icons. It adds no palette, typography, component variant, or durable design-system rule. Its bordered surface, compact type, quiet controls, and spacing match adjacent pull-request controls. The desktop integration uses a 320px details column; mobile stacks the panel above PR stack. The inspected captures show readable wrapping and contained controls in both themes.

Visual evidence is retained under [review-requests/](review-requests/):

| Captures | Viewport | Rendered evidence |
| --- | --- | --- |
| `desktop.png`, `desktop-dark.png` | 1280 × 900 | Waiting requests; all eligible writers already requested; disabled request action; adjacent merge controls |
| `mobile.png`, `mobile-dark.png` | 390 × 844 | Waiting requests; all-writers-requested message; stacked reviewers and PR stack |
| `mobile-form.png`, `mobile-form-dark.png` | 390 × 844 | Waiting request plus request form, visible label/select/helper text, disabled empty submit and Cancel |

The supplied capture provenance is a synthetic pull request served through real local Next/Miniflare, without production bindings. This pass inspected those saved captures and current source; it did not run a new browser session.

Other states were source-inspected, not rendered: loading, no requests, submitted review and review link, eligibility unavailable/lost, no other writers, account-ID input fallback, errors and refresh/conflict messages, saving, request-again, permission/read-only/closed restrictions, request limit, and long-list overflow. Label association, status/alert roles, descriptive removal labels, shared focus styling, and identifier wrapping are present in source; this note does not claim interactive accessibility testing or rendered coverage of those states.

`PRODUCT.md` and `DESIGN.md` are absent and were intentionally left absent. The session's context launcher permission failure was handled by inspecting the existing CSS and shared components directly. The document workflow reference was read; this evidence note records an ordinary extension without generating global design artifacts. No source, product, skill configuration, or other files were changed by this documentation pass. This is visual/source evidence, not a runtime, security, production deployment, or full GitHub-parity certification.
