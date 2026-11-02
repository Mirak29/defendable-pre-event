import type { ComponentChildren, JSX } from 'npm:preact'

export function GameIcon(props: JSX.IntrinsicElements['svg']) {
  return <svg viewBox='0 0 24 24' fill='currentColor' {...props} />
}

export function EmojiIcon(props: JSX.IntrinsicElements['svg']) {
  return <svg viewBox='0 0 128 128' width='100%' height='100%' {...props} />
}

type IconComponent = (props: JSX.IntrinsicElements['svg']) => JSX.Element

/** Icon + label pair, keeps button/trigger content on one line. */
export const withIcon = (
  Icon: IconComponent,
  label: ComponentChildren,
  tw = 'h-5 w-5',
) => (
  <>
    <Icon tw={tw} />
    {label}
  </>
)

export function Icon(props: JSX.IntrinsicElements['svg']) {
  // decorative next to its label, unless it carries its own (a status icon)
  const labelled = !!props['aria-label']
  return (
    <svg
      aria-hidden={labelled ? undefined : 'true'}
      stroke='currentColor'
      fill='transparent'
      stroke-width={2}
      stroke-linecap='round'
      stroke-linejoin='round'
      viewBox='0 0 24 24'
      role={labelled ? 'img' : undefined}
      {...props}
      xmlns='http://www.w3.org/2000/svg'
    >
    </svg>
  )
}
