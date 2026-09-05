---
name: a-carried-track-is-a-term-of-the-size-target
description: An engine that copies a track past the encoder owes that track's bitrate to the size target, or the capable browser is the one that overshoots
type: gotcha
date: 2026-09-05
---

`bitrateForTargetSize` (`lib/engines/video-compression.ts`) computes
`budgetBits - audioBitrate * durationSeconds`. Whatever an engine writes into
the output *without* passing it through the encoder is that `audioBitrate`
term, and an engine that forgets to declare it does not fail — it produces a
file over the size the user typed, quietly.

`TARGET_SIZE_HEADROOM` does not absorb it. The 3% is the container's sample
table and headers; a 128 kbps soundtrack on a three-minute clip is ~2.9 MB,
which against an 8 MB target is a 36% overshoot.

## Why it is easy to get wrong

The parameter is not adjacent to the copy. `planVideoEncode`
(`lib/engines/video-config.ts`) is called near the top of a transcode, before
the muxer call that carries the track is even in view, and it defaults
`audioBitrate` to `0` so that a caller carrying nothing owes nothing. #268
added the audio stream copy to `lib/engines/video-transcode.ts` and left the
`0` behind under a comment that had just become false — the picture was
correct and the promise was not.

The failure lands the wrong way round: `ffmpeg-args.ts` has always computed a
real `audioBitrate`, so a browser with no WebCodecs produced a correct size and
a browser *with* hardware encoding produced an oversized one. A regression that
only appears on the better device is one no casual test finds.

## The measurement

`sourceBitrate(timescale, samples)` in `video-config.ts` weighs the samples
themselves rather than reading a rate out of the track. An `esds` written by one
tool and re-muxed by another keeps whatever the first one claimed, so the header
can describe an encode the file no longer contains. It is only ever an average,
which is all the arithmetic needs.

Related: [[budget-is-affine-and-scoped]], [[stream-copy-outranks-both-codecs]],
[[webcodecs-over-ffmpeg]]
