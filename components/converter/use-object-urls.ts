'use client'

import * as React from 'react'

import type { ConversionResult } from '@/lib/queue/results'

/*
 * Object URLs for the results, and the bookkeeping that frees them again.
 *
 * `URL.createObjectURL` hands back a document-lifetime reference to the whole
 * blob and nothing collects it: the converted file stays resident until the URL
 * is revoked or the tab closes. A batch converter that forgets holds every file
 * it has ever produced, which on a hundred photos is the tab's whole budget
 * spent on things the user already downloaded.
 *
 * So this hook owns three moments, and the panel owns none of them:
 *
 * - a result appears — mint a URL for it
 * - a result leaves the queue, or is re-run and produces a different blob —
 *   revoke the old one
 * - the panel unmounts — revoke everything
 *
 * ## Why the URLs are state rather than made during render
 *
 * Minting one during render is the shorter version and is wrong twice.
 * `createObjectURL` is a side effect, so React is free to run it for a render it
 * then throws away — leaking exactly the thing this hook exists to avoid — and
 * under `reactStrictMode` (which `next.config.ts` turns on) the mount-time
 * cleanup would revoke URLs the already-rendered anchors are still pointing at.
 * Minting in an effect and publishing through state means every URL in the DOM
 * is one that survived the reconcile that put it there.
 *
 * The cache behind it is a ref keyed by job id, so a re-render with the same
 * blobs mints nothing: a batch of fifty results must not churn fifty URLs
 * because a progress tick landed on a job in another list.
 */

const NONE: ReadonlyMap<string, string> = new Map()

interface Held {
  /** Compared by identity: a re-run produces a different blob for the same id. */
  blob: Blob
  url: string
}

/**
 * A URL per result, keyed by job id.
 *
 * Empty on the first render and filled by the effect immediately afterwards, so
 * a caller has to tolerate a missing entry for one paint — render the row
 * without a link rather than with a broken one.
 */
export function useObjectUrls(results: readonly ConversionResult[]): ReadonlyMap<string, string> {
  const [urls, setUrls] = React.useState(NONE)
  const held = React.useRef(new Map<string, Held>())

  // `results` is a fresh array whenever the queue moves, so this effect runs
  // often and mostly finds nothing to do. That is the design: the reconcile
  // below is the comparison, and it only calls `setUrls` when a URL was actually
  // minted or freed — which is what stops a state update from re-triggering it.
  React.useEffect(() => {
    const cache = held.current
    const wanted = new Set(results.map((result) => result.id))
    let changed = false

    for (const [id, entry] of cache) {
      if (wanted.has(id)) continue
      URL.revokeObjectURL(entry.url)
      cache.delete(id)
      changed = true
    }

    for (const result of results) {
      const entry = cache.get(result.id)
      if (entry?.blob === result.blob) continue

      if (entry !== undefined) URL.revokeObjectURL(entry.url)
      cache.set(result.id, { blob: result.blob, url: URL.createObjectURL(result.blob) })
      changed = true
    }

    if (changed) {
      setUrls(new Map([...cache].map(([id, entry]) => [id, entry.url])))
    }
  }, [results])

  // Separate, and empty-dependency, because it is about the panel's lifetime
  // rather than about the list. Clearing the cache matters as much as revoking:
  // under StrictMode the effect above runs again straight afterwards, and an
  // uncleared cache would leave the anchors pointing at URLs already freed.
  React.useEffect(() => {
    const cache = held.current

    return () => {
      for (const entry of cache.values()) URL.revokeObjectURL(entry.url)
      cache.clear()
    }
  }, [])

  return urls
}
