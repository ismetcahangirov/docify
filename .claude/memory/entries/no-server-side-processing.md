---
name: no-server-side-processing
description: All conversion runs client-side; there is deliberately no processing VM
type: decision
date: 2026-08-13
---

Docify performs every conversion in the user's browser. There is no transcoding
server, and adding one is a decision that would change the product, not an
optimisation.

Alternatives considered and rejected:

- **Server-side workers (the FreeConvert model).** Rejected because it makes the
  cost model bandwidth-bound: every conversion pays upload + download, and abuse
  (someone submitting 10 GB files) must be defended against continuously. It also
  destroys the privacy claim.
- **Hybrid with a small free VM.** Rejected for the initial build. Free tiers in
  2026 are thin — Cloudflare Workers caps CPU per invocation at 10 ms, Fly.io
  removed its free tier, and Oracle's Always Free ARM allocation was halved in
  June 2026. A single free VM would encode roughly one 1080p stream at a time and
  become the bottleneck for the whole product.

Consequences that follow from this decision and must not be quietly eroded:

- No file bytes may cross the network. Only anonymous aggregate metadata does.
- Roughly 70% of the conversion demand (images, PDF structure ops, audio) is
  fully served client-side; the remainder is bounded by device capability, and
  the router must reject honestly rather than degrade silently.
- The privacy claim is structural, not a policy promise — that is the core
  marketing position and competitors cannot copy it without abandoning their
  business model.

Related: [[webcodecs-over-ffmpeg]], [[ios-memory-ceiling]]
