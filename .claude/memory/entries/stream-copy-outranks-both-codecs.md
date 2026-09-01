---
name: stream-copy-outranks-both-codecs
description: A stream copy is its own engine at priority 12, ahead of WebCodecs and ffmpeg — and the webcodecs budget it is compared against is not trustworthy
type: decision
date: 2026-09-01
---

`remux` (`lib/engines/remux.ts`, `priority: 12`) is a separate engine rather than
a branch inside `webcodecs`, and it outranks both codec engines for the pairs it
claims: `mp4`/`mov` into `m4a` as an `extract`, and `mp4` <-> `mov` as a
`convert`.

Two reasons it could not live inside `webcodecs`, neither of them stylistic:

- **It needs no capability at all.** Nothing in the path touches `VideoEncoder`,
  `AudioEncoder` or a WASM codec, so a browser with no WebCodecs still extracts
  audio and still changes a container. Gating it behind `caps.webCodecsAudio` —
  which is what living inside that descriptor would mean — refuses a job that has
  no codec in it.
- **Its memory shape is unrelated.** Nothing is decoded, so there is no frame and
  no bitmap, which is a different row in `MEMORY` rather than a different case in
  the same one.

## Why it claims so little

It claims `convert` and `extract` and nothing else, and only `m4a` on the audio
side. `compress` and `resize` arrive from a settings panel carrying a target
size, a quality or a width, and a copy honours none of them — claiming either
would silently discard what the user chose. `mp3`, `wav`, `flac` and `ogg` need
an encoder; `aac` would mean synthesising an ADTS header per frame out of the
`esds`, which is an encode in all but name. A `convert` whose source and target
are the same format is excluded too: there is no container to change, so the job
means something else.

## The comparison that is not sound

`MEMORY.remux` is `factor: 3`, derived from the three copies of the payload that
are live at the peak. Against `ffmpeg` (4.5) that is a 400 MB ceiling versus
266 MB on an 8 GB desktop. Against `webcodecs` (2.5) it looks *worse* — and that
comparison should not be trusted, because `MEMORY.webcodecs` still carries its
pre-implementation comment ("no engine ships yet... never holds the whole file")
while the engine that shipped in #47 holds every demuxed sample and every encoded
sample at once. 2.5 is an unsafe estimate, not a conservative one. Filed as
issue #210; do not use it as a baseline for anything until it is re-measured.

Related: [[webcodecs-over-ffmpeg]], [[budget-is-affine-and-scoped]],
[[router-gates-before-budget]]
