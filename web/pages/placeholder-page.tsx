import { A, url } from '/web/lib/router-signal.ts'
import { Construction } from '/web/assets/icons.tsx'
import { type Screen, screens } from '/web/screens.ts'

// Temporary page rendered for every screen that is not implemented yet.
export const makePlaceholder = (screen: Screen) => () => (
  <main tw='max-w-[720px] w-full mx-auto px-4 sm:px-8 py-12 sm:py-24 flex flex-col gap-6'>
    <span tw='badge badge-neutral self-start'>
      <Construction tw='w-3.5 h-3.5' />
      {screen.code} · à implémenter ({screen.task})
    </span>
    <h1 tw='text-[22px] sm:text-[28px] font-medium m-0'>{screen.title}</h1>
    <p tw='text-content-secondary m-0'>
      Route <code tw='font-mono text-[13px]'>{url.path}</code> · prototype{' '}
      <code tw='font-mono text-[13px]'>{screen.prototype}</code>
    </p>
    <nav tw='flex flex-wrap gap-2'>
      {screens.map((s) => (
        <A key={s.path} href={s.path} tw='btn btn-secondary btn-sm'>
          {s.code}
        </A>
      ))}
    </nav>
  </main>
)
