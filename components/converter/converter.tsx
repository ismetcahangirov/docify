'use client'

import * as React from 'react'

import { acceptFor, formatMeta } from '@/lib/registry/formats'
import type { ConversionPair } from '@/lib/registry/pairs'
import { pairTitle } from '@/lib/registry/pairs'
import { alternativeTargets } from '@/lib/router/alternatives'
import { probeCapabilities } from '@/lib/router/capabilities'
import type { ConversionTask } from '@/lib/router/types'
import type { JobSettings } from '@/lib/settings/for-pair'
import { settingsFor } from '@/lib/settings/for-pair'
import type { SettingsValues } from '@/lib/settings/schema'
import { defaultValues } from '@/lib/settings/values'
import { cn } from '@/lib/utils'

import { Dropzone } from './dropzone'
import { JobCard } from './job-card'
import { QueueAnnouncer } from './queue-announcer'
import { ResultPanel } from './result-panel'
import { SettingsPanel } from './settings-panel'
import { UrlImport } from './url-import'
import { useFileQueue } from './use-file-queue'

/*
 * The converter itself, assembled (issue #66).
 *
 * Everything under `components/converter/` shipped as an independent piece over
 * EPIC 7 and none of it had a page to live on. This is the island that puts the
 * dropzone, the queue, the cards, the announcer and the result panel together
 * and hands them a task.
 *
 * ## It is an island, and the page around it is not
 *
 * The heading, the explanation, the steps, the questions and the links are
 * server-rendered static HTML — the whole SEO surface exists before any
 * JavaScript runs, and would still exist if none of it ever did. This component
 * is the only part of a conversion page that hydrates, which is what keeps the
 * first-load bundle within the budget that `pnpm size` enforces.
 *
 * ## The task comes from the page, not from the user
 *
 * A Docify page converts one pair. `/convert/heic-to-jpg` asks the router for
 * `heic -> jpg` and nothing else, which is why there is no format picker here:
 * the choice was made by arriving at this URL, and offering it again would be a
 * second, worse copy of the catalogue.
 *
 * ## Files are converted one after another
 *
 * Not in parallel. Each engine is sized against the device's whole memory
 * budget on the assumption that it has the tab to itself (`lib/router/budget`),
 * so two large jobs at once is how a routing decision that was correct becomes
 * an out-of-memory crash.
 */

export interface ConverterProps {
  pair: ConversionPair
}

/** The empty list, hoisted so an idle render does not mint a new array. */
const NO_ALTERNATIVES: readonly ConversionTask[] = []

/** What a page with no panel holds, and what it sends. */
const NO_VALUES: SettingsValues = {}
const NO_SETTINGS: JobSettings = {}

