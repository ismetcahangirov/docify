---
name: abort-is-matched-by-name
description: An abort is identified by name === 'AbortError', never by instanceof — Comlink drops DOMException and jsdom does not make it an Error
type: gotcha
date: 2026-08-14
---

An abort crossing Docify's layers is matched by `name === 'AbortError'`, never
with `instanceof`. `lib/worker/errors.ts` states the rule; `lib/engines/pdf-open.ts`
is where it first had to be obeyed on the *matching* side (#164).

Two independent reasons, both measured rather than assumed:

- Comlink cannot carry a `DOMException`. Nine engine modules throw
  `new DOMException('The conversion was cancelled.', 'AbortError')`, but what
  arrives on the other side of the worker boundary is a plain `Error` that has
  only kept its name.
- jsdom is a runtime where a `DOMException` is not even an `Error`, so
  `instanceof` fails in the tests before it fails in production.

The exemption is deliberately narrow. pdf.js names its cancellation
`AbortException` and is **not** matched, so a `read` callback that renders rather
than parses has to revisit the guard instead of being waved through.

The related trap, found while proving this: `reason instanceof EncryptedPDFError`
in the same file is dead code for pdf-lib 1.17.1 — its ES5 transpilation breaks
the prototype chain, so the check is always false and encrypted classification
rests on message text alone. Same lesson, opposite direction: in this codebase
a type check across a library or worker boundary is the thing to distrust.

Related: [[cancel-needs-a-macrotask-yield]], [[pdfjs-runs-workerless-and-legacy]]
