# Selected design

The approved pair is `01-paper-harness.png` for light mode and
`02-dark-harness.png` for dark mode. The live UI uses the shared top navigation
layout; the rail concept is not applied.

The palette comes from Harness's `codegraff_light` and `codegraff_dark` themes
in `crates/theme/src/builtins.rs`. Shared web tokens live in
`apps/web/src/design-system.css`, with repository geometry in
`apps/web/src/trunk/workspace.css`.

- Paper: cream page, warm neutral borders, filled active tab, amber actions.
- Dark: warm charcoal surfaces, amber active-tab rule and actions.
- Both: Geist and Geist Mono, compact controls, amber folder icons, themed
  three-dot brand mark, README header, and separated About column.
- Light-mode links use darker amber for text contrast. Action labels use dark
  text on the original Harness amber.
- Existing repository routes, access controls, and real data remain in use.
  The clone menu is labeled “Clone”.

Browser verification covered the source view at desktop and narrow widths,
overview, Clone menu, file finder, Actions, settings, and theme switching.
`npm run check -w @swarm/web` (tsrs) and
`npm run build -w @swarm/web` passed. Evidence is in
`docs/evidence/paper-repository-light.png` and `paper-repository-dark.png`.
