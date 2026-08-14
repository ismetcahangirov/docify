/**
 * Types for pdf.js's worker half.
 *
 * pdfjs-dist ships `pdf.d.mts` next to its API build but nothing next to
 * `pdf.worker.mjs`, so TypeScript sees that import as an implicit `any`, which
 * CLAUDE.md §5.3 does not allow. The module exports exactly one thing.
 *
 * The value is declared `unknown` on purpose. `lib/engines/pdfjs-runtime.ts`
 * only ever hands it back to pdf.js — it is a message handler for pdf.js's
 * private protocol, and describing its shape here would be inventing a contract
 * nothing in this repository reads.
 */
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown
}
