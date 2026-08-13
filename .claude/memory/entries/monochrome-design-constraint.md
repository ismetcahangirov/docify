---
name: monochrome-design-constraint
description: The palette is monochrome by owner mandate — no blue/purple, no glassmorphism
type: constraint
date: 2026-08-13
---

The visual system is deliberately monochrome and high-contrast, derived from an
editorial/audio-brand reference. Two explicit prohibitions come from the project
owner and are not open to reinterpretation:

1. **No blue or purple**, and especially no blue-to-purple gradient — the default
   "AI product" look the owner wants to avoid entirely.
2. **No glassmorphism** — no `backdrop-filter`, no translucent panels, no
   frosted surfaces. Surfaces are flat fills with a 1px border.

Status colours (`ok #3F7D4E`, `warn #B4762A`, `err #A83A2E`) are intentionally
warm and desaturated. They are functional signals only — never used for buttons,
links, headings or anything decorative. There is no brand accent colour; the
black/white inversion *is* the signature.

Both rules are enforced by a lint rule in `eslint.config.mjs` so they fail CI
rather than relying on review. If a component library ships a default gradient,
shadow or ring, strip it when adding the component.

Related: [[no-server-side-processing]]
