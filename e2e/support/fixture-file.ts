/*
 * Putting a generated file where a `<input type="file">` can be given it.
 *
 * ## Why not `setInputFiles({ name, mimeType, buffer })`
 *
 * Because it is not free, and what it costs lands in the measurement.
 * Playwright's buffer form hands the bytes to the page as base64 and decodes
 * them there, on the main thread. A CPU profile of a conversion started that
 * way is 509 samples inside an anonymous frame with no URL and a visible `atob`
 * beside it — and the vitals suite read that as a 3.7 second long task while a
 * conversion was running, which is exactly the failure it exists to catch. The
 * work was Playwright's, and the app's main thread was idle throughout.
 *
 * Handed a path instead, Playwright sets the file through the browser protocol.
 * Nothing runs in the page, and the profile of the same conversion is `(idle)`.
 *
 * The directory is a fresh one under the system temp per call, so two tests
 * running in parallel cannot hand each other's file to a dropzone. Playwright
 * does not clean it up and neither does this — a few megabytes in the temp
 * directory is what the operating system's temp directory is for.
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Writes `bytes` to a private temp directory and answers with the path. */
export function fixtureFile(name: string, bytes: Uint8Array): string {
  const path = join(mkdtempSync(join(tmpdir(), 'docify-e2e-')), name)
  writeFileSync(path, bytes)

  return path
}
