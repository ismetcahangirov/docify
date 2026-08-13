import { describe, expect, it } from 'vitest'

import { cn, TYPE_SCALE } from '@/lib/utils'
import { TYPE_SCALE as DECLARED_TYPE_SCALE } from '../support/tokens'

describe('TYPE_SCALE', () => {
  /*
   * `cn` teaches tailwind-merge the scale by name. If a step is added to or
   * renamed in app/globals.css and this list is not updated, `cn` silently
   * reclassifies it as a colour again — the exact bug the list exists to fix,
   * and one that no other assertion would catch.
   */
  it('matches every --text-* step declared in app/globals.css', () => {
    expect([...TYPE_SCALE].sort()).toEqual([...DECLARED_TYPE_SCALE].sort())
  })
})

describe('cn', () => {
  it('joins truthy class names and drops falsy ones', () => {
    expect(cn('a', false && 'b', undefined, 'c')).toBe('a c')
  })

  it('accepts arrays and conditional objects', () => {
    expect(cn(['a', 'b'], { c: true, d: false })).toBe('a b c')
  })

  it('lets the last conflicting Tailwind utility win', () => {
    expect(cn('bg-ink', 'bg-paper')).toBe('bg-paper')
    expect(cn('px-4', 'px-6')).toBe('px-6')
  })

  it('keeps utilities that only look conflicting', () => {
    expect(cn('bg-paper', 'text-ink')).toBe('bg-paper text-ink')
  })

  /*
   * `text-` is overloaded: `text-body` is a step of the project type scale
   * while `text-fg-dark` is a colour. tailwind-merge only knows that from the
   * theme, so without teaching it the scale it treats `text-body` as a colour
   * and silently drops it whenever a colour follows.
   */
  it('distinguishes a type scale step from a text colour', () => {
    expect(cn('text-body', 'text-fg-dark')).toBe('text-body text-fg-dark')
    expect(cn('text-h3', 'text-fg-dark-mut')).toBe('text-h3 text-fg-dark-mut')
  })

  it('still collapses two steps of the type scale', () => {
    expect(cn('text-h3', 'text-h2')).toBe('text-h2')
  })

  it('still collapses two text colours', () => {
    expect(cn('text-fg-dark', 'text-fg-light')).toBe('text-fg-light')
  })

  it('returns an empty string when given nothing', () => {
    expect(cn()).toBe('')
  })
})
