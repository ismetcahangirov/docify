---
name: "libheif-is-primary-broken"
description: "libheif-js 1.19.8 ships a broken is_primary() that throws ReferenceError on every image"
type: "gotcha"
date: "2026-08-14"
---

`HeifImage.is_primary()` is unusable in libheif-js 1.19.8. It throws
`ReferenceError: heif_image_handle_is_primary_image is not defined` for every
image in every file, including files that do flag a primary.

The cause is a one-token typo in the shipped bundle. Every sibling accessor goes
through the module object:

```js
Q.prototype.get_width  = function () { return r.heif_image_handle_get_width(this.handle) }
Q.prototype.get_height = function () { return r.heif_image_handle_get_height(this.handle) }
Q.prototype.is_primary = function () { return !!heif_image_handle_is_primary_image(this.handle) }
//                                              ^ no `r.` — resolves to nothing
```

The C function *is* compiled in, but only as the raw Emscripten export
`r._heif_image_handle_is_primary_image`. That is not part of the package's
supported surface and takes a handle the JS wrapper keeps private, so there is no
clean way to call it. `heif_js_*` exposes no primary accessor either.

`lib/engines/heif-decode.ts` therefore probes rather than assumes: it calls
`is_primary()` inside a `try`, and the first throw ends the search and falls back
to the first top-level image. Two consequences worth knowing:

- A throw cannot be read as "this image is not primary" — it throws for *all*
  images, so treating it per-image would scan the whole list and still land on
  the fallback, just slower.
- The fallback is correct for every HEIC a phone produces, which carries one
  top-level image. It is only a guess for image sequences and collections.

Because it is a probe, this starts selecting properly on its own if upstream
fixes the typo — no code change needed, only the version bump.

Related: [[no-server-side-processing]]
