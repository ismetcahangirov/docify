'use client'

import * as React from 'react'

import { Button } from '@/components/ui/button'
import { isAbort } from '@/lib/abort'
import { importFromUrl, isUrlImportConfigured } from '@/lib/import/url'
import { cn } from '@/lib/utils'

/*
 * "Or paste a link to a file" (issue #270).
 *
 * ## Why this is not a contradiction of the product's claim
 *
 * The claim is that a file the visitor chose from their own machine never
 * leaves the tab, and it is untouched: nothing here reads a local file. What
 * leaves is a URL that was typed into a box, and it leaves because a browser
 * cannot fetch an arbitrary URL by itself — almost no origin opts into being
 * read cross-origin. `services/url-proxy` streams the bytes back and stores
 * none of them, and from the moment they arrive they are an ordinary `File` in
 * the same queue as a dropped one.
 *
 * The paragraph at the foot of the converter says "no file is sent anywhere",
 * and that sentence stays true for exactly the files it is about.
 *
 * ## Why it can disappear entirely
 *
 * The proxy is deployed separately and deliberately, and a Docify without one
 * is the normal case rather than a broken one — a fork, a local checkout, a
 * preview deployment. `isUrlImportConfigured()` reads a build-time constant, so
 * when there is no proxy this component renders nothing at all rather than
 * offering a control that can only fail.
 *
 * ## Why it is its own file
 *
 * `converter.tsx` is the island that assembles the parts; a form with its own
 * pending state, its own error and its own abort is a part (CLAUDE.md §5.2).
 *
 * ## The paste listener
 *
 * `Dropzone` listens for `paste` on the *document*, because pasting a
 * screenshot is something people do to a page. `isTypingTarget` is what stops
 * that listener from also reading a URL pasted into the field below as an
 * attempt to add a file, and it already covers `INPUT` — which is the whole
 * reason this is an `<input>` and not a contenteditable of some kind.
 */

export interface UrlImportProps {
  /** Called with the imported bytes, to be added to the queue like a dropped file. */
  onFile: (file: File) => void
  /** True while a conversion is running: the field stays usable, the fetch does not. */
  disabled?: boolean
  className?: string
}

function UrlImport({ onFile, disabled = false, className }: UrlImportProps) {
  const inputId = React.useId()
  const errorId = React.useId()

  const [url, setUrl] = React.useState('')
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  /**
   * The in-flight import, so that leaving the page stops it.
   *
   * A free Render instance that has gone to sleep takes about a minute to
   * answer, which is long enough for somebody to give up and navigate away —
   * and a `setState` after that is a warning in the console and a leak in the
   * component.
   */
  const inFlight = React.useRef<AbortController | null>(null)

  React.useEffect(() => () => inFlight.current?.abort(), [])

  // Read once per render; it is a build-time constant, so this is the same
  // answer on the server and on the client and cannot desynchronise hydration.
  if (!isUrlImportConfigured()) return null

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (pending || url.trim().length === 0) return

    const controller = new AbortController()
    inFlight.current = controller

    setPending(true)
    setError(null)

    try {
      const file = await importFromUrl(url, { signal: controller.signal })

      onFile(file)
      setUrl('')
    } catch (reason) {
      // A cancellation is this component tearing down, not something to report
      // to somebody who is no longer looking at it. Matched by name, never by
      // type — see lib/abort.ts.
      if (isAbort(reason)) return

      setError(reason instanceof Error ? reason.message : 'That link could not be fetched.')
    } finally {
      if (inFlight.current === controller) inFlight.current = null
      setPending(false)
    }
  }

  return (
    <form
      data-slot="url-import"
      onSubmit={submit}
      className={cn('flex min-w-0 flex-col gap-3', className)}
    >
      <label htmlFor={inputId} className="text-eyebrow text-fg-dark-mut uppercase">
        Or paste a link to a file
      </label>

      {/*
       * Wraps at 320px rather than scrolling: a row that cannot fit is the
       * responsive contract's failure mode, and the field is the part that
       * should keep the width.
       */}
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <input
          id={inputId}
          data-slot="url-import-input"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://example.com/photo.heic"
          value={url}
          disabled={pending}
          aria-describedby={error === null ? undefined : errorId}
          aria-invalid={error === null ? undefined : true}
          onChange={(event) => {
            setUrl(event.target.value)
            // The old message is about the old URL. Leaving it up while a new
            // one is being typed is the error equivalent of a stale result.
            if (error !== null) setError(null)
          }}
          className={cn(
            'text-body text-fg-dark placeholder:text-fg-dark-mut min-h-11 min-w-0 flex-1 basis-64',
            'border-line-dark bg-ink-2 rounded-md border px-4 py-2',
            'focus-visible:outline-fg-dark focus-visible:outline-2 focus-visible:outline-offset-2',
            'disabled:opacity-50',
          )}
        />

        {/*
         * Secondary, and without the arrow: CLAUDE.md §3 puts that on the one
         * high-emphasis action in a block, and on a converter that action is
         * the dropzone above.
         */}
        <Button type="submit" variant="secondary" disabled={pending || disabled}>
          {pending ? 'Fetching…' : 'Fetch'}
        </Button>
      </div>

      {/*
       * Announced rather than merely displayed. Everything else that can fail
       * on this island reports through the queue's own live region, and an
       * import that fails before a job exists has no card to report from.
       */}
      <p
        id={errorId}
        data-slot="url-import-error"
        role="status"
        aria-live="polite"
        className={cn('text-body text-err', error === null && 'sr-only')}
      >
        {error}
      </p>
    </form>
  )
}

export { UrlImport }
