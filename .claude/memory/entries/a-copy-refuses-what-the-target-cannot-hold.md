---
name: "a-copy-refuses-what-the-target-cannot-hold"
description: "The codec check for a stream copy lives in the engine, not the router — the router has a format pair and a size and cannot see inside the file"
type: "decision"
date: "2026-09-05"
---

`route(task, bytes, caps)` decides on a format pair, a byte count and a
capability probe. None of those says what codec is inside the file, so
`/convert/mp4-to-m4a` sends an AC-3 television capture down the `remux` path
exactly as it sends an ordinary AAC one. The engine is the first place that
knows and the last place that can say so, which is why
`lib/engines/mp4-remux.ts` carries `RemuxOptions.audioMustBeAac` and the
sentence that goes with it rather than the router carrying a rule.

## Why the flag is on the extraction and not on the engine

An extraction and a container change make different promises. `mp4 -> m4a`
promises a file that is an M4A, and an M4A is AAC by convention — one labelled
`audio/mp4` holding Dolby Digital is a file most decoders refuse, so "the copy
succeeded" would be a lie told in a file the user cannot play. `mov -> mp4`
promises the box and never the codec: an AC-3 MOV becoming an AC-3 MP4 is
exactly right, and a ProRes MOV becoming a ProRes MP4 is too.

So the guard is a term of the *job*, set by `lib/engines/remux.ts` from
`extracting`, and not a property of the engine.

## The silent half of the same bug

A missing entry in `CONFIGURATION_BOXES` (`lib/engines/mp4-demux.ts`) is not a
warning, it is data loss: the track comes back with `description: undefined`,
the muxer writes a sample entry with nothing inside it, and the output parses
and does not play. `dac3`, `dec3`, `alac` and `dmlp` were missing until #277.
Anything added to the sample-entry vocabulary owes an entry there.

Related: [[stream-copy-outranks-both-codecs]],
[[a-carried-track-is-a-term-of-the-size-target]], [[router-gates-before-budget]]
