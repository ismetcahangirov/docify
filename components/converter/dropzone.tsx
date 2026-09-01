'use client'

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { UploadIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

import { acceptedFiles, filesFromTransfer, isTypingTarget } from './dropped-files'

/*
 * The dropzone — the first thing anyone touches (issue #56).
 *
 * Three ways in, because people reach for all three and a converter that only
 * accepts one of them feels broken rather than opinionated: drag and drop, click
 * to browse, and paste. The third is the one most tools forget and the one a
 * screenshot arrives by.
 *
 * ## Why a label around the input rather than a div with a click handler
 *
 * The obvious shape is `<div role="button" tabIndex={0} onClick={...}>` driving
 * a hidden input, and it costs the whole keyboard story: the role has to be
 * announced, Enter and Space have to be handled by hand, and the input — the
 * thing that actually has an accessible name and a file-picker binding — is
 * unreachable. A `<label>` wrapping a visually-hidden-but-focusable input gets
 * all of it from the platform. Tab reaches the input, Enter opens the picker,
 * the label is its accessible name, and clicking anywhere in the zone activates
 * it. `sr-only` and not `hidden`, because `hidden` is not focusable.
 *
 * ## Why the paste listener is on the document
 *
 * Pasting a screenshot is something people do to a *page*: nothing has to be
 * clicked first, and requiring a click would make the feature undiscoverable.
 * The cost is that a paste into a text field elsewhere would also be read as a
 * file, which `isTypingTarget` is there to prevent.
 *
 * ## Why the drag state is a counter and not a boolean
 *
 * `dragleave` fires every time the pointer crosses into a *child* element, so a
 * boolean flickers off and on as the cursor moves over the icon and the text
 * inside the zone. Counting enters against leaves is what makes the highlight
 * hold still.
 */

/**
 * The zone inverts while a file is over it rather than growing a dashed border.
 *
 * A dashed rectangle is the generic signifier and says nothing this design
 * system says elsewhere. Swapping the fill and the text colour outright is
 * unmistakable at any size, needs no second colour, and is the same move the
 * page already makes between its light and dark blocks.
 */
const dropzoneVariants = cva(
  [
    'relative flex w-full min-w-0 flex-col items-center justify-center gap-4',
    'min-h-52 rounded-lg border p-8 text-center break-words sm:p-12',
    'font-sans transition-colors',
    'focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-current',
    'data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50',
  ].join(' '),
  {
    variants: {
      variant: {
        dark: [
          'border-line-dark bg-ink-2 text-fg-dark',
          'hover:bg-ink-3',
          'data-[dragging=true]:border-line-light data-[dragging=true]:bg-paper',
          'data-[dragging=true]:text-fg-light',
          // The muted tone has to invert with everything else, so it is named
          // for both states rather than faked with an opacity that would drift
          // from the palette.
          '[&_[data-slot=dropzone-hint]]:text-fg-dark-mut',
          'data-[dragging=true]:[&_[data-slot=dropzone-hint]]:text-fg-light-mut',
        ].join(' '),
        light: [
          'border-line-light bg-paper text-fg-light',
          'hover:bg-paper-2',
          'data-[dragging=true]:border-line-dark data-[dragging=true]:bg-ink',
          'data-[dragging=true]:text-fg-dark',
          '[&_[data-slot=dropzone-hint]]:text-fg-light-mut',
          'data-[dragging=true]:[&_[data-slot=dropzone-hint]]:text-fg-dark-mut',
        ].join(' '),
      },
    },
    defaultVariants: { variant: 'dark' },
  },
)

export type DropzoneProps = Omit<React.ComponentProps<'div'>, 'onDrop' | 'onPaste'> &
  VariantProps<typeof dropzoneVariants> & {
    /**
     * Every file the user offered, in the order they offered them.
     *
     * Never called with an empty list: a drag that carried no files, or a paste
     * of plain text, is a no-op rather than a call with nothing in it.
     */
    onFiles: (files: File[]) => void
    /** The `accept` attribute, e.g. `'image/*,application/pdf'`. */
    accept?: string
    /** Whether several files may be offered at once. Defaults to `true`. */
    multiple?: boolean
    disabled?: boolean
    /** The zone's own heading, and the input's accessible name. */
    label?: React.ReactNode
    /** The line under it. Say what the tool takes, not how a dropzone works. */
    hint?: React.ReactNode
  }

function Dropzone({
  className,
  variant,
  onFiles,
  accept,
  multiple = true,
  disabled = false,
  label = 'Drop your files here',
  hint,
  ...props
}: DropzoneProps) {
  const inputId = React.useId()
  const hintId = `${inputId}-hint`

  // See the module header: `dragleave` fires on every child boundary, so the
  // highlight has to survive a pointer crossing the icon inside the zone.
  const depth = React.useRef(0)
  const [dragging, setDragging] = React.useState(false)

  const deliver = React.useCallback(
    (files: readonly File[]) => {
      if (disabled) return

      const accepted = acceptedFiles(files, multiple)
      if (accepted.length > 0) onFiles(accepted)
    },
    [disabled, multiple, onFiles],
  )

  React.useEffect(() => {
    if (disabled) return

    const onPaste = (event: ClipboardEvent) => {
      if (isTypingTarget(event.target)) return

      const files = filesFromTransfer(event.clipboardData)
      if (files.length === 0) return

      // Only once something usable has been found: preventing the default on a
      // paste that turned out to be text would swallow it for everyone else.
      event.preventDefault()
      deliver(files)
    }

    document.addEventListener('paste', onPaste)

    return () => document.removeEventListener('paste', onPaste)
  }, [deliver, disabled])

  const endDrag = () => {
    depth.current = 0
    setDragging(false)
  }

  return (
    <div
      data-slot="dropzone"
      data-dragging={dragging}
      data-disabled={disabled}
      className={cn(dropzoneVariants({ variant, className }))}
      onDragEnter={(event) => {
        if (disabled) return
        event.preventDefault()
        depth.current += 1
        setDragging(true)
      }}
      onDragOver={(event) => {
        if (disabled) return
        // Without this the browser navigates to the dropped file and the page —
        // and whatever was queued on it — is gone.
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={() => {
        if (disabled) return
        depth.current -= 1
        if (depth.current <= 0) endDrag()
      }}
      onDrop={(event) => {
        if (disabled) return
        event.preventDefault()
        endDrag()
        deliver(filesFromTransfer(event.dataTransfer))
      }}
      {...props}
    >
      <label htmlFor={inputId} className="flex min-w-0 cursor-pointer flex-col items-center gap-4">
        {/* 44px, the same badge the feature cards use and the touch-target floor. */}
        <span
          data-slot="dropzone-badge"
          aria-hidden="true"
          className="flex size-11 shrink-0 items-center justify-center rounded-full border border-current"
        >
          <UploadIcon className="size-5" strokeWidth={1.5} />
        </span>

        <span data-slot="dropzone-label" className="text-h3">
          {label}
        </span>
      </label>

      <p data-slot="dropzone-hint" id={hintId} className="max-w-prose text-body">
        {hint ?? 'Click to browse, or paste from the clipboard. Nothing is uploaded.'}
      </p>

      {/*
       * Visually hidden and still focusable. The label above points at it, so
       * the picker opens from a click anywhere in the zone and from Enter on the
       * keyboard, with no key handling of our own.
       */}
      <input
        id={inputId}
        data-slot="dropzone-input"
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        aria-describedby={hintId}
        className="sr-only"
        onChange={(event) => {
          deliver([...(event.target.files ?? [])])
          // Cleared so that choosing the same file twice in a row still fires a
          // change event — otherwise a user who cancels a job and picks the same
          // file again gets nothing.
          event.target.value = ''
        }}
      />
    </div>
  )
}

export { Dropzone, dropzoneVariants }
