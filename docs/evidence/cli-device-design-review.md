# CLI browser authorization design review

Scope: the Operate extension at `/cli/authorize`, implemented in `apps/web/src/settings/CliAuthorize.tsx` and its CSS module. This record describes the finished surface; it does not establish a new design system.

## Existing-world consistency

The consent page continues the incumbent Nanohub CLI access UI in `apps/web/src/trunk/connect/CliAccess.tsx`: Paper background, charcoal text, muted warm labels, amber primary action, compact controls, plain dividers, and a flat page. It preserves Geist typography with Geist Mono for terminal code. The shared palette and geometry remain defined in `apps/web/src/design-system.css`; no palette or system change was made.

The first view identifies CLI authorization, the signed-in account, and the terminal code. The request then names the repository, CLI, permissions, and expiry before approval. The existing required-read and optional-permission pattern carries through from CLI credential management.

## Evidence

| Capture | Viewport and observed state |
| --- | --- |
| [Incumbent CLI permissions](cli-production-test-permissions.png) | Production reference for the existing Paper UI and permission controls. |
| [Desktop consent](../../.impeccable/review/desktop.png) | 1280px viewport, full-page capture; optional review permission unchecked, terminal confirmation checked, Authorize enabled. |
| [Mobile consent](../../.impeccable/review/mobile.png) | 320 × 800 viewport, full-page capture; document width 320px. Text and permission labels wrap, with no horizontal overflow. |
| [Denied request](../../.impeccable/review/denied.png) | Denied state replaces consent controls with a clear outcome and credential-management link; focus returns to the page heading. |

The packet records that development sign-in stayed on the consent route, denial ended the request without issuing a credential, and Worker/D1/Bun behavior tests covered approval, scope reduction, denial, expiry, races, and recovery. These are supplied behavior results, separate from this visual documentation pass.

## Review disposition

The finish reviewer accepted persistence, incumbent fidelity, typography, material, ground, and responsiveness. Its sole requested correction was the native blue checkbox/focus treatment. The finished CSS uses the existing `--brand` token for checkbox accents and programmatically focused heading/error outlines; the captures show the warm treatment. That finding is resolved. Recorded verdict: **pass**; disposition: **ship**.

The detector was unavailable: its launcher exited **126** with permission denied. No detector findings or detector pass are claimed; craft review was manual. The black “N” badge in development captures is Next.js development tooling, not production UI. These captures do not establish dark-theme or production consent-page visual verification.

Subsequent hosted consent/denial and final-build recovery checks are recorded
separately in [device validation](cli-device-validation.md). The independent
review disposition above remains scoped to its named captures and corrected
checkbox/focus finding.

`PRODUCT.md` and `DESIGN.md` were absent. No product claims, system documents, sidecar, or private configuration were created or repaired. No incidental styling or pre-existing drift was canonized.
