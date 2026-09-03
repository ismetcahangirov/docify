/**
 * Cutting a sentence to length without cutting a word in half.
 *
 * Two callers need it and they need it to behave identically: a search
 * description and a social card are both a box with a fixed number of
 * characters in it, and both are worse when the last word is `photograp…`.
 *
 * The ellipsis is one character (U+2026) rather than three full stops, because
 * three cost three of the characters the sentence needed.
 */

/**
 * `text` cut to at most `limit` characters, at a word boundary, with an
 * ellipsis where anything was removed.
 *
 * Whitespace is collapsed first, so a value spanning several lines of source
 * measures as the single line it will be drawn as.
 */
export function clampToWords(text: string, limit: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= limit) return collapsed

  // One character back from the limit, to leave room for the ellipsis itself.
  const cut = collapsed.slice(0, limit - 1)
  const lastSpace = cut.lastIndexOf(' ')
  const words = lastSpace === -1 ? cut : cut.slice(0, lastSpace)

  // A trailing comma or full stop in front of an ellipsis reads as a mistake.
  return `${words.replace(/[\s,.;:—-]+$/u, '')}…`
}
