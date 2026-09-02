'use client'

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { Button } from '@/components/ui/button'
import { zipResults } from '@/lib/queue/batch-zip'
import type { QueuedJob } from '@/lib/queue/queue'
import type { ConversionResult } from '@/lib/queue/results'
import { finishedResults, totalResultBytes } from '@/lib/queue/results'
import { saveBlob } from '@/lib/queue/save-file'
import { formatBytes } from '@/lib/router/copy'
import type { FormatId } from '@/lib/router/types'
import { cn } from '@/lib/utils'

import { useObjectUrls } from './use-object-urls'

/*
 * Everything the conversion produced, and the two ways to take it (issue #61).
 *
 * ## Why the downloads are links and not buttons
 *
 * A download is a link: it has a target, a name, and every convention a browser
 * has ever attached to one — Enter activates it, middle-click and "Save link
 * as" work, the status bar shows where it goes, and a screen reader announces
 * it as something that leads somewhere. A `<button>` calling `saveBlob` renders
 * identically and gives all of that up. The cost is the object-URL lifetime,
 * which `./use-object-urls` owns.
 *
 * The archive *is* a button, and for the same reason inverted: it does not exist
 * until it is asked for. There is nothing to point a link at until several
 * hundred megabytes have been packed, and packing them on the off-chance
 * somebody might click is the opposite of what a batch download is for.
 *
 * ## Why the panel disappears rather than emptying
 *
 * An empty "Results" heading above nothing is a promise the page has not kept
 * yet, and it takes up the space the queue needs while it is still working.
 * With nothing finished this component renders `null`.
 *
 * ## Naming is not decided here
 *
 * `finishedResults` settles what each file is called, including the collisions
 * between two identically-named sources. The links and the archive both read
 * that same list, because a download called `scan-2.jpg` on screen and `scan.jpg`
 * inside the ZIP is a bug nobody reports and everybody hits.
 */

const panelVariants = cva('flex min-w-0 flex-col gap-6 rounded-lg border p-6 font-sans', {
  variants: {
    variant: {
      dark: 'border-line-dark bg-ink-2 text-fg-dark',
      light: 'border-line-light bg-paper text-fg-light',
    },
  },
  defaultVariants: { variant: 'dark' },
})

const mutedVariants = cva('', {
  variants: { variant: { dark: 'text-fg-dark-mut', light: 'text-fg-light-mut' } },
  defaultVariants: { variant: 'dark' },
})

const rowVariants = cva(
  [
    'flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1',
    'border-t py-3 first:border-t-0 first:pt-0',
  ].join(' '),
  {
    variants: { variant: { dark: 'border-line-dark', light: 'border-line-light' } },
    defaultVariants: { variant: 'dark' },
  },
)

export type ResultPanelProps = Omit<React.ComponentProps<'section'>, 'children'> &
  VariantProps<typeof panelVariants> & {
    jobs: readonly QueuedJob[]
    /**
     * The format everything in this queue was converted to, which is what the
     * results are named after.
     *
     * A prop rather than something read off each job: a Docify page converts to
     * one target — `/convert/heic-to-jpg` is the whole product — and the page
     * that chose it is the honest place for it to come from.
     */
    to: FormatId
    /**
     * Packs and saves the whole batch. Injected only by a test; the default
     * builds the archive off the main thread — see `lib/queue/batch-zip`.
     */
    onDownloadAll?: (results: readonly ConversionResult[]) => void
  }

function ResultPanel({ className, variant, jobs, to, onDownloadAll, ...props }: ResultPanelProps) {
  const headingId = React.useId()
  const results = React.useMemo(() => finishedResults(jobs, to), [jobs, to])
  const urls = useObjectUrls(results)
  const [packing, setPacking] = React.useState(false)
  const muted = mutedVariants({ variant })

  const downloadAll = React.useCallback(() => {
    if (onDownloadAll !== undefined) {
      onDownloadAll(results)

      return
    }

    setPacking(true)
    void zipResults(results)
      .then((archive) => saveBlob(archive, `docify-${to}.zip`))
      // The button re-enables either way. A failed archive leaves every
      // individual link above it working, which is the fallback the user
      // already has in front of them.
      .finally(() => setPacking(false))
  }, [onDownloadAll, results, to])

  if (results.length === 0) return null

  return (
    <section
      data-slot="result-panel"
      aria-labelledby={headingId}
      className={cn(panelVariants({ variant, className }))}
      {...props}
    >
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={headingId} className="text-h2 uppercase">
          Results
        </h2>
        <p data-slot="result-panel-summary" className={cn('font-mono text-tech', muted)}>
          {results.length === 1 ? '1 file' : `${results.length} files`}
          {', '}
          {formatBytes(totalResultBytes(results))}
        </p>
      </div>

      <ul data-slot="result-panel-list" className="flex list-none flex-col">
        {results.map((result) => {
          const url = urls.get(result.id)

          return (
            <li key={result.id} className={cn(rowVariants({ variant }))}>
              {/*
               * `break-all`, not `break-words`: a converted file keeps its
               * source's name, which is often one unbroken token, and a token
               * wider than the panel is the panel's min-content width — the
               * horizontal scroll the responsive contract forbids.
               */}
              {url === undefined ? (
                <span data-slot="result-panel-name" className="min-w-0 text-body break-all">
                  {result.name}
                </span>
              ) : (
                <a
                  data-slot="result-panel-download"
                  href={url}
                  download={result.name}
                  className={cn(
                    'min-w-0 text-body break-all underline underline-offset-4',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current',
                  )}
                >
                  {result.name}
                </a>
              )}
              <span
                data-slot="result-panel-size"
                className={cn('shrink-0 font-mono text-tech', muted)}
              >
                {formatBytes(result.bytes)}
              </span>
            </li>
          )
        })}
      </ul>

      {/*
       * One file is already one download. Offering to wrap it in an archive
       * adds a step and a format the user then has to unpack.
       */}
      {results.length > 1 && (
        <div>
          <Button
            type="button"
            data-slot="result-panel-download-all"
            disabled={packing}
            onClick={downloadAll}
          >
            {packing ? 'Packing the ZIP' : `Download all ${results.length} as ZIP`}
          </Button>
        </div>
      )}
    </section>
  )
}

export { ResultPanel, panelVariants as resultPanelVariants }
