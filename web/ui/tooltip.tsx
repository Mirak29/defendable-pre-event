import type { Token } from 'npm:@twind/preact'

/** Predefined style variants */
const variants = {
  default: 'bg-content-primary text-surface-page border border-content-primary',
  surface:
    'bg-surface-elevated text-content-primary border border-border-strong',
} as const

const positions = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
} as const

/**
 * Opens the details element on pointer enter
 */
const handlePointerEnter = ({ currentTarget }: PointerEvent) => {
  currentTarget instanceof HTMLDetailsElement && (currentTarget.open = true)
}

/**
 * Closes the details element when the pointer leaves the whole tooltip
 */
const handlePointerLeave = ({ currentTarget }: PointerEvent) => {
  currentTarget instanceof HTMLDetailsElement && (currentTarget.open = false)
}

const summaryStyles = [
  'cursor-default select-none list-none',
]

/**
 * A <details> element that opens on hover with tooltip-style absolute positioning
 *
 * @example
 * <Tooltip summary={<button disabled>PostgreSQL</button>}>
 *   5 compétences maximum
 * </Tooltip>
 */
export function Tooltip({
  tw,
  variant = 'default',
  position = 'top',
  summary,
  children,
  ...props
}: {
  tw?: Token
  variant?: keyof typeof variants
  position?: keyof typeof positions
  summary: string | preact.ComponentChildren
} & Omit<preact.JSX.IntrinsicElements['details'], 'summary'>) {
  return (
    <details
      tw={['relative inline-block', tw, 'group']}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      {...props}
    >
      <summary tw={summaryStyles}>
        {summary}
      </summary>
      <div
        role='tooltip'
        tw={[
          'absolute z-50 px-2.5 py-1.5 text-[12px] leading-snug rounded-md shadow-[var(--shadow)] whitespace-nowrap',
          'transition-opacity duration-150',
          positions[position],
          'opacity-0 invisible pointer-events-none',
          'group-open:opacity-100 group-open:visible',
          variants[variant],
        ]}
      >
        {children}
      </div>
    </details>
  )
}
