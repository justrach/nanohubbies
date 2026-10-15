# OpenSourceUI controls

Source: https://github.com/bidyut10/opensourceui

Upstream commit: e4703843b45513c21304253558853a550b986dbe

Copied and adapted under the MIT license (see LICENSE):

- components/inputs/text-field-input.tsx
- components/buttons/depth-outline-button.tsx
- components/buttons/segmented-toggle-button.tsx

Adaptations: nanohub semantic color tokens, compact sizes, reduced depth, optional input labels, controlled segmented value, and accessible pressed-button group behavior. Shared Button and Input wrappers integrate these controls into existing callers.

Room controls also adapt `components/inputs/select-field-input.tsx` and
`components/inputs/textarea-field-input.tsx` at the same pinned revision.
Colors use nanohub tokens; motion respects reduced-motion preferences.
