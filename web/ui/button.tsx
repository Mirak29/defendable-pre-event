import type { Token } from 'npm:@twind/preact'
import { A, type LinkProps } from '/web/lib/router-signal.ts'
/**
 * Props type for the Button component
 * Extends both button element props and LinkProps for routing capabilities
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

type ButtonProps =
  & {
    tw?: Token
    variant?: ButtonVariant
    size?: 'md' | 'sm' | 'icon'
  }
  & preact.JSX.IntrinsicElements['button']
  & Partial<LinkProps>

/**
 * A customizable button component with variant-based styling
 * @example
 * <Button variant="primary">Générer l'épreuve</Button>
 * <Button variant="secondary" size="sm">Copier</Button>
 * <Button variant="ghost" size="icon" aria-label="Fermer"><X /></Button>
 */
export function Button(
  { tw, variant = 'primary', size = 'md', ...props }: ButtonProps,
) {
  const styles = [
    'btn',
    `btn-${variant}`,
    size === 'sm' && 'btn-sm',
    size === 'icon' && 'btn-icon',
    tw,
  ]

  if (props.href || props.hash || props.params) {
    return <A tw={styles} {...props} />
  }

  return <button tw={styles} type='button' {...props} />
}
