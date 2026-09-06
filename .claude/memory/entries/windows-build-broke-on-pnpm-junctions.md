---
name: "windows-build-broke-on-pnpm-junctions"
description: "The Windows build crash was never about Node — pnpm's junctions make webpack resolve a path that does not exist, and its timestamp-and-hash snapshot turns that into a hash of undefined"
type: "gotcha"
date: "2026-09-06"
---

`pnpm build` failed on the Windows development machine, on clean `main`, before
it emitted a single route:

```
TypeError: Cannot read properties of undefined (reading 'length')
    at WasmHash._updateWithBuffer (next/dist/compiled/webpack/bundle5.js:...)
    at BatchedHash.update
Next.js build worker exited with code: 1 and signal: null
```

It was blamed on Node 24 for a month, then on "the platform" when the same stack
appeared on Node 22.23.2. Both were wrong, and the WebAssembly hasher in the
stack is a bystander: it was handed `undefined`.

## The actual chain

1. pnpm links each package into `node_modules/` as an NTFS **junction** on
   Windows, and `fs.readlink()` on a junction returns an **absolute** target.
   On Linux pnpm writes a *relative* symlink.
2. webpack's `lstatReadlinkAbsolute` resolves a link with
   `join(dirname(link), target)`, and `path.win32.join` appends an absolute
   second argument rather than taking it whole. The target becomes
   `<repo>\node_modules\` with `C:\<repo>\node_modules\.pnpm\next@…` stuck on
   the end — a path that does not exist.
3. `FileSystemInfo._readContext` answers `ENOENT` with `null`, cached under both
   `_contextTimestamps` and `_contextHashes`.
4. `_readContextTimestampAndHash` merges the pair as `{ ...null, ...null }`,
   which is `{}`.
5. `_resolveContextTsh` guards with `if (entry)`, `{}` passes, and
   `entry.hash` — `undefined` — reaches `hash.update()`.

Step 4 is the only step reachable from configuration. It runs only when the
build-dependency snapshot is taken by timestamp *and* hash, webpack's default.
The hash-only and timestamp-only resolvers apply the same `if (entry)` guard to
a `null` that was never merged into `{}`, so either alone is safe.

## The fix

`next.config.ts` sets `snapshot.buildDependencies` to `{ hash: true, timestamp:
false }` in its `webpack` hook. `pnpm build` then completes on Node 24 on
Windows — 260 routes — and `pnpm size`, `pnpm audit:seo` and `pnpm e2e`, which
all read what a build wrote, work locally again. It changes nothing about the
emitted bundle: that option decides when webpack's persistent cache is
invalidated, not what is compiled. Issue #260.

## What it cost, and the lesson

A stack that names a WebAssembly hasher under a new Node major is a very
convincing false lead, and two rounds of version-swapping were spent on it
before anyone printed the value being hashed. Instrumenting the *bundled*
webpack — `next/dist/compiled/webpack/bundle5.js` is one 1.4 MB line, but a
`String.replace` on a unique minified anchor works fine, and the offsets in the
stack point straight at the call site — answered it in one build.

Node 20 is still unusable, for an unrelated reason: pnpm 11 needs `node:sqlite`.
`engines.node` of `">=22"` is accurate and stays.

Related: [[lighthouse-numbers-come-from-ci]], [[ci-does-not-run-on-a-conflicting-pr]]
