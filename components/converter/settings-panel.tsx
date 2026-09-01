'use client'

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import type {
  ChoiceField,
  Field,
  NumberField,
  SettingsSchema,
  SettingsValues,
  ToggleField,
} from '@/lib/settings/schema'
import { isRadioGroup } from '@/lib/settings/schema'
import { setValue, visibleFields } from '@/lib/settings/values'
import { cn } from '@/lib/utils'

/*
 * One form for every tool (issue #60).
 *
 * The panel knows nothing about video, or PDFs, or quality: it is handed a
 * schema and renders it. That is the difference between fixing an accessibility
 * problem once and fixing it in each of a hundred hand-built forms — and it is
 * why every control here is wired the same way, whatever it turns out to be.
 *
 * ## What "wired the same way" means
 *
 * Every control has a real `<label>` bound to it by id, so its accessible name
 * comes from the platform. Every `help` line is bound with `aria-describedby`,
 * so it is read out rather than merely printed alongside. Every group is a
 * `<fieldset>` with a `<legend>`, which is what makes a radio group announce
 * what it is a choice *about*. None of that is optional per field, because the
 * schema has no way to say it should be.
 *
 * ## Hit areas
 *
 * The responsive contract puts the floor at 44 x 44 px, and a checkbox is 16.
 * Every control therefore sits inside a `min-h-11` label whose whole area is the
 * target — the row is the control, not the little box at its left.
 *
 * ## No local state
 *
 * The panel is controlled. A settings panel that held its own copy would answer
 * one thing while the job carried another the moment anything reset it, and the
 * user would be looking at a lie. `setValue` coerces on the way through, so what
 * comes out of `onChange` is always inside the schema.
 */

const panelVariants = cva('flex min-w-0 flex-col gap-6 font-sans', {
  variants: {
    variant: {
      dark: 'text-fg-dark',
      light: 'text-fg-light',
    },
  },
  defaultVariants: { variant: 'dark' },
})

const controlVariants = cva(
  [
    'min-h-11 w-full min-w-0 rounded-sm border px-3 py-2 font-sans text-body',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current',
    'disabled:pointer-events-none disabled:opacity-50',
  ].join(' '),
  {
    variants: {
      variant: {
        dark: 'border-line-dark bg-ink text-fg-dark',
        light: 'border-line-light bg-paper text-fg-light',
      },
    },
    defaultVariants: { variant: 'dark' },
  },
)

const helpVariants = cva('text-body', {
  variants: {
    variant: { dark: 'text-fg-dark-mut', light: 'text-fg-light-mut' },
  },
  defaultVariants: { variant: 'dark' },
})

type Variant = NonNullable<VariantProps<typeof panelVariants>['variant']>

export type SettingsPanelProps = Omit<React.ComponentProps<'fieldset'>, 'onChange'> &
  VariantProps<typeof panelVariants> & {
    schema: SettingsSchema
    /** The panel is controlled; see the module header. */
    values: SettingsValues
    onChange: (values: SettingsValues) => void
    disabled?: boolean
  }

function SettingsPanel({
  className,
  variant,
  schema,
  values,
  onChange,
  disabled = false,
  ...props
}: SettingsPanelProps) {
  const tone: Variant = variant ?? 'dark'

  const change = (id: string, value: number | string | boolean) => {
    onChange(setValue(schema, values, id, value))
  }

  return (
    <fieldset
      data-slot="settings-panel"
      disabled={disabled}
      className={cn(panelVariants({ variant, className }))}
      {...props}
    >
      {/*
       * Uppercase eyebrow, which is what the design system uses for a label
       * over a block of content.
       */}
      <legend
        data-slot="settings-panel-title"
        className={cn('mb-2 text-eyebrow uppercase', helpVariants({ variant }))}
      >
        {schema.title}
      </legend>

      {visibleFields(schema, values).map((field) => (
        <FieldControl
          key={field.id}
          field={field}
          value={values[field.id]}
          variant={tone}
          onChange={change}
        />
      ))}
    </fieldset>
  )
}

interface ControlProps {
  field: Field
  value: unknown
  variant: Variant
  onChange: (id: string, value: number | string | boolean) => void
}

function FieldControl({ field, value, variant, onChange }: ControlProps) {
  if (field.kind === 'choice') {
    return isRadioGroup(field) ? (
      <RadioField field={field} value={String(value)} variant={variant} onChange={onChange} />
    ) : (
      <SelectField field={field} value={String(value)} variant={variant} onChange={onChange} />
    )
  }

  if (field.kind === 'toggle') {
    return <Toggle field={field} value={value === true} variant={variant} onChange={onChange} />
  }

  return <NumberControl field={field} value={Number(value)} variant={variant} onChange={onChange} />
}

