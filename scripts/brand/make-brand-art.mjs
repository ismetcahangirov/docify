#!/usr/bin/env node
/**
 * The brush artwork — `pnpm brand:art`.
 *
 * Two files come out of this script and both are committed:
 *
 * - `public/brand/brush-mark.svg`, the alpha mask the wordmark's paint is cut
 *   to (see components/site/wordmark.tsx),
 * - `app/icon.svg`, the same mark as the site icon: the brush, the frame and
 *   the D, drawn rather than masked because a favicon has no stylesheet to
 *   take a colour or a font from.
 *
 * Why generate rather than hand-draw: the torn edges, the bristle drags and the
 * splatter are several hundred coordinates. Written by hand they would be
 * unreviewable and unrepeatable; written by a seeded generator, a change to the
 * mark is a change to the numbers at the top of this file, and running it again
 * produces exactly the same bytes.
 *
 * The icon's three colours are read out of the `@theme` block of
 * app/globals.css at generation time, so the palette still lives in one place —
 * `test/app/icon.test.ts` asserts the file that was committed still agrees with
 * it. Nothing here is imported by the app at runtime.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

/** Deterministic PRNG — the same seed has to give the same artwork forever. */
function seeded(seed) {
  return function random() {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A closed, ragged loop: radial points with jitter, and a longer spike every
 * few steps. Straight segments between them on purpose — a brush edge is torn,
 * not smooth, and a curve through these points would sand that off.
 */
function blob(rand, { cx, cy, rx, ry, points, jitter, spikeEvery, spike }) {
  const pts = []
  for (let i = 0; i < points; i += 1) {
    const angle = (i / points) * Math.PI * 2
    let k = 1 - jitter / 2 + rand() * jitter
    if (spikeEvery && i % spikeEvery === 0) k = spike + rand() * 0.18
    pts.push([cx + Math.cos(angle) * rx * k, cy + Math.sin(angle) * ry * k])
  }
  return `M${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L')} Z`
}

/** A tapered streak — the drag of the bristles leaving the mass. */
function streak(rand, { x, y, len, thick, angle }) {
  const radians = (angle * Math.PI) / 180
  const dx = Math.cos(radians)
  const dy = Math.sin(radians)
  const steps = 10
  const side = (sign) => {
    const pts = []
    for (let i = 0; i <= steps; i += 1) {
      const t = sign > 0 ? i / steps : (steps - i) / steps
      const w = thick * (1 - t) * (0.55 + rand() * 0.75) * sign
      pts.push([x + dx * len * t - dy * w, y + dy * len * t + dx * w])
    }
    return pts
  }
  const pts = [...side(1), ...side(-1)]
  return `M${pts.map(([px, py]) => `${px.toFixed(1)} ${py.toFixed(1)}`).join(' L')} Z`
}

/** The mark, drawn into a 200x200 box: the mass, two tears, six drags, twelve flecks. */
function brushPaths(rand) {
  const parts = [
    blob(rand, {
      cx: 96,
      cy: 100,
      rx: 74,
      ry: 70,
      points: 34,
      jitter: 0.3,
      spikeEvery: 5,
      spike: 1.06,
    }),
    blob(rand, {
      cx: 128,
      cy: 78,
      rx: 48,
      ry: 40,
      points: 24,
      jitter: 0.42,
      spikeEvery: 4,
      spike: 1.1,
    }),
    blob(rand, {
      cx: 70,
      cy: 130,
      rx: 46,
      ry: 38,
      points: 24,
      jitter: 0.44,
      spikeEvery: 4,
      spike: 1.12,
    }),
  ]

  for (const drag of [
    { x: 150, y: 92, len: 46, thick: 7, angle: -12 },
    { x: 156, y: 118, len: 38, thick: 5, angle: 16 },
    { x: 44, y: 78, len: 40, thick: 6, angle: 196 },
    { x: 52, y: 140, len: 32, thick: 4, angle: 158 },
    { x: 104, y: 34, len: 30, thick: 5, angle: -76 },
    { x: 88, y: 168, len: 28, thick: 4, angle: 96 },
  ]) {
    parts.push(streak(rand, drag))
  }

  for (const [x, y, r] of [
    [182, 62, 5.2],
    [190, 104, 3.4],
    [176, 146, 4.6],
    [160, 176, 3.0],
    [24, 58, 4.4],
    [12, 104, 3.2],
    [30, 168, 4.0],
    [64, 186, 2.8],
    [118, 14, 3.6],
    [72, 16, 2.6],
    [142, 190, 3.4],
    [8, 140, 2.4],
  ]) {
    parts.push(
      blob(rand, { cx: x, cy: y, rx: r, ry: r * (0.7 + rand() * 0.6), points: 9, jitter: 0.5 }),
    )
  }

  return parts
}

/** One `--color-*` token, read from the `@theme` block of app/globals.css. */
function token(name) {
  const css = readFileSync('app/globals.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const match = css.match(new RegExp(`--color-${name}\s*:\s*([^;]+);`))
  if (!match) throw new Error(`app/globals.css declares no --color-${name}`)
  return match[1].trim()
}

const MASK = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">',
  '<title>Brush mark</title>',
  `<path fill="black" d="${brushPaths(seeded(20260912)).join(' ')}"/>`,
  '</svg>',
].join('')

/*
 * The icon, at 64: the same mark the site header carries, drawn rather than
 * masked — same paint, same frame, same near-black letter, so the tab and the
 * page are recognisably one thing.
 *
 * The one part that is not the header's is the ground. The header's mark sits
 * on the page's own `shell`, which in a tab strip or on a home screen is just
 * a pale tile that disappears into whatever chrome surrounds it. The icon
 * takes `ink` instead: the mark reads as itself against a browser's light or
 * dark chrome, and the white frame is a line rather than a suggestion. The
 * letter stays near-black — it is surrounded by paint on every side, and
 * near-black on the brush is 5.5:1 where the reference's white would be 3.5:1.
 *
 * The letter is a path because a favicon is rendered without the page's
 * stylesheet: an Archivo `D` set as text would come out in whatever face the
 * browser had to hand, at the one size where that is most obvious. Its counter
 * is punched with `evenodd` rather than filled in the ground colour, so the
 * letter survives a browser that composites the icon over something else.
 *
 * The proportions are the header's, measured rather than guessed: the splash
 * is a fifth wider than the frame, the cap height is the frame's 0.57, and the
 * badge is turned the same four degrees. What does *not* come from the header
 * is how much of the tile the mark fills — a wordmark sits in a line of type
 * with air around it, an icon is read at 16px and any ground it does not need
 * is detail thrown away. So the badge is scaled until the splash nearly meets
 * the edges, and the rotated frame's corners clear them by half a pixel.
 */
const ICON = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">',
  '<title>Docify</title>',
  `<rect width="64" height="64" fill="${token('ink')}"/>`,
  '<g transform="translate(32 32) scale(0.305) translate(-100 -100)">',
  `<path fill="${token('brush')}" d="${brushPaths(seeded(20260912)).join(' ')}"/>`,
  '</g>',
  `<rect x="6.5" y="6.5" width="51" height="51" fill="none" stroke="${token('fg-dark')}" stroke-width="2.6" transform="rotate(-4 32 32)"/>`,
  `<path fill="${token('fg-light')}" fill-rule="evenodd" transform="rotate(-4 32 32)" d="M18.2 17.5 H30.9 A14.5 14.5 0 0 1 30.9 46.5 H18.2 Z M25.4 24.1 H30.9 A7.9 7.9 0 0 1 30.9 39.9 H25.4 Z"/>`,
  '</svg>',
].join('')

mkdirSync('public/brand', { recursive: true })
writeFileSync('public/brand/brush-mark.svg', `${MASK}\n`)
writeFileSync('app/icon.svg', `${ICON}\n`)
console.log(
  `brand: public/brand/brush-mark.svg (${MASK.length} B), app/icon.svg (${ICON.length} B)`,
)
