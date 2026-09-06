---
name: "settings-only-where-an-engine-reads-them"
description: "A tool page offers a control only when an engine on that path reads it, which is why the panel is chosen by source and target together rather than by the target's family"
type: "decision"
date: "2026-09-05"
---

`settingsFor(pair)` in `lib/settings/for-pair.ts` decides which panel a conversion page
shows. The obvious rule — switch on `formatMeta(pair.to).kind` — was written into issue #265
and is wrong in four places, each of which produces a control that moves and changes nothing:

- **`mp4 → gif`** has an image target, but the job is ffmpeg's. `paletteFilter` reads a width
  and a frame rate off `VideoOptions`; an image quality or a `keepMetadata` toggle reaches
  no code at all. So a video source into a picture gets its own two-field schema, and not
  the image one and not `VIDEO_COMPRESSION_SCHEMA` (a GIF has no CRF and no bitrate either).
- **`→ wav` and `→ flac`** are lossy-audio targets by family and lossless by fact. PCM and
  FLAC keep every sample, so a bitrate cannot change the file by a byte — the same thing the
  `lossless` flag on `FFMPEG_TARGETS` says on the engine's side. Those pages get no panel.
- **`→ png`, `→ tiff`, `→ bmp`** have no encoder quality, so they get the metadata toggle
  alone.
- **`pdf → jpg`** takes its quality as a fraction (`convertToBlob`), not the 1..100 the rest
  of the panel speaks, so the mapper divides. Reading `pdf-render-plan` rather than assuming
  is what caught that.

The rule the file is built on: **a control that changes nothing is worse than no control**,
because the user gets a slider that moves, a file that does not, and no way to tell which of
the two is broken. `null` — no panel — is the honest answer for a conversion with no
settings, and eleven of the catalogue's pairs get it.

The mapper always reads through `visibleValues`, so a hidden field is not applied; that
argument is `lib/settings/values.ts`'s and is not repeated per schema.

Where the values are read matters too: the converter keeps them in a ref rather than in the
scheduler effect's dependencies, so a slider moved mid-job belongs to the *next* file and the
panel need never be disabled.

Related: [[converter-is-a-deferred-island]], [[stream-copy-outranks-both-codecs]],
[[webcodecs-over-ffmpeg]]
