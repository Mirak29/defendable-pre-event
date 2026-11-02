// Small building blocks shared by the recruiter pages.
import type { ComponentChildren } from 'npm:preact'
import type { Token } from 'npm:@twind/preact'
import { A } from '/web/lib/router-signal.ts'
import { announceAnchor } from '/web/lib/scroll-spy.ts'
import { ChevronLeft, ChevronRight } from '/web/assets/icons.tsx'

/** "‹ Mes épreuves" */
export const BackLink = (
  { href, children }: { href: string; children: ComponentChildren },
) => (
  <A
    href={href}
    tw='inline-flex items-center gap-1 text-[12.5px] text-content-tertiary no-underline hover:text-content-primary self-start'
  >
    <ChevronLeft tw='w-3.5 h-3.5' />
    {children}
  </A>
)

/**
 * In-page anchor. `<base href="/">` (index.html) makes a bare `#id` resolve
 * to `/#id`, i.e. the home page: scroll to the section instead.
 */
export const AnchorLink = (
  { to, children, tw, ...props }:
    & { to: string; tw?: Token }
    & Omit<preact.JSX.IntrinsicElements['a'], 'href'>,
) => (
  <a
    {...props}
    href={`${location.pathname}${location.search}#${to}`}
    onClick={(e) => {
      e.preventDefault()
      announceAnchor(to)
      document.getElementById(to)?.scrollIntoView({ behavior: 'smooth' })
    }}
    tw={tw}
  >
    {children}
  </a>
)

/** Link of an anchor menu (R4, R6): the current section is highlighted */
export const navLinkTw = (active: boolean) => [
  'flex items-center gap-2 px-2.5 py-1.5 rounded-md no-underline border-l-2',
  active
    ? 'bg-surface-hover text-content-primary font-medium border-accent'
    : 'text-content-secondary border-transparent hover:bg-surface-hover hover:text-content-primary',
]

/** Outlined metadata tag: level, duration, format… */
export const MetaTag = (
  { icon: Icon, children, tw }: {
    icon?: (props: { tw?: string }) => preact.JSX.Element
    children: ComponentChildren
    tw?: Token
  },
) => (
  <span
    tw={[
      'inline-flex items-center gap-[5px] h-[22px] px-2 rounded-md border border-border-strong bg-surface-elevated text-[12px] whitespace-nowrap',
      tw,
    ]}
  >
    {Icon && <Icon tw='w-3 h-3 text-content-tertiary' />}
    {children}
  </span>
)

/** Card with a title, used for the side-by-side blocks */
export const Panel = (
  { title, children, tw, aside }: {
    title?: ComponentChildren
    aside?: ComponentChildren
    children: ComponentChildren
    tw?: Token
  },
) => (
  <section
    tw={[
      'card px-[18px] py-4 flex flex-col gap-3 min-w-0',
      tw,
    ]}
  >
    {(title || aside) && (
      <div tw='flex items-center justify-between gap-3'>
        {title && <h2 tw='m-0 text-[15px] font-semibold'>{title}</h2>}
        {aside}
      </div>
    )}
    {children}
  </section>
)

/** Uppercase small caption above a list */
export const Caption = ({ children }: { children: ComponentChildren }) => (
  <span tw='font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-content-tertiary'>
    {children}
  </span>
)

/**
 * Collapsible section (R4 body): open by default, native <details>.
 * The id is the anchor of the side navigation.
 */
export const Collapsible = (
  { id, title, count, children, open = true, alert }: {
    id: string
    title: string
    count?: ComponentChildren
    children: ComponentChildren
    open?: boolean
    alert?: boolean
  },
) => (
  <details
    id={id}
    open={open}
    tw={['group card rounded-[10px]', alert && 'border-err']}
    // anchor below the sticky top bar (no scroll-mt-* in Twind)
    style={{ scrollMarginTop: '72px' }}
  >
    <summary tw='list-none flex items-center gap-2 px-4 py-3 cursor-pointer select-none'>
      <ChevronRight tw='w-[15px] h-[15px] text-content-tertiary transition-transform group-open:rotate-90' />
      <h2 tw='m-0 text-[15px] font-semibold'>{title}</h2>
      {count !== undefined && (
        <span tw='text-[12.5px] text-content-tertiary'>{count}</span>
      )}
    </summary>
    {children}
  </details>
)

/** Table header / cell classes, shared by R1, R4 and R5 tables */
export const th = 'px-2.5 py-[9px] font-medium text-left'
export const td = 'px-2.5 py-3 align-middle'

export const TableWrap = (
  { children, minWidth = 720 }: {
    children: ComponentChildren
    minWidth?: number
  },
) => (
  <div tw='relative rounded-[10px] border border-border-primary bg-surface-elevated overflow-auto'>
    <table
      tw='w-full border-collapse text-[13px]'
      style={{ minWidth: `${minWidth}px` }}
    >
      {children}
    </table>
  </div>
)

export const THead = ({ children }: { children: ComponentChildren }) => (
  <thead>
    <tr tw='bg-surface-sunken text-content-tertiary text-[12px]'>
      {children}
    </tr>
  </thead>
)
