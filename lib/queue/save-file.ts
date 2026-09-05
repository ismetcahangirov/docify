/**
 * Handing a blob to the browser's downloader.
 *
 * There is no API for "save this file" — the only way is to make an anchor
 * carrying a `download` attribute and click it — so this is the one place that
 * touches the document to do it, rather than every component that has a file.
 *
 * ## The object URL is the whole reason this file exists
 *
 * `URL.createObjectURL` hands back a document-lifetime reference to the *entire*
 * blob. Nothing collects it: the blob stays resident until the URL is revoked or
 * the tab closes, whichever comes first. A batch converter that forgets is how a
 * page ends up holding a gigabyte of files the user downloaded and moved on
 * from ten minutes ago.
 *
 * Revoking is deferred rather than done immediately after the click. The browser
 * reads the href when the download actually starts, which is after the current
 * task has drained; revoking first cancels the download that was just
 * requested. Chrome is forgiving about this and Safari is not.
 */

/**
 * How long to hold the URL after clicking.
 *
 * Ten seconds, and the number is not about ordering. A macrotask is enough for
 * Chromium, which reads the href on the next turn of the loop; Firefox and
 * Safari can still be opening the blob a second or two later on a large file,
 * and a URL revoked under them produces no file and no error — a download that
 * silently does not happen (issue #272).
 *
 * The cost is nothing. The blob is resident either way: this decides only when
 * it stops being, and ten seconds after the click is still long before the user
 * has converted the next one.
 */
const REVOKE_DELAY_MS = 10_000

/**
 * Downloads `blob` as `name`.
 *
 * The anchor never joins the document. It does not need to — a click on a
 * detached anchor still navigates — and appending one means a stray element in
 * the DOM for any code that fails between the append and the removal.
 */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')

  anchor.href = url
  anchor.download = name
  // Belt and braces: `download` already forces a save for a same-origin blob,
  // but a browser that ignores it opens the file over the converter rather than
  // beside it, and the queue goes with the page.
  anchor.rel = 'noopener'
  anchor.click()

  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS)
}
