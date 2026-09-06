---
name: "webcodecs-over-ffmpeg"
description: "WebCodecs is the primary video path; ffmpeg.wasm is a last-resort fallback"
type: "decision"
date: "2026-08-13"
---

Video work routes to WebCodecs first (`priority: 15`) and only falls back to
ffmpeg.wasm (`priority: 90`) when WebCodecs cannot serve the job.

Why this ordering matters more than it looks:

- ffmpeg.wasm runs roughly 5–10x slower than native ffmpeg and has **no** access
  to hardware encoders. Reported figures: ~40 fps for 720p in WASM versus ~500 fps
  native on the same machine.
- ffmpeg.wasm loads the entire input into MEMFS, so peak memory is several times
  the file size. This is what actually kills mobile tabs.
- WebCodecs uses the device's hardware encoder and streams rather than buffering
  the whole file, which is why its expansion factor is 2.5 versus ffmpeg's 4.5.

The competitive angle: commercial converters gate GPU encoding behind their paid
tiers. Routing to WebCodecs gives every user hardware acceleration for free,
using their own device. This is a product differentiator, not just a perf win.

Gotcha worth remembering: the presence of `globalThis.VideoEncoder` does **not**
mean the codec you want is available. Always await
`VideoEncoder.isConfigSupported(config)` and treat a negative result as
`CODEC_UNAVAILABLE`, which triggers the ffmpeg fallback.

Related: [[no-server-side-processing]], [[ios-memory-ceiling]]
