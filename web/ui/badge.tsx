import type { Token } from 'npm:@twind/preact'

/** Predefined badge style variants (classes live in web/theme.ts) */
const variantStyles = {
  neutral: 'badge-neutral',
  accent: 'badge-accent',
  success: 'badge-ok',
  warning: 'badge-warn',
  error: 'badge-err',
  ai: 'badge-ai', // reserved to what the AI produces or interprets
} as const

/** Possible type of variants */
export type BadgeVariants = keyof typeof variantStyles

/**
 * Props type for the Badge component
 * Extends the standard span element props with additional styling options
 */
type BadgeProps = {
  variant?: BadgeVariants
  tw?: Token
} & preact.JSX.IntrinsicElements['span']

/**
 * Badge component with variant-based styling.
 * A status badge must always carry an icon and a label, never only a color.
 *
 * @example
 * <Badge>Brouillon</Badge>
 * <Badge variant="success"><Check /> Approuvée</Badge>
 * <Badge variant="ai"><Sparkles /> Interprétation IA</Badge>
 */
export function Badge({ variant = 'neutral', tw, ...props }: BadgeProps) {
  return <span tw={['badge', variantStyles[variant], tw]} {...props} />
}
