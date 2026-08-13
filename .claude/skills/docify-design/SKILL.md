---
name: docify-design
description: Use when building or editing any UI in Docify — components, pages, styles, shadcn theming, responsive layout. Defines the monochrome high-contrast design system, the six signature layout patterns, forbidden styles (blue/purple, glassmorphism, shadows), and the responsive contract.
---

# Docify Design System

Monochrome, high-contrast, sectional block layout. An editorial / audio-brand aesthetic — no bright colour, no effects. Typography and contrast do the talking.

## Forbidden — non-negotiable

```
❌ Blue and purple hues, especially blended as gradients
❌ backdrop-filter / backdrop-blur — glassmorphism
❌ Translucent "glass" panels
❌ box-shadow used for float/glow effects
❌ Raw hex codes in CSS — use @theme tokens only
❌ External font or CDN requests
❌ Decorative gradient backgrounds
```

These are blocked in CI by a lint rule in `eslint.config.mjs`.

## Tokens

```
Surfaces    shell #E9E8E4 · paper #F7F7F5 · paper-2 #EFEEEA
            ink #0D0D0D · ink-2 #171717 · ink-3 #1F1F1F
Borders     line-light #DCDBD6 · line-dark #262626
Text        fg-light #0A0A0A / fg-light-mut #6B6A66
            fg-dark  #FAFAF9 / fg-dark-mut  #9B9A96
Status      ok #3F7D4E · warn #B4762A · err #A83A2E   ← functional only
Radius      sm 8 · md 14 · lg 20 · xl 28
```

Status colours are **not brand colours** — use them only for job results, errors and warnings. Never in buttons, links or headings.

## Typography

| Role | Font | Size | Tracking | Leading | Case |
|---|---|---|---|---|---|
| Display / H1 | Archivo 800 | `clamp(2.75rem, 9vw, 6rem)` | `-0.03em` | `0.9` | UPPER |
| H2 | Archivo 700 | `clamp(1.75rem, 4.5vw, 3rem)` | `-0.02em` | `0.95` | UPPER |
| H3 / card | Inter 600 | `1.125rem` | `-0.01em` | `1.3` | Sentence |
| Eyebrow | Inter 500 | `0.75rem` | `0.18em` | `1` | UPPER |
| Body | Inter 400 | `0.9375rem` | `0` | `1.65` | Sentence |
| Stat | Archivo 700 | `2.25rem` | `-0.02em` | `1` | — |
| Technical / size | JetBrains Mono 400 | `0.8125rem` | `0` | `1.4` | — |

All fonts are self-hosted through `next/font/google` — never `<link>` or `@import url()`.

## The six signature patterns

Pages are assembled from these blocks. Before inventing a new pattern, confirm that none of these fits.

### 1. SectionBlock
The page is a stack of alternating light/dark full-width blocks. Each block is `rounded-[28px]` and inset `24px` from the shell background (`12px` on mobile).
```tsx
<SectionBlock variant="dark">…</SectionBlock>
```

### 2. CapabilityStrip
A horizontal row of `icon + title + subtitle` carrying the product's core claims.
Mobile `grid-cols-2` → tablet `grid-cols-3` → desktop `grid-cols-5`.
```
Runs in browser · No sign-up · No limits · Hardware-accelerated · Open source
```

### 3. StatPair
Large figure + small unit on the top line, `12px` muted caption below.
```
0 KB          <2s              100%
sent to       average          processed
a server      processing       in-browser
```

### 4. FeatureCard
`--color-ink-2` background, `1px solid --color-line-dark`, `rounded-[20px]`, `p-6`.
A `44px` circular icon badge on top (`--color-ink-3` background, `20px` line icon), then H3, then two lines of body copy.

### 5. Button
```
primary:   bg-paper text-ink rounded-full px-6 h-11 + ArrowRight icon
secondary: bg-transparent border border-line-dark text-fg-dark rounded-full
ghost:     text only + underline on hover
```
No gradients, no shadows. Hover shifts the fill or border tone.

### 6. Grid overlay
Only in the homepage hero: `1px` grid lines, `--color-line-light`, `opacity: .5`. Do not use it anywhere else.

## Responsive contract

- Test range: **320px → 2560px**
- **No horizontal scroll at any breakpoint**
- Touch targets ≥ `44×44px`
- Display headings use mobile-first `clamp()` — never change font size via media queries
- Tables and long code blocks live in their own `overflow-x-auto` container
- `SectionBlock` inset is `12px` on mobile, `24px` from `sm:` up

## shadcn theming

shadcn components map to the `--color-*` tokens, not to their own `--primary`/`--secondary` variables. After adding a component, **always** strip its default gradient, shadow and ring styles.

## Accessibility

- Contrast: all text meets WCAG 2.2 AA (`fg-dark-mut` on `ink-2` = 5.1:1 ✓)
- Focus indicator: `2px` solid `--color-fg-*` with `2px` offset — bare `outline-none` is forbidden
- Job status changes are announced via `aria-live="polite"`
- Every icon-only button has an `aria-label`
- `prefers-reduced-motion` is respected
