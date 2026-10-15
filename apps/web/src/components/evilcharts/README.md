# EvilCharts source attribution

Focused adaptation of EvilCharts' MIT-licensed Recharts registry, copyright
2026 Gurbinder. Full license: `LICENSE`.

Upstream revision: `ecbd6a5db7b25f9a7e070c02b2ef728c378eeb5c`.

Sources:

- https://github.com/legions-developer/evilcharts/blob/ecbd6a5db7b25f9a7e070c02b2ef728c378eeb5c/src/registry/charts/recharts-area-chart.tsx
- https://github.com/legions-developer/evilcharts/blob/ecbd6a5db7b25f9a7e070c02b2ef728c378eeb5c/src/registry/charts/recharts-bar-chart.tsx

`GradientPattern` retains the upstream vertical fade gradient, mask, pattern
and color-gradient structure. Color is supplied as a prop instead of shared
configuration context; opacity is reduced for the live console. Unique IDs
scope the pattern to each series and instance. Area/bar compositions retain
the horizontal dashed grid and axis defaults. Bars use solid fills for clear
comparisons at small sizes.

This is an adapted source component, not the full compound registry API.
Brush, loading, selection and reveal-mask animation features are omitted;
live updates render without animation. Consumers preserve existing data,
measurement caveats, missing measurements, and table alternatives.
