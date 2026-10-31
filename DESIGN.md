---
name: Nanohub Harness Paper and Graphite
description: Incumbent compact repository workspace
colors:
  paper-brand: "#8d5615"
  paper-action: "#c77d20"
  paper-page: "#faf8f3"
  paper-surface: "#faf8f3"
  paper-raised: "#e7e1d5"
  paper-ink: "#1a1813"
  paper-ink-2: "#514c40"
  paper-muted: "#6b6557"
  paper-line: "#d9d3c7"
  paper-wash: "#f0ece3"
  paper-good-text: "#486537"
  paper-warning: "#9a6e1b"
  paper-critical: "#b14228"
  graphite-brand: "#e8a33d"
  graphite-action: "#e8a33d"
  graphite-page: "#16140f"
  graphite-surface: "#1f1c16"
  graphite-raised: "#2a261e"
  graphite-ink: "#edeae2"
  graphite-ink-2: "#c6bfae"
  graphite-muted: "#9a9384"
  graphite-line: "#3d382e"
  graphite-wash: "#1f1c16"
  graphite-good-text: "#7fa86b"
  graphite-warning: "#d9a441"
  graphite-critical: "#d2674f"
typography:
  body:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "14px"
  label:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "12px"
  control:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
  title:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    letterSpacing: "-0.025em"
  shared-title:
    fontSize: "24px"
    letterSpacing: "-0.035em"
  identifier:
    fontFamily: "Geist Mono, ui-monospace, SF Mono, monospace"
    fontSize: "11px"
rounded:
  control: "6px"
  panel: "8px"
  badge: "20px"
spacing:
  unit: "4px"
  compact-gap: "8px"
  row-gap: "12px"
  section: "16px"
  form: "24px"
  page: "32px"
components:
  button-primary-paper:
    backgroundColor: "{colors.paper-action}"
    textColor: "{colors.paper-ink}"
    rounded: "{rounded.control}"
    typography: "{typography.control}"
  button-primary-graphite:
    backgroundColor: "{colors.graphite-action}"
    textColor: "{colors.graphite-page}"
    rounded: "{rounded.control}"
    typography: "{typography.control}"
  repository-card-paper:
    backgroundColor: "{colors.paper-surface}"
    rounded: "{rounded.panel}"
  repository-card-graphite:
    backgroundColor: "{colors.graphite-surface}"
    rounded: "{rounded.panel}"
---

# Design System: Nanohub

## Overview

**Creative North Star: "Harness Paper/Graphite"**

Harness Paper/Graphite is the approved incumbent repository world: warm cream or charcoal surfaces, dark or pale ink, amber actions and compact Geist text. This record captures the built repository workspace; it introduces no new visual direction.

Shared top navigation, bordered lists and modestly rounded controls keep code and repository state prominent. Branch administration extends the existing rows inline. The approved direction is recorded in `docs/design-variations/2026-10-26/selected-design.md`; the source remains authoritative for implementation.

**Key Characteristics:**

- Warm Paper/Graphite themes with amber actions.
- Compact Geist interface text and Geist Mono identifiers.
- Flat panels, visible dividers and shared top navigation.

## Colors

The frontmatter records the workspace's reused light and dark values from `apps/web/src/design-system.css`; theme suffixes identify modes, not additional accents. Runtime components use the original CSS variables so theme switching remains shared.

**The Shared Theme Rule.** Reuse the shared theme variables for local repository extensions.

### Primary

Warm amber distinguishes primary actions. The brand amber is darker for small links in Paper; Graphite uses a brighter amber for both. Use `--action` with `--action-ink` for filled controls, and `--series-1` / `--brand` for branch links and focus accents.

### Neutral

Paper uses a cream page and surface, warm raised areas and muted brown-gray borders. Graphite separates its charcoal page, surface and raised layers. Ink, secondary ink and muted text carry the content hierarchy; line and wash define boundaries and grouped areas.

### Status

Good-text, warning and critical values are semantic feedback colors. Status must remain intelligible through its text and icon/label, not color alone. Other categorical chart colors are outside this workspace token extract.

## Typography

Geist and Geist Mono are local variable fonts loaded in `apps/web/app/layout.tsx`; their runtime stacks are bound in `apps/web/src/styles.css`. Body, labels and controls follow the frontmatter. Branch headings use the title role; repository identity is locally larger (22px desktop, 18px below 900px). The shared title token is recorded separately from these local headings.

