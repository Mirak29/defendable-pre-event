import { url } from '/web/lib/router-signal.ts'
import { navigate } from '/web/lib/router-signal.ts'
import { A } from '/web/lib/router-signal.ts'

type TabsProps = {
  tabs: Record<string, preact.FunctionComponent>
  paramName?: string
  /** Optional content shown on the right of the tab bar for a given tab. */
  actions?: Record<string, preact.ComponentChildren>
}

/** Underlined tabs, the active one is stored in the URL (like tournament) */
export function Tabs({ tabs, paramName = 'tab', actions }: TabsProps) {
  const keys = Object.keys(tabs)
  const first = keys[0]
  const slug = (key: string) => key.toLowerCase().replace(/\s+/g, '-')
  const param = url.params[paramName]?.toLowerCase()
  if (param && !keys.map(slug).includes(param)) {
    navigate({ params: { [paramName]: null }, replace: true })
    return null
  }
  const active = keys.find((k) => slug(k) === param) || first
  const Content = tabs[active]
  return (
    <div tw='w-full flex flex-col min-h-0'>
      <div
        role='tablist'
        tw='flex-none flex items-center gap-1 px-2 border-b border-border-primary'
      >
        {keys.map((key) => (
          <A
            key={key}
            role='tab'
            aria-selected={active === key}
            params={{ [paramName]: key === first ? null : slug(key) }}
            replace
            data-test={`tab-${slug(key)}`}
            tw={[
              'h-10 px-2.5 -mb-px flex items-center text-[13px] no-underline border-b-2',
              active === key
                ? 'border-accent text-content-primary font-semibold'
                : 'border-transparent text-content-secondary font-medium hover:text-content-primary',
            ]}
          >
            {key}
          </A>
        ))}
        {actions?.[active] && <div tw='ml-auto'>{actions[active]}</div>}
      </div>
      {Content && (
        <div tw='flex-1 min-h-0'>
          <Content />
        </div>
      )}
    </div>
  )
}
