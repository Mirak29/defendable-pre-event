import {
  bottomTab,
  output,
  ownTests,
  panelHeight,
  rawOpen,
  setPanelResizer,
} from '/web/pages/workspace/workspace-state.ts'
import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleX,
  FlaskConical,
  PackageX,
  Scissors,
  Terminal,
  TimerOff,
} from '/web/assets/icons.tsx'
import { t } from '/web/lib/i18n.ts'

// dark terminal in both themes (fixed values of the prototype)
const C = {
  bg: 'oklch(0.17 0.018 278)',
  line: 'oklch(0.26 0.02 278)',
  text: 'oklch(0.88 0.01 278)',
  muted: 'oklch(0.62 0.015 278)',
  ok: 'oklch(0.78 0.14 150)',
  warn: 'oklch(0.83 0.13 80)',
  err: 'oklch(0.73 0.16 25)',
  str: 'oklch(0.8 0.1 55)',
  link: 'oklch(0.78 0.12 268)',
  raw: 'oklch(0.14 0.015 278)',
}

const statusIcons = {
  'circle-check': CircleCheck,
  'timer-off': TimerOff,
  'scissors': Scissors,
  'package-x': PackageX,
  'circle-x': CircleX,
} as const

const toneColor = { ok: C.ok, warn: C.warn, error: C.err }

/** "201 { alias: "promo" }" with string literals colored */
const Colored = ({ text }: { text: string }) => (
  <>
    {text.split(/("(?:[^"\\]|\\.)*")/).map((part, i) =>
      part.startsWith('"')
        ? <span key={i} style={{ color: C.str }}>{part}</span>
        : part
    )}
  </>
)

const Empty = ({ children }: { children: preact.ComponentChildren }) => (
  <div tw='font-main text-[12.5px]' style={{ color: C.muted }}>
    {children}
  </div>
)

const Output = () => {
  if (!output.value) {
    return (
      <Empty>
        {t(
          '« Exécuter » lance playground.ts dans un bac à sable : 10 s maximum, sans réseau.',
          '“Run” starts playground.ts in a sandbox: 10 s at most, no network.',
        )}
      </Empty>
    )
  }
  const { command, lines, status } = output.value
  const Icon = statusIcons[status.icon as keyof typeof statusIcons] ||
    CircleCheck
  return (
    <>
      <div style={{ color: C.muted }}>{command}</div>
      {lines.map((l, i) => (
        <div
          key={i}
          style={{
            color: l.tone === 'muted'
              ? C.muted
              : l.tone === 'error' || l.tone === 'indent-error'
              ? C.err
              : undefined,
            paddingLeft: l.tone === 'indent-error' ? '24px' : undefined,
          }}
        >
          <Colored text={l.text} />
        </div>
      ))}
      <div
        tw='mt-1.5 flex items-start gap-1.5 font-main text-[12.5px]'
        style={{ color: toneColor[status.tone] }}
      >
        <Icon tw='w-3.5 h-3.5 flex-none mt-0.5' />
        {status.text}
      </div>
    </>
  )
}

