/**
 * The worker's side of cancellation: the map that lets a `cancel(jobId)`
 * message find the `AbortController` of a job that is already running.
 *
 * Nothing here needs a worker, a thread or a clock — which is the point of
 * keeping it in its own module rather than buried inside `createConversionApi`.
 */

import { describe, expect, it } from 'vitest'

import { createJobRegistry } from '@/lib/worker/job-registry'

describe('the job registry', () => {
  it('aborts the controller belonging to the id', () => {
    const registry = createJobRegistry()
    const wanted = new AbortController()
    const bystander = new AbortController()
    registry.register('a', wanted)
    registry.register('b', bystander)

    expect(registry.abort('a')).toBe(true)

    expect(wanted.signal.aborted).toBe(true)
    expect(bystander.signal.aborted).toBe(false)
  })

  it('reports an unknown id rather than throwing at a user who cancelled twice', () => {
    const registry = createJobRegistry()

    expect(registry.abort('never-started')).toBe(false)
  })

  it('refuses a duplicate id, and says which one', () => {
    const registry = createJobRegistry()
    registry.register('a', new AbortController())

    expect(() => registry.register('a', new AbortController())).toThrow(/"a"/)
  })

  it('leaves the first job untouched when a duplicate is refused', () => {
    const registry = createJobRegistry()
    const first = new AbortController()
    registry.register('a', first)

    expect(() => registry.register('a', new AbortController())).toThrow()

    expect(registry.abort('a')).toBe(true)
    expect(first.signal.aborted).toBe(true)
  })

  it('forgets a job once it settles, so nothing accumulates over a session', () => {
    const registry = createJobRegistry()
    const controller = new AbortController()
    registry.register('a', controller)

    expect(registry.size).toBe(1)

    registry.release('a', controller)

    expect(registry.size).toBe(0)
    expect(registry.abort('a')).toBe(false)
  })

  it('lets an id be reused after the job that held it settled', () => {
    const registry = createJobRegistry()
    const first = new AbortController()
    registry.register('a', first)
    registry.release('a', first)

    const second = new AbortController()
    expect(() => registry.register('a', second)).not.toThrow()
    expect(registry.abort('a')).toBe(true)
    expect(second.signal.aborted).toBe(true)
  })

  it('ignores a late release from a job that no longer owns the id', () => {
    const registry = createJobRegistry()
    const finished = new AbortController()
    registry.register('a', finished)
    registry.release('a', finished)

    const current = new AbortController()
    registry.register('a', current)
    registry.release('a', finished)

    expect(registry.size).toBe(1)
    expect(registry.abort('a')).toBe(true)
    expect(current.signal.aborted).toBe(true)
  })

  it('shrugs off a release for an id it never held', () => {
    const registry = createJobRegistry()

    expect(() => registry.release('ghost', new AbortController())).not.toThrow()
    expect(registry.size).toBe(0)
  })

  it('keeps an aborted job registered until its own finally releases it', () => {
    const registry = createJobRegistry()
    const controller = new AbortController()
    registry.register('a', controller)

    registry.abort('a')

    // The job is still unwinding: only the code that registered it knows when
    // it is truly done, so the registry does not evict on abort.
    expect(registry.size).toBe(1)
    expect(registry.abort('a')).toBe(true)
  })

  it('starts empty', () => {
    expect(createJobRegistry().size).toBe(0)
  })
})
