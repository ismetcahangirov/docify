/**
 * What a tool's options look like when they are data rather than markup.
 *
 * Docify ships more than a hundred tool pages and every one of them has a
 * different set of controls: a quality slider here, four sizing methods there,
 * a page range, a rotation. Written as JSX per tool that is a hundred hand-built
 * forms, each with its own labelling bugs, its own missing `aria-describedby`
 * and its own idea of what "quality" defaults to. Written as a schema it is a
 * hundred declarations and *one* form, which is the only version where fixing an
 * accessibility problem fixes it everywhere.
 *
 * ## What a schema may and may not say
 *
 * A field describes itself — what it is called, what it accepts, what it
 * defaults to, and when it is relevant. It never describes how it is drawn.
 * There is no `className`, no width, no ordering hint beyond the order of the
 * array: a schema that could style itself would drift from the design system the
 * moment two tools disagreed, and the panel would stop being one form.
 *
 * ## Dependent fields
 *
 * {@link VisibilityRule} is the one piece of logic a schema carries, and it
 * exists because the alternative is worse. Video compression offers four sizing
 * methods and each has its own single setting; without a rule the panel shows a
 * target size, a quality and a bitrate at once and the user has to guess which
 * of the three is being used. The rule is deliberately as small as it can be —
 * one field, a list of values it may hold — so that a schema stays readable data
 * rather than becoming a small language nobody can predict.
 *
 * Hidden means *not applied*, not merely not drawn. `visibleValues` in
 * `./values` is what enforces that, and it is the reason a user who picks
 * "quality" does not silently also send the target size they typed a minute ago.
 */

/** Everything a control can hold. */
export type FieldValue = number | string | boolean

/** What every field has, whatever kind it is. */
interface FieldBase {
  /** Stable, and the key the value is stored under. Never shown. */
  id: string
  /** The control's own name, and its accessible name. */
  label: string
  /**
   * One line under the control, saying what the setting does to the file.
   *
   * Wired to the control with `aria-describedby`, so it is read out rather than
   * merely printed next to it.
   */
  help?: string
}

/** A quantity: a size, a rate, a quality, a count. */
export interface NumberField extends FieldBase {
  kind: 'number'
  min: number
  max: number
  step?: number
  default: number
  /**
   * A slider for a value the user feels their way to — quality, a percentage —
   * and a typed box for one they know already, like a width in pixels.
   */
  control?: 'slider' | 'input'
  /** Shown beside the value: `px`, `MB`, `kbps`. */
  unit?: string
}

/** One of a short list. */
export interface ChoiceField extends FieldBase {
  kind: 'choice'
  options: readonly ChoiceOption[]
  default: string
  /**
   * Radio buttons show every option at once, which is what a primary decision
   * needs; a menu hides them behind a click, which is what a long list needs.
   * Absent picks by length — see `RADIO_LIMIT`.
   */
  control?: 'radio' | 'select'
}

export interface ChoiceOption {
  value: string
  label: string
  /** One line under this option, when the difference is not obvious from the name. */
  help?: string
}

/** On or off. */
export interface ToggleField extends FieldBase {
  kind: 'toggle'
  default: boolean
}

/**
 * When a field is relevant at all.
 *
 * Read as "show me only while `field` holds one of `equals`". Absent means
 * always.
 */
export interface VisibilityRule {
  field: string
  equals: readonly FieldValue[]
}

export type Field = (NumberField | ChoiceField | ToggleField) & {
  visibleWhen?: VisibilityRule
}

/** One tool's whole set of options. */
export interface SettingsSchema {
  /**
   * The panel's own accessible name — "Compression", "Page range". Rendered as
   * the legend of the group, so a screen reader announces which set of controls
   * it has entered.
   */
  title: string
  /** In the order they are shown. */
  fields: readonly Field[]
}

/** The values a panel holds, keyed by {@link FieldBase.id}. */
export type SettingsValues = Readonly<Record<string, FieldValue>>

/**
 * Options up to this many are shown as radio buttons; more become a menu.
 *
 * Four is where a radio group stops being scannable at a glance and starts being
 * a wall — and it is exactly the number of sizing methods video compression
 * offers, which is the case this default was chosen for.
 */
export const RADIO_LIMIT = 4

/** Whether `field` is drawn as a radio group rather than a menu. */
export function isRadioGroup(field: ChoiceField): boolean {
  return (field.control ?? (field.options.length <= RADIO_LIMIT ? 'radio' : 'select')) === 'radio'
}
