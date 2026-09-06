---
name: "windows-build-broke-on-pnpm-junctions"
description: "The Windows build crash was pnpm junctions plus a poisoned .next cache, not Node — and the cache half was already written down before the issue was opened"
type: "gotcha"
date: "2026-09-06"
---

`pnpm build` failed on the Windows development machine, before it emitted a
single route:

```
TypeError: Cannot read properties of undefined (reading 'length')
    at WasmHash._updateWithBuffer (next/dist/compiled/webpack/bundle5.js:...)
    at BatchedHash.update
Next.js build worker exited with code: 1 and signal: null
```

It was blamed on Node 24 for a month, then on "the platform" when the same
stack appeared on Node 22.23.2. Both were wrong, and the WebAssembly hasher in
the stack is a bystander: it was handed `undefined`.

## The chain

1. pnpm links each package into `node_modules/` as an NTFS **junction** on
   Windows, and `fs.readlink()` on a junction returns an **absolute** target.
   On Linux pnpm writes a *relative* symlink.
2. webpack's `lstatReadlinkAbsolute` resolves a link with
   `join(dirname(link), target)`, and `path.win32.join` appends an absolute
   second argument rather than taking it whole. The target becomes
   `<repo>\node_modules\` with `C:\<repo>\node_modules\.pnpm\next@…` stuck on
   the end — a path that does not exist.
3. `FileSystemInfo._readContext` answers `ENOENT` with `null`, cached under
   both `_contextTimestamps` and `_contextHashes`.
4. `_readContextTimestampAndHash` merges the pair as `{ ...null, ...null }`,
   which is `{}`.
5. `_resolveContextTsh` guards with `if (entry)`, `{}` passes, and
   `entry.hash` — `undefined` — reaches `hash.update()`.

## The precondition, which the first version of this entry left out

**Step 4 needs a populated persistent cache.** Both maps must already hold an
entry for that path, and on a cold `.next` neither does. The junction is there
on every Windows build; the crash is junction **plus** a `.next/cache` poisoned
across the separate timestamp and hash snapshots.

`rm -rf .next` cures it. [[parallel-agent-coordination]] had already recorded
exactly that — "It was a stale `.next` from before the run: removing it built
clean" — and nobody read it before opening #260.

So `next.config.ts` taking the build-dependency snapshots by hash alone makes a
latent fault unreachable; it does not repair a build that could not otherwise
run. `main` builds cold *and* warm on Windows with that hook removed, which was
measured rather than assumed, and only after a reviewer asked for the
counterfactual. Adding the hook at all also flips Next's `webpack:
!!config.webpack` into `cache.version` and so invalidated the pack once — which
is the same cure as deleting `.next`, and is probably what actually cleared the
machine where this was found.

## What breaks together, and what does not

Worth knowing before trusting a green local run: `pnpm lint`, `pnpm typecheck`
and `pnpm test` are unaffected by anything in this class. What breaks is
everything downstream of a build — `pnpm build`, `pnpm size`, `pnpm audit:seo`,
`pnpm e2e` (Playwright's `webServer` builds first) and `pnpm lighthouse`. A
session can run every check it thinks matters and still be told by CI about a
class of failure it never saw. That is how the analytics beacon broke an e2e
assertion on the way to `main` while closing #102.

## Two traps that cost time here

**Do not blame your own change until it is reproduced with the tree stashed.**
`git stash -u && pnpm build` costs three minutes and answers it.

**`pnpm env use --global <version>`** is the way to try another Node, and it
has its own trap: pnpm's bin directory must be on `PATH`, and it must be
*appended* rather than prefixed. Prefixed, its `node` shim shadows the system
Node for pnpm itself, and every pnpm command then prints a bare version string
and exits.

**A convincing stack is not a diagnosis.** Three Node versions were swapped
before anybody printed the value being hashed. Instrumenting the *bundled*
webpack is not hard — `next/dist/compiled/webpack/bundle5.js` is one 1.4 MB
line, but a `String.replace` on a unique minified anchor works, and the column
offsets in the stack point straight at the call site. One build answered it.

`engines.node` of `">=22"` is accurate and stays: 24 works, and 20 cannot be
used because pnpm 11 needs `node:sqlite`.

Related: [[parallel-agent-coordination]], [[lighthouse-numbers-come-from-ci]], [[ci-does-not-run-on-a-conflicting-pr]]
