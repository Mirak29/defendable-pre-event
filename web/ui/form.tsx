import type { Token } from 'npm:@twind/preact'

/**
 * Field label, always above its input (same API as tournament's Label).
 *
 * @example
 * <Label for='desc'>Description du poste</Label>
 */
export function Label({
  children,
  required,
  tw: customTw = '',
  ...props
}: {
  required?: boolean
  tw?: Token
} & preact.JSX.IntrinsicElements['label']): preact.JSX.Element {
  return (
    <label
      tw={['block text-[13.5px] font-semibold text-content-primary', customTw]}
      {...props}
    >
      {children}
      {required && <span tw='text-err ml-1' aria-hidden='true'>*</span>}
    </label>
  )
}

/** Title of a group of controls that is not a single input (radiogroup…) */
export const FieldTitle = (
  { children }: { children: preact.ComponentChildren },
) => (
  <span tw='block text-[13.5px] font-semibold text-content-primary'>
    {children}
  </span>
)

/** Text input (same API as tournament's Input) */
export function Input({
  tw = '',
  name,
  ...props
}: { tw?: Token; name: string } & preact.JSX.IntrinsicElements['input']) {
  return (
    <input
      tw={['input h-[34px] py-0 text-[13px]', tw]}
      name={name}
      id={name}
      {...props}
    />
  )
}

/** Multi-line text input */
export function Textarea({
  tw = '',
  name,
  ...props
}: { tw?: Token; name: string } & preact.JSX.IntrinsicElements['textarea']) {
  return (
    <textarea
      tw={['input resize-y text-[13.5px] leading-[1.55] py-2.5', tw]}
      name={name}
      id={name}
      {...props}
    />
  )
}

/**
 * Segmented control, a radiogroup of buttons.
 *
 * @example
 * <Segmented label='Niveau' value={level} options={[['junior', 'Junior']]} onChange={set} />
 */
export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  tw,
}: {
  label: string
  value: T
  options: readonly (readonly [T, string])[]
  onChange: (value: T) => void
  tw?: Token
}) {
  return (
    <div
      role='radiogroup'
      aria-label={label}
      tw={[
        'flex p-[3px] gap-0.5 rounded-lg bg-surface-sunken border border-border-primary',
        tw,
      ]}
    >
      {options.map(([v, text]) => (
        <button
          key={String(v)}
          type='button'
          role='radio'
          aria-checked={v === value}
          onClick={() => onChange(v)}
          tw={[
            'flex-1 h-7 rounded-md text-[13px] font-medium cursor-pointer',
            v === value
              ? 'bg-surface-elevated text-content-primary shadow-[0_0_0_1px_var(--color-border-strong)]'
              : 'text-content-secondary hover:text-content-primary',
          ]}
        >
          {text}
        </button>
      ))}
    </div>
  )
}
