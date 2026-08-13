'use client'

import * as React from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { XIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/*
 * Retuned from the shadcn default (issue #15).
 *
 * Four things shipped by shadcn are forbidden here by CLAUDE.md section 3 and
 * have been removed:
 *
 *   - `supports-backdrop-filter:backdrop-blur-xs` on the overlay — glassmorphism
 *   - `ring-1 ring-foreground/10` on the panel — replaced by a 1px token border
 *   - the `--popover` / `--muted` / `--foreground` variables — replaced by the
 *     `@theme` palette
 *   - the `data-open:animate-*` classes — they come from `tw-animate-css`, which
 *     this project does not install; the panel simply appears
 *
 * The panel is a dark surface, so its contents use the dark text tokens.
 */

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      // A scrim, not a glass panel: the page behind is dimmed, never blurred.
      className={cn('fixed inset-0 z-50 bg-ink/80', className)}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        // Marks the panel for `DialogHeader`, which only reserves room for the
        // close button when there is one.
        data-close-button={showCloseButton ? '' : undefined}
        className={cn(
          // `w-[calc(100%-2rem)]` keeps a 16px gutter at 320px, so the panel
          // shrinks with the viewport instead of scrolling the page sideways.
          'group/dialog fixed top-1/2 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col',
          // The panel is capped but never scrolls: the body below does. The
          // close button is positioned against the panel, so if the panel
          // scrolled, the button would scroll away with the content.
          'max-h-[calc(100dvh-2rem)] overflow-hidden',
          'rounded-lg border border-line-dark bg-ink-2 p-6 text-body text-fg-dark',
          className,
        )}
        {...props}
      >
        <div data-slot="dialog-body" className="flex min-h-0 flex-col gap-4 overflow-y-auto">
          {children}
        </div>
        {showCloseButton && (
          <DialogPrimitive.Close asChild>
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-3 right-3 text-fg-dark hover:bg-ink-3 hover:no-underline"
            >
              <XIcon aria-hidden="true" />
              <span className="sr-only">Close</span>
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      // Reserves the 44px close target plus its offset — but only when the
      // panel actually has one, so a `showCloseButton={false}` dialog does not
      // carry 56px of dead space beside its title.
      className={cn('flex flex-col gap-2 group-data-[close-button]/dialog:pr-14', className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      // shadcn full-bleeds this row with `-mx-6 -mb-6` and a divider. Dropped:
      // inside the scrolling body those negative margins have no padding to
      // cancel, so they would push the row past the panel edge — the horizontal
      // overflow the responsive contract forbids.
      className={cn('mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  )
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('font-sans text-h3 text-fg-dark', className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-body text-fg-dark-mut', className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