const OwnTests = () => {
  const own = ownTests.value
  if (!own) {
    return (
      <Empty>
        {t(
          '« Mes tests » lance deno test src/.',
          '“My tests” runs deno test src/.',
        )}
      </Empty>
    )
  }
  return (
    <>
      <div tw='mb-1' style={{ color: C.muted }}>
        $ deno test src/ · {own.passed}{' '}
        {t(`réussi${own.passed > 1 ? 's' : ''}`, 'passed')} · {own.failed}{' '}
        {t(`échoué${own.failed > 1 ? 's' : ''}`, 'failed')}
      </div>
      {own.tests.map((test) => {
        const Icon = test.ok ? CircleCheck : CircleX
        const color = test.ok ? C.ok : C.err
        return (
          <div key={test.name} tw='flex items-center gap-2'>
            <Icon tw='w-[13px] h-[13px] flex-none' style={{ color }} />
            <span tw='w-[52px] font-main text-[11.5px]' style={{ color }}>
              {test.ok ? t('Réussi', 'Passed') : t('Échoué', 'Failed')}
            </span>
            <span tw='flex-1'>{test.name}</span>
            <span style={{ color: C.muted }}>{test.duration}</span>
          </div>
        )
      })}
      <button
        type='button'
        onClick={() => rawOpen.value = !rawOpen.value}
        aria-expanded={rawOpen.value}
        tw='mt-2 inline-flex items-center gap-1 font-main font-medium text-[12px] cursor-pointer'
        style={{ color: C.link }}
      >
        {rawOpen.value
          ? <ChevronDown tw='w-[13px] h-[13px]' />
          : <ChevronRight tw='w-[13px] h-[13px]' />}
        {t('Sortie brute', 'Raw output')}
      </button>
      {rawOpen.value && (
        <pre
          tw='mt-1.5 mb-0 px-2.5 py-2 rounded-md whitespace-pre-wrap font-mono'
          style={{ background: C.raw, color: 'oklch(0.75 0.015 278)' }}
        >
          {own.raw}
        </pre>
      )}
    </>
  )
}

const TabButton = (
  { on, onClick, children }: {
    on: boolean
    onClick: () => void
    children: preact.ComponentChildren
  },
) => (
  <button
    type='button'
    role='tab'
    aria-selected={on}
    onClick={onClick}
    tw='inline-flex items-center gap-1.5 h-[26px] px-2.5 rounded-md font-main text-[12.5px] font-medium cursor-pointer'
    style={{
      background: on ? C.line : 'transparent',
      color: on ? 'oklch(0.93 0.008 278)' : 'oklch(0.65 0.015 278)',
    }}
  >
    {children}
  </button>
)

/** Bottom panel of C2: read-only terminal, no input possible */
export const ConsolePanel = () => (
  <>
    <div
      ref={setPanelResizer}
      role='separator'
      aria-orientation='horizontal'
      aria-label={t('Redimensionner le panneau', 'Resize the panel')}
      tw='h-[5px] flex-none cursor-row-resize border-t border-border-primary'
      style={{ background: C.bg, touchAction: 'none' }}
    />
    <section
      aria-label='Console'
      tw='flex-none flex flex-col'
      style={{
        height: `${panelHeight.value}px`,
        background: C.bg,
        color: C.text,
      }}
    >
      <div
        role='tablist'
        tw='h-[34px] flex-none flex items-center gap-0.5 px-2.5'
        style={{ borderBottom: `1px solid ${C.line}` }}
      >
        <TabButton
          on={bottomTab.value === 'out'}
          onClick={() => bottomTab.value = 'out'}
        >
          <Terminal tw='w-[13px] h-[13px]' />
          {t('Sortie', 'Output')}
        </TabButton>
        <TabButton
          on={bottomTab.value === 'mine'}
          onClick={() => bottomTab.value = 'mine'}
        >
          <FlaskConical tw='w-[13px] h-[13px]' />
          {t('Mes tests', 'My tests')}
          {ownTests.value && (
            <span
              tw='font-mono text-[11px]'
              style={{ color: ownTests.value.failed ? C.err : C.ok }}
            >
              {ownTests.value.passed}/
              {ownTests.value.passed + ownTests.value.failed}
            </span>
          )}
        </TabButton>
        <span tw='flex-1' />
        <span tw='font-main text-[11.5px]' style={{ color: C.muted }}>
          {t('Lecture seule', 'Read only')}
        </span>
      </div>
      <div
        role='log'
        tw='flex-1 min-h-0 overflow-auto px-4 py-2.5 font-mono text-[12.5px] leading-[1.65]'
      >
        {bottomTab.value === 'out' ? <Output /> : <OwnTests />}
      </div>
    </section>
  </>
)
