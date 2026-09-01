/**
 * The values behind a settings panel: what they start as, what a change does to
 * them, and which of them are real.
 *
 * All pure, and separate from the panel for the usual reason — this is where the
 * decisions are, and none of them needs a DOM to check. A slider that reports a
 * value outside its own range, a number typed as text, a field the user filled
 * in and then hid: each of those is arithmetic, and each of them has a wrong
 * answer that reaches an engine.
 */

import type { Field, FieldValue, SettingsSchema, SettingsValues } from './schema'

/** Every field at its declared default. What a tool page starts with. */
export function defaultValues(schema: SettingsSchema): SettingsValues {
  return Object.fromEntries(schema.fields.map((field) => [field.id, field.default]))
}

/**
 * Whether `field` applies, given what the rest of the panel currently holds.
 *
 * A rule naming a field that does not exist answers `false` rather than `true`:
 * a typo in a schema should hide a control someone can report as missing, not
 * show one whose value is applied on top of a setting it contradicts.
 */
export function isVisible(field: Field, values: SettingsValues, schema: SettingsSchema): boolean {
  const rule = field.visibleWhen
  if (rule === undefined) return true
  if (!schema.fields.some((candidate) => candidate.id === rule.field)) return false

  return rule.equals.includes(values[rule.field])
}

/** The fields to draw, in schema order. */
export function visibleFields(schema: SettingsSchema, values: SettingsValues): Field[] {
  return schema.fields.filter((field) => isVisible(field, values, schema))
}

/**
 * The values an engine should actually be given.
 *
 * Only the visible ones, and that is the whole point: a user who typed a target
 * size and then switched to constant quality has two answers in the panel and
 * means the second. Sending both lets whichever consumer reads first decide,
 * which is how a setting nobody can see ends up changing the file.
 */
export function visibleValues(schema: SettingsSchema, values: SettingsValues): SettingsValues {
  const normalised = normalise(schema, values)

  return Object.fromEntries(
    visibleFields(schema, normalised).map((field) => [field.id, normalised[field.id]]),
  )
}

/**
 * `values` with one field changed, coerced onto what that field accepts.
 *
 * Coercion rather than rejection, throughout. A control can only ever hand back
 * something out of range through a bug or a keyboard, and the useful response to
 * "quality: 400" is 100 rather than an error halfway through a conversion — the
 * same argument `lib/engines/image-options.ts` makes about clamping there.
 */
export function setValue(
  schema: SettingsSchema,
  values: SettingsValues,
  id: string,
  value: FieldValue,
): SettingsValues {
  const field = schema.fields.find((candidate) => candidate.id === id)
  if (field === undefined) return values

  const coerced = coerce(field, value)

  return coerced === values[id] ? values : { ...values, [id]: coerced }
}

/**
 * Every field present and legal: defaults filled in, values clamped, anything
 * the schema does not declare dropped.
 *
 * Dropping the undeclared matters for state that outlives a schema — a saved
 * preference, a URL, a tool whose options changed between releases. A leftover
 * key is a value nothing validates.
 */
export function normalise(schema: SettingsSchema, values: SettingsValues): SettingsValues {
  return Object.fromEntries(
    schema.fields.map((field) => [
      field.id,
      field.id in values ? coerce(field, values[field.id]) : field.default,
    ]),
  )
}

/** One value pulled onto what its field accepts. */
function coerce(field: Field, value: FieldValue): FieldValue {
  if (field.kind === 'toggle') return value === true || value === 'true'

  if (field.kind === 'choice') {
    return field.options.some((option) => option.value === value)
      ? (value as string)
      : field.default
  }

  // A number input hands back a string, and an emptied one hands back `''` —
  // which `Number` reads as zero, so a cleared box would silently become the
  // field's minimum rather than its default.
  if (typeof value !== 'number' && String(value).trim() === '') return field.default

  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return field.default

  const stepped = snap(parsed, field.min, field.step)

  return Math.min(field.max, Math.max(field.min, stepped))
}

/**
 * `value` on the nearest step above `min`.
 *
 * A slider produces steps on its own; a typed box does not, and a bitrate of
 * 2_000_001 is noise in a field whose step is a thousand.
 */
function snap(value: number, min: number, step: number | undefined): number {
  if (step === undefined || step <= 0) return value

  return min + Math.round((value - min) / step) * step
}
