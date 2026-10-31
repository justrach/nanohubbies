# Branch rename design validation

This is a local Operate extension of the approved Harness Paper/Graphite repository UI, not a new design world. The authority is [selected design](../design-variations/2026-10-26/selected-design.md), [branch surface contract](../../.impeccable/surfaces/branches.md), `apps/web/src/design-system.css` and `apps/web/src/trunk/workspace.css`. The runtime UI is in `BranchRename.tsx`, `Branches.tsx` and `ProtectionActivity.tsx` under `apps/web/src/trunk/review/`.

## Design evidence

The finish reviewer reported direct inspection of all nine local captures below at desktop width 1280 and mobile 390×844, with no material UI finding. Its remaining documentation finding was the absent root PRODUCT.md. This documenter inspected source styles/components and records that supplied visual review; it did not run a new browser session or independently repeat functional tests.

After documentation was written, the same reviewer scored the sole persistence
fix resolved and returned **ship** for that documentation verdict pass. The
earlier UI review remains its visual evidence; no detector verdict is inferred.

| Capture in `.impeccable/review/` | State |
| --- | --- |
| `branch-rename-desktop.png` | Paper desktop rename flow |
| `branch-rename-mobile.png` | Paper mobile rename flow |
| `branch-rename-dark-desktop.png` | Graphite desktop rename flow |
| `branch-rename-dark-mobile.png` | Graphite mobile rename flow |
| `branch-rename-error-desktop.png` | Error feedback |
| `branch-rename-stale-desktop.png` | Stale preview rejection |
| `branch-rename-uncertain-mobile.png` | Uncertain write requiring inspection |
| `branch-rename-success-desktop.png` | Confirmed desktop rename |
| `branch-rename-success-mobile.png` | Confirmed mobile rename |

The implementation reuses shared theme variables, Geist/Geist Mono, existing branch rows and controls. The full-width inline form uses existing dividers and wraps its actions. Browser checks supplied by the implementation owner cover both themes and widths, no horizontal overflow at 390px, retained input after stale rejection, a fresh required preview, Escape restoring the row trigger, and an actual successful rename with a focused status notice. No image comp exists for this extension; these captures are local review evidence, not generated raster assets or shipping artwork.

## Functional validation scope

The implementation owner reports 435 API unit cases, 98 CLI cases, the pinned tsrs check (two typed tasks fresh, one cached), a fresh workspace build and the full local real Worker/Git repository chain passing. Source and portable-bundle branch rename integration cover roles/scopes/revocation, locks, protected/default names, SQL ABA/CAS/rollback, stale races, PR close/retarget, original-pusher review independence, old RPC receivers, lost acknowledgement, aliases, archive/restart and clone/fsck. These are supplied implementation results, not new checks performed by this documentation pass.

One earlier Wrangler ProxyWorker attempt lost its network connection and returned 500. The uncertain UI was retained, state was inspected, and no automatic replay occurred. A separate later rename and fresh current preview succeeded. The underlying proxy failure remains unexplained; the first attempt is not counted as a successful rename.

## Persistence and limits

Root [PRODUCT.md](../../PRODUCT.md) now records confirmed product facts and candidate/release boundaries. [DESIGN.md](../../DESIGN.md) and [design.json](../../.impeccable/design.json) capture the incumbent workspace tokens, geometry and sampled components. No runtime source, test, package or global design-token file was changed by this documentation pass. The sidecar's synthesized color ramps are preview metadata only.

The Impeccable context and detector launchers failed with permission denied in the parent workflow. They were not repaired; no detector verdict or QUALITY BAR result is claimed. This turn did not perform production branch mutation, deployment, new hosted fleet activation or cloud validation of branch rename. Published CLI remains 0.4.19; local 0.4.20 remains an undeployed candidate. These results establish neither full GitHub parity nor production readiness.

Source drift not canonized or repaired: shared review `Notice` uses `border-danger/30` and `bg-danger/5`, but `apps/web/src/styles.css` exposes no `danger` theme binding. The existing critical/serious tokens remain authoritative. The rendered error capture was reviewed without a material visual finding; this source mismatch is not promoted into a new design rule. No new fonts, palette, shadows, imagery, workflow default or visual identity was introduced.