Branch names use interface text; commit IDs use the mono identifier role. Rename explanation text is 13px with 1.55 line height and a 70ch maximum. Avoid scaling a compact repository page as a marketing display.

## Layout

The shared repository header runs across the top. Desktop topbar is at least 64px tall with 12px 32px padding; repository identity uses 20px 32px 18px. Tabs remain horizontal and scroll within their own row. Main workspace content has a 1280px maximum and 32px 32px 48px padding.

Branch and rules pages narrow to 1120px, centered with 24px 20px 40px padding. Branch rows have a 52px minimum height, 12px 16px padding and a 12px gap. Names wrap anywhere. Inline rename occupies the full row width, with 12px gaps, a top divider, a 480px maximum field width and wrapping actions.

Below 900px, global links and quick actions hide. At 640px and below, the topbar has a 56px minimum and 12px 16px padding; the wordmark hides and main padding becomes 20px 16px 40px. At 440px and below, branch-page padding is 20px 16px 32px, creation fields stack and branch rows use 12px padding with 8px gaps. Code-page aside content stacks below 1023px; the Actions layout has its own 800px breakpoint. These are surface-specific breakpoints, not a single universal grid.

## Elevation & Depth

Ordinary cards and workspace buttons have no shadow. Surface/wash/raised layers and thin borders provide structure. The repository overflow menu is an exception: an anchored overlay with a `0 8px 24px #0002` shadow and z-index 40. Do not generalize that shadow to content panels.

**The Flat Panel Rule.** Ordinary repository panels remain shadowless; anchored overlays may use their existing elevation.

Shared controls transition quickly through the source duration token; the underlying button also carries a custom easing and reduced-motion handling. The existing navigation-pending indicator has its own long progress transition. These are separate interaction roles.

## Shapes

Controls and branch lists use the control radius; cards and dialogs use the panel radius. Visibility and count badges are pill-shaped. Most boundaries are one-pixel lines. The existing brand mark has its own 22% radius; do not apply its silhouette to ordinary containers.

## Components

### Buttons

Primary buttons use amber with dark text, secondary buttons use the workspace wash and line border, and ghost actions remain transparent until hover. Workspace controls have a 32px minimum height and 13px text. Small buttons retain 8px horizontal padding, medium 12px and large 16px. Primary hover mixes action color at 92% with ink; active uses 85%. Preserve source focus outlines/rings, disabled behavior and reduced-motion handling.

### Inputs / Fields

Review fields use a surface background, line border and control radius; rename fields are 34px tall. Focus uses the amber border. Branch search has 31px left padding for its icon and a 420px maximum width. Keep a visible label or the existing screen-reader label.

### Cards / Containers

Shared cards use a surface fill, thin line border and panel radius. Branch lists use the smaller control radius with dividers between rows. Protection panels use a wash header, 16px padding, a compact title and muted explanation. Padding belongs to the specific container; the Card primitive adds none.

### Chips

Repository visibility and tab counts are compact neutral pills. General shared pills use a line border and small secondary text. These identify metadata; they do not replace action buttons.

### Navigation

The shared topbar precedes repository identity and horizontal repository tabs. The current tab uses raised fill, stronger text and an amber icon; Graphite additionally uses a thin amber top rule. Hover adds a subtle ink wash. Overflow links live in an anchored menu. Preserve the approved top navigation arrangement.

### Inline branch rename

A row's quiet Rename action opens a labeled field. Review rename focuses an effects summary; confirmation uses the primary control. Edit name returns focus to the field. Escape/Cancel returns focus to the originating row trigger. Errors retain the entered name; a stale write invalidates the preview and requires another review. An uncertain outcome disables replay and offers Refresh branches. Confirmed success focuses the status notice. These behaviors are part of the branch surface contract, not a global form pattern.

## Do's and Don'ts

### Do:

- **Do** use the shared theme variables in both light and dark modes.
- **Do** preserve compact top navigation and the existing repository component geometry.
- **Do** let long repository and branch names wrap; let action groups wrap on narrow screens.
- **Do** preserve visible focus and explicit review, pending, error and uncertain outcomes.

### Don't:

- **Don't** introduce a rail as the shared repository navigation.
- **Don't** replace the incumbent palette or type pairing for a local extension.
- **Don't** give ordinary repository panels decorative elevation.
- **Don't** represent a pending or uncertain write as confirmed success.