/**
 * The primary decision, with every option visible at once.
 *
 * A `<fieldset>` rather than a `div` of radios: without the legend a screen
 * reader announces four unrelated options and never says what the choice is
 * about.
 */
function RadioField({
  field,
  value,
  variant,
  onChange,
}: ControlProps & { field: ChoiceField; value: string }) {
  const name = React.useId()

  return (
    <fieldset data-slot="settings-field" data-field={field.id} className="flex flex-col gap-2">
      <legend className="mb-1 text-h3">{field.label}</legend>
      {field.help !== undefined && (
        <p className={cn('mb-1', helpVariants({ variant }))}>{field.help}</p>
      )}

      {field.options.map((option) => {
        const id = `${name}-${option.value}`

        return (
          <label
            key={option.value}
            htmlFor={id}
            // The row is the hit area, not the 16px circle inside it.
            className="flex min-h-11 min-w-0 cursor-pointer items-start gap-3 py-1"
          >
            <input
              id={id}
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              // `accent-color` keeps the platform's own control — its focus
              // ring, its keyboard behaviour, its high-contrast rendering — and
              // takes only the fill from the palette.
              className="mt-1 size-4 shrink-0 accent-current"
              aria-describedby={option.help === undefined ? undefined : `${id}-help`}
              onChange={() => onChange(field.id, option.value)}
            />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-body">{option.label}</span>
              {option.help !== undefined && (
                <span id={`${id}-help`} className={cn(helpVariants({ variant }))}>
                  {option.help}
                </span>
              )}
            </span>
          </label>
        )
      })}
    </fieldset>
  )
}

function SelectField({
  field,
  value,
  variant,
  onChange,
}: ControlProps & { field: ChoiceField; value: string }) {
  const id = React.useId()

  return (
    <Labelled field={field} id={id} variant={variant}>
      <select
        id={id}
        value={value}
        aria-describedby={describedBy(field, id)}
        className={cn(controlVariants({ variant }))}
        onChange={(event) => onChange(field.id, event.target.value)}
      >
        {field.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Labelled>
  )
}

function NumberControl({
  field,
  value,
  variant,
  onChange,
}: ControlProps & { field: NumberField; value: number }) {
  const id = React.useId()
  const slider = (field.control ?? 'input') === 'slider'

  return (
    <Labelled field={field} id={id} variant={variant} value={`${value}${unitSuffix(field)}`}>
      <input
        id={id}
        type={slider ? 'range' : 'number'}
        value={value}
        min={field.min}
        max={field.max}
        step={field.step}
        aria-describedby={describedBy(field, id)}
        className={
          // A range input draws its own track, so it takes the height for the
          // touch target and nothing else.
          slider ? 'h-11 w-full accent-current' : cn(controlVariants({ variant }), 'max-w-40')
        }
        onChange={(event) => onChange(field.id, event.target.value)}
      />
    </Labelled>
  )
}

function Toggle({
  field,
  value,
  variant,
  onChange,
}: ControlProps & { field: ToggleField; value: boolean }) {
  const id = React.useId()

  return (
    <div data-slot="settings-field" data-field={field.id} className="flex min-w-0 flex-col gap-1">
      <label
        htmlFor={id}
        className="flex min-h-11 min-w-0 cursor-pointer items-center gap-3 text-body"
      >
        <input
          id={id}
          type="checkbox"
          checked={value}
          aria-describedby={describedBy(field, id)}
          className="size-5 shrink-0 accent-current"
          onChange={(event) => onChange(field.id, event.target.checked)}
        />
        <span className="min-w-0">{field.label}</span>
      </label>
      {field.help !== undefined && (
        <p id={`${id}-help`} className={cn('pl-8', helpVariants({ variant }))}>
          {field.help}
        </p>
      )}
    </div>
  )
}

/** Label above, help below, and the current value beside the label where there is one. */
function Labelled({
  field,
  id,
  variant,
  value,
  children,
}: {
  field: Field
  id: string
  variant: Variant
  value?: string
  children: React.ReactNode
}) {
  return (
    <div data-slot="settings-field" data-field={field.id} className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4">
        <label htmlFor={id} className="min-w-0 text-h3">
          {field.label}
        </label>
        {value !== undefined && (
          <span data-slot="settings-field-value" className="shrink-0 font-mono text-tech">
            {value}
          </span>
        )}
      </div>
      {children}
      {field.help !== undefined && (
        <p id={`${id}-help`} className={cn(helpVariants({ variant }))}>
          {field.help}
        </p>
      )}
    </div>
  )
}

function describedBy(field: Field, id: string): string | undefined {
  return field.help === undefined ? undefined : `${id}-help`
}

function unitSuffix(field: NumberField): string {
  return field.unit === undefined ? '' : ` ${field.unit}`
}

export { SettingsPanel, panelVariants as settingsPanelVariants }