function Converter({ pair }: ConverterProps) {
  const queue = useFileQueue()
  const { add, run, cancel, remove: drop, retry: requeue } = queue

  const from = formatMeta(pair.from)
  const to = formatMeta(pair.to)

  const task = React.useMemo<ConversionTask>(
    () => ({ from: pair.from, to: pair.to, op: pair.op }),
    [pair.from, pair.to, pair.op],
  )

  const start = React.useCallback((files: readonly File[]) => add([...files]), [add])

  /**
   * A file fetched from a URL joins the queue exactly as a dropped one does.
   *
   * There is deliberately no second path: once `UrlImport` hands over a `File`,
   * nothing downstream — the router, the worker, the cards — can tell where it
   * came from, and nothing downstream should be able to.
   */
  const startOne = React.useCallback((file: File) => add([file]), [add])

  /**
   * The controls this pair offers, and what the user has done with them.
   *
   * `null` for a conversion where nothing a panel could show would reach an
   * engine — see `lib/settings/for-pair`, which is where that decision lives so
   * that this component never reasons about formats.
   *
   * The state is not keyed on the pair because an island renders one pair for
   * its whole life: the URL is the choice, and changing it is a navigation.
   */
  const settings = React.useMemo(() => settingsFor(pair), [pair])

  const [values, setValues] = React.useState<SettingsValues>(() =>
    settings === null ? NO_VALUES : defaultValues(settings.schema),
  )

  const applied = React.useMemo<JobSettings>(
    () => (settings === null ? NO_SETTINGS : settings.toJobSettings(values)),
    [settings, values],
  )

  /**
   * What the next job will carry, kept where the scheduler can read it.
   *
   * A ref rather than a dependency of the scheduler effect below: the values
   * are read when a job *starts*, so a slider moved while one is running
   * belongs to the next file rather than to the one in flight — and putting
   * them in the effect's dependencies would wake it on every keystroke for no
   * decision it could make differently.
   */
  const jobSettings = React.useRef(applied)
  React.useEffect(() => {
    jobSettings.current = applied
  }, [applied])

  /**
   * Which jobs have already been handed to the router, and whether one is in
   * flight.
   *
   * Refs rather than state: nothing renders from either, and the scheduler
   * below has to read the current values from inside an effect that closed over
   * an older render.
   */
  const started = React.useRef(new Set<string>())
  const busy = React.useRef(false)

  /**
   * How many runs have settled. State, unlike the two refs, because its only
   * purpose is to re-run the scheduler.
   *
   * A run usually ends with a dispatch the list shows — `succeed` or `fail` —
   * and the render that follows is what wakes the effect for the next job. A
   * cancelled run does not: the list moved the job back to `queued` when the
   * user clicked, and the worker's abort is a message the table then ignores
   * without a render. Counting the end of every run is what keeps a job that is
   * waiting its turn — a retry, say (issue #263) — from waiting for a render
   * that never comes.
   */
  const [settled, settle] = React.useReducer((count: number) => count + 1, 0)

  /*
   * The scheduler: one queued job at a time, started from an effect rather than
   * from the drop handler.
   *
   * The obvious version calls `run` straight after `add`, and it does nothing at
   * all — `add` dispatches, and the job does not exist in the queue the hook can
   * see until that dispatch has been committed. Waiting for the render is what
   * makes the lookup inside `run` succeed.
   *
   * One at a time is the other half. Every engine's memory budget is calculated
   * on the assumption that it has the tab to itself, so two large jobs running
   * together is how a routing decision that was correct becomes an
   * out-of-memory crash.
   *
   * A job that has been cancelled stays in `started`, so it waits for the user
   * to ask again rather than restarting itself the moment they stop it. A job
   * the user asks to try again is taken *out* of `started` (see `retry`), which
   * is how the request reaches this effect.
   */
  React.useEffect(() => {
    if (busy.current) return

    const next = queue.jobs.find((job) => job.state === 'queued' && !started.current.has(job.id))
    if (next === undefined) return

    started.current.add(next.id)
    busy.current = true
    // `run` never rejects: every failure is already a state the list shows.
    void run(next.id, task, jobSettings.current).finally(() => {
      busy.current = false
      settle()
    })
  }, [queue.jobs, settled, run, task])

  /**
   * "Try again" puts the job back in the line; it does not start it.
   *
   * Calling `run` from here would bypass `busy`, and a second job alongside the
   * one in flight is the out-of-memory case the scheduler exists to prevent
   * (issue #263). Returning the job to `queued` and forgetting that it was ever
   * started is enough: the effect above sees a queued job it has not started
   * and takes it in turn, once whatever is running has settled.
   */
  const retry = React.useCallback(
    (id: string) => {
      started.current.delete(id)
      requeue(id)
    },
    [requeue],
  )

  /**
   * Taking a file out of the list takes it out of the scheduler's memory too.
   *
   * Harmless while ids come from a counter and are never reused, but `started`
   * is the set of jobs this scheduler has handed to the router, and a job that
   * is no longer in the queue is not one of them.
   */
  const remove = React.useCallback(
    (id: string) => {
      started.current.delete(id)
      drop(id)
    },
    [drop],
  )

  /**
   * What else this device could do with the file, worked out only once a job
   * has actually been refused.
   *
   * In an effect rather than during render because it calls
   * `probeCapabilities()`, which reads `navigator` and therefore cannot run on
   * the server.
   *
   * Measured against the *same numbers the job was routed with*, not against
   * the file's size. A picture is refused for its decoded pixels far more often
   * than for its bytes — a half-megabyte PNG can be a hundred megapixels — and
   * an alternative worked out from bytes alone is one the browser refuses on
   * the next drop, which is precisely the dead end `alternativeTargets` exists
   * to prevent (issue #272). The size is the fallback for a job whose header
   * was never read, which is the same "no pixel bound" the router already
   * understands.
   *
   * The two numbers are pulled out separately so the effect depends on values
   * rather than on the identity of an object rebuilt on every render.
   */
  const [alternatives, setAlternatives] = React.useState(NO_ALTERNATIVES)
  const refused = queue.jobs.find(
    (job) => job.state === 'failed' && job.failure?.code !== undefined,
  )
  const refusedBytes = refused?.routeInput?.bytes ?? refused?.file.size
  const refusedPixels = refused?.routeInput?.pixels

  React.useEffect(() => {
    if (refusedBytes === undefined) {
      setAlternatives(NO_ALTERNATIVES)

      return
    }

    const input =
      refusedPixels === undefined
        ? { bytes: refusedBytes }
        : { bytes: refusedBytes, pixels: refusedPixels }

    setAlternatives(alternativeTargets(task, [input], probeCapabilities()))
  }, [refusedBytes, refusedPixels, task])

  return (
    <div data-slot="converter" className="flex min-w-0 flex-col gap-6">
      <QueueAnnouncer jobs={queue.jobs} />

      <Dropzone
        onFiles={start}
        accept={acceptFor(from)}
        label={`Drop your ${from.name} files here`}
        hint={`They are converted to ${to.name} on this device. Nothing is uploaded, and there is no limit on how many you add.`}
      />

      {/*
       * Under the dropzone, because it is the second way to do the same thing
       * and the lesser one: a link has to be public, and a drop does not.
       * Renders nothing at all where no proxy is configured (issue #270).
       */}
      <UrlImport onFile={startOne} />

      {/*
       * Above the queue, because it is a decision made *before* a file is
       * dropped — and left enabled while a job runs, since what it holds is
       * read when the next job starts rather than shared with the one in
       * flight.
       */}
      {settings !== null && (
        <SettingsPanel schema={settings.schema} values={values} onChange={setValues} />
      )}

      {queue.jobs.length > 0 && (
        <ul
          data-slot="converter-queue"
          aria-label={`${pairTitle(pair)} queue`}
          className="flex list-none flex-col gap-3"
        >
          {queue.jobs.map((job) => (
            <li key={job.id} className="min-w-0">
              <JobCard
                job={job}
                task={task}
                alternatives={alternatives}
                onCancel={cancel}
                onRetry={retry}
                onRemove={remove}
              />
            </li>
          ))}
        </ul>
      )}

      <ResultPanel jobs={queue.jobs} to={pair.to} />

      {/*
       * The claim the product is built on, next to the control that would break
       * it. Rendered by the island rather than by the page because it is a
       * statement about what this widget does with the file it was given.
       */}
      <p className={cn('text-body text-fg-dark-mut')}>
        Every conversion runs in this tab. No {from.name} file is sent anywhere, and closing the
        page is enough to remove every trace of it. A link you paste is fetched for you, because a
        browser cannot read one itself — the file it returns is converted here like any other.
      </p>
    </div>
  )
}

export { Converter }
