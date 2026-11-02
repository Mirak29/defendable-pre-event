import { me } from '/web/lib/candidate-store.ts'
import {
  evalResults,
  lastEvalAgo,
  rightOpen,
  rightTab,
  rightWidth,
  running,
  setSideResizer,
} from '/web/pages/workspace/workspace-state.ts'
import { TestResultList, TestResultRow } from '/web/ui/test-result.tsx'
import {
  CircleCheck,
  CircleX,
  EyeOff,
  ListChecks,
  PanelRightClose,
  PanelRightOpen,
} from '/web/assets/icons.tsx'
import { t } from '/web/lib/i18n.ts'

const methodColor = {
  GET: 'text-code-kw',
  POST: 'text-code-str',
  DELETE: 'text-err',
} as const

const Heading = ({ children }: { children: string }) => (
  <h3 tw='m-0 mb-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-content-tertiary'>
    {children}
  </h3>
)

/** "Énoncé": the requirements without their "Pourquoi" (the statement
 * holds the rules the tests check: status codes, business rules) */
const Brief = () => {
  const spec = me.value?.assessment
  if (!spec) return null
  return (
    <div tw='px-[18px] pt-4 pb-6 flex flex-col gap-[18px] text-[13px] leading-[1.55]'>
      <div tw='flex gap-2 px-[11px] py-[9px] rounded-lg bg-accent-soft text-accent-text text-[12.5px] font-medium'>
        <CircleCheck tw='w-[15px] h-[15px] flex-none mt-px' />
        {t(
          'IA autorisée pendant cette phase : assistants, documentation et Internet.',
          'AI allowed during this phase: assistants, documentation and the Internet.',
        )}
      </div>
      <div>
        <Heading>{t('Contexte', 'Context')}</Heading>
        <p tw='m-0 text-content-secondary'>{spec.candidateBrief.context}</p>
      </div>
      <div>
        <Heading>{t('Mission', 'Task')}</Heading>
        <p tw='m-0 text-content-secondary'>{spec.candidateBrief.mission}</p>
      </div>
      <div>
        <Heading>{t('Exigences', 'Requirements')}</Heading>
        <ol tw='list-none m-0 p-0 flex flex-col gap-1.5'>
          {spec.requirements.map((r) => (
            <li key={r.id} tw='flex gap-2.5'>
              <span tw='w-[22px] flex-none pt-px font-mono font-bold text-[12px] text-content-tertiary'>
                {r.id}
              </span>
              <span>
                <span tw='font-medium'>{r.title}.</span>{' '}
                <span tw='text-content-secondary'>{r.statement}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div>
        <Heading>{t('Contrat d’API', 'API contract')}</Heading>
        <div tw='border border-border-primary rounded-lg overflow-hidden'>
          {spec.routes.map((r) => (
            <div
              key={r.method + r.path}
              tw='grid gap-x-2 gap-y-1 px-2.5 py-2 border-b border-border-primary last:border-b-0'
              style={{ gridTemplateColumns: '62px 1fr' }}
            >
              <span
                tw={[
                  'font-mono font-bold text-[11.5px]',
                  methodColor[r.method],
                ]}
              >
                {r.method}
              </span>
              <span tw='font-mono text-[12px]'>{r.path}</span>
              <span />
              <span tw='text-[12px] text-content-secondary'>
                {r.description} ·{' '}
                <span tw='font-mono'>{r.codes.join(' · ')}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <Heading>{t('Contraintes', 'Constraints')}</Heading>
        <ul tw='m-0 pl-[18px] text-content-secondary flex flex-col gap-[3px]'>
          {spec.constraints.map((c) => <li key={c}>{c}</li>)}
        </ul>
      </div>
    </div>
  )
}

/** "Tests d'évaluation": the public tests, the hidden ones run later */
const EvalTests = () => {
  const spec = me.value?.assessment
  if (!spec) return null
  const tests = spec.publicTests
  const results = evalResults.value
  const byId = new Map(results?.map((r) => [r.id, r]))
  const passed = results?.filter((r) => r.passed).length ?? 0
  return (
    <div tw='px-3.5 pt-3.5 pb-6 flex flex-col gap-2.5'>
      <div tw='flex items-center gap-2 text-[13px] flex-wrap'>
        {!results
          ? (
            <>
              <ListChecks tw='w-4 h-4 text-content-tertiary' />
              <span tw='text-content-secondary'>
                {running.value === 'eval'
                  ? t('Exécution des tests…', 'Running the tests…')
                  : t(
                    'Pas encore lancés : « Tests d’évaluation » dans la barre.',
                    'Not run yet: “Evaluation tests” in the bar.',
                  )}
              </span>
            </>
          )
          : (
            <>
              {passed === tests.length
                ? <CircleCheck tw='w-4 h-4 text-ok' />
                : <CircleX tw='w-4 h-4 text-err' />}
              <span tw='font-semibold'>
                {passed}/{tests.length} {t('réussis', 'passed')}
              </span>
              <span tw='text-content-tertiary'>
                · {t('dernier lancement', 'last run')} {lastEvalAgo.value}
              </span>
            </>
          )}
      </div>
      <TestResultList>
        {tests.map((t) => {
          const r = byId.get(t.id)
          return (
            <TestResultRow
              key={t.id}
              id={t.id}
              title={t.title}
              visibility={t.visibility}
              passed={r?.passed}
              durationMs={r?.durationMs}
              expected={r?.expected}
              received={r?.received}
              request={r?.request}
            />
          )
        })}
      </TestResultList>
      <div tw='flex gap-2 px-[11px] py-[9px] rounded-lg bg-surface-sunken border border-border-primary text-content-secondary text-[12.5px]'>
        <EyeOff tw='w-[15px] h-[15px] flex-none mt-px' />
        {t(
          `${spec.hiddenCount} tests cachés seront exécutés à la soumission.`,
          `${spec.hiddenCount} hidden tests will run on submission.`,
        )}
      </div>
    </div>
  )
}

const tabTw = (on: boolean) => [
  'h-10 px-2.5 -mb-px border-b-2 text-[13px] cursor-pointer',
  on
    ? 'border-accent text-content-primary font-semibold'
    : 'border-transparent text-content-secondary font-medium hover:text-content-primary',
]

/** Right column of C2 (360 px, collapsible) */
export const SidePanel = () => {
  if (!rightOpen.value) {
    return (
      <aside tw='w-10 flex-none border-l border-border-primary bg-surface-elevated flex flex-col items-center pt-1.5'>
        <button
          type='button'
          onClick={() => rightOpen.value = true}
          aria-label={t('Déplier le panneau Énoncé', 'Open the Brief panel')}
          title={t('Énoncé et tests', 'Brief and tests')}
          tw='btn btn-ghost w-7 h-7 px-0'
        >
          <PanelRightOpen tw='w-[15px] h-[15px]' />
        </button>
      </aside>
    )
  }
  return (
    <aside
      tw='relative flex-none border-l border-border-primary bg-surface-elevated flex flex-col min-h-0'
      style={{ width: `${rightWidth.value}px` }}
    >
      <div
        ref={setSideResizer}
        role='separator'
        aria-orientation='vertical'
        aria-label={t(
          'Redimensionner le panneau Énoncé',
          'Resize the Brief panel',
        )}
        title={t('Redimensionner', 'Resize')}
        tw='absolute -left-[3px] top-0 bottom-0 w-[6px] z-10 cursor-col-resize hover:bg-accent-soft'
        style={{ touchAction: 'none' }}
      />
      <div
        role='tablist'
        tw='h-10 flex-none flex items-end gap-1 pl-3 pr-2 border-b border-border-primary'
      >
        <button
          type='button'
          role='tab'
          aria-selected={rightTab.value === 'brief'}
          onClick={() => rightTab.value = 'brief'}
          tw={tabTw(rightTab.value === 'brief')}
        >
          {t('Énoncé', 'Brief')}
        </button>
        <button
          type='button'
          role='tab'
          aria-selected={rightTab.value === 'tests'}
          onClick={() => rightTab.value = 'tests'}
          tw={tabTw(rightTab.value === 'tests')}
        >
          {t('Tests d’évaluation', 'Evaluation tests')}
        </button>
        <span tw='flex-1' />
        <button
          type='button'
          onClick={() => rightOpen.value = false}
          aria-label={t('Replier le panneau', 'Collapse the panel')}
          title={t('Replier', 'Collapse')}
          tw='btn btn-ghost w-7 h-7 px-0 self-center'
        >
          <PanelRightClose tw='w-[15px] h-[15px]' />
        </button>
      </div>
      <div tw='flex-1 min-h-0 overflow-auto'>
        {rightTab.value === 'brief' ? <Brief /> : <EvalTests />}
      </div>
    </aside>
  )
}
