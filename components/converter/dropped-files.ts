/**
 * Getting files out of a drop, a paste or a file input, and nothing else.
 *
 * Pure functions over the browser's own event payloads, kept apart from the
 * component so the awkward cases can be tested without rendering anything. All
 * three of the ways a file arrives hand over a `DataTransfer`, which is why one
 * reader serves them: a drop puts it on the event, a paste calls it
 * `clipboardData`, and only the `<input type="file">` path differs by handing
 * over a plain `FileList`.
 *
 * ## Why the items list and not `dataTransfer.files`
 *
 * `files` is the obvious property and it is wrong for the most common mistake a
 * user makes: dropping a folder. A folder arrives in `files` as an entry with no
 * type and no readable content, so the app accepts it, routes it, and fails
 * somewhere deep in an engine with a message about a damaged file. The items
 * list can be asked what each entry actually is — `webkitGetAsEntry()` is
 * unprefixed in every current browser despite the name — so a folder is refused
 * at the door instead.
 *
 * Where the items list is missing, `files` is read directly. That is the honest
 * fallback: it accepts one thing it should not rather than accepting nothing.
 */

/**
 * One entry of a `DataTransfer`, narrowed to what is read here.
 *
 * Declared rather than imported because `webkitGetAsEntry` is typed as returning
 * `FileSystemEntry | null` in the DOM library, and the only property wanted from
 * it is the one flag that says whether it is a directory.
 */
interface TransferItem {
  kind: string
  getAsFile(): File | null
  webkitGetAsEntry?: () => { isDirectory: boolean } | null
}

/**
 * Every file in `data`, in the order the user offered them, with folders left
 * behind.
 *
 * An empty array for a drag that carried no files at all — dragged text, a
 * dragged link — which is a no-op rather than an error.
 */
export function filesFromTransfer(data: DataTransfer | null | undefined): File[] {
  if (data === null || data === undefined) return []

  const items = data.items as unknown as ArrayLike<TransferItem> | undefined
  if (items === undefined || items.length === 0) return [...(data.files ?? [])]

  const files: File[] = []

  for (const item of Array.from(items)) {
    // A paste carries the text of the clipboard alongside anything else in it;
    // `getAsFile` answers null for those, but skipping them by kind is cheaper
    // and says what is meant.
    if (item.kind !== 'file') continue
    if (item.webkitGetAsEntry?.()?.isDirectory === true) continue

    const file = item.getAsFile()
    if (file !== null) files.push(file)
  }

  return files
}

/**
 * Whether a keystroke belongs to something the user is typing into.
 *
 * The paste listener is on the document, because pasting a screenshot is
 * something people do to a *page* rather than to a focused control — nothing on
 * a converter has to be clicked first. The cost of that reach is this guard:
 * without it, a paste into any text field on the page would also be read as an
 * attempt to add a file.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true

  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
}

/**
 * The files a zone will accept out of what was offered.
 *
 * A single-file zone handed five takes the first rather than refusing all five:
 * the user's intent is not in doubt, and an error that says "one at a time"
 * after a drop they have to repeat is a worse answer than doing the obvious
 * thing.
 */
export function acceptedFiles(files: readonly File[], multiple: boolean): File[] {
  return multiple ? [...files] : files.slice(0, 1)
}
