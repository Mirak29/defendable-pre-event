import { paths } from '/web/paths.ts'
import { signal } from '@preact/signals'
import { A, navigate } from '/web/lib/router-signal.ts'
import { submitBuild } from '/web/lib/candidate-store.ts'
import {
  evalResults,
  files,
  ownTests,
} from '/web/pages/workspace/workspace-state.ts'
import { notify } from '/web/ui/notifications.tsx'
import { demoCandidate } from '/fixtures/demo.ts'
import { formatClock } from '/web/lib/format.ts'
import { CloseButton, ModalDialog } from '/web/ui/dialog.tsx'
import {
  ArrowRight,
  CircleCheck,
  Presentation,
  Send,
  Timer,
  TimerOff,
} from '/web/assets/icons.tsx'
import { t, tv } from '/web/lib/i18n.ts'
import { demoMode } from '/web/lib/demo.ts'

const TOOLS = [
  'ChatGPT',
  'Claude',
  'GitHub Copilot',
  'Gemini',
  'Cursor',
  'Autre',
  'Aucun',
] as const

const tools = signal<string[]>([])
const otherTool = signal('')

const toggle = (tool: string) => {
  if (tool === 'Aucun') {
    tools.value = tools.value.includes('Aucun') ? [] : ['Aucun']
    return
  }
  const list = tools.value.filter((name) => name !== 'Aucun')
  tools.value = list.includes(tool)
    ? list.filter((name) => name !== tool)
    : [...list, tool]
}

const submitting = signal(false)

/** "Soumettre définitivement": the code is frozen, then C4 */
export const submitDeclaration = async () => {
  if (!tools.peek().length || submitting.peek()) return
  submitting.value = true
  try {
    await submitBuild(tools.peek(), otherTool.peek() || undefined, files.peek())
    navigate({ href: paths.rules, params: { dialog: null } })
  } catch (err) {
    notify({ status: 'failure', description: (err as Error).message })
  } finally {
    submitting.value = false
  }
}

/** guided demo: the AI tools of the demo candidate */
export const fillExampleTools = () =>
  tools.peek().length || (tools.value = [...demoCandidate.declaredAiTools])

/**
 * guided demo, step 4: declare the tools of the demo candidate and submit.
 * Shown inside the dialog: a modal makes the rest of the page (the floating
 * demo panel included) inert, so its « Étape suivante » could not be clicked.
 */
export const submitExample = () => {
  fillExampleTools()
  submitDeclaration()
}

const Stat = (
  { label, children, ok }: {
    label: string
    children: preact.ComponentChildren
    ok?: boolean
  },
) => (
  <div tw='px-3 py-2.5 border-r border-border-primary last:border-r-0'>
    <div tw='text-[12px] text-content-tertiary'>{label}</div>
    <div
      tw={[
        'flex items-center gap-1.5 font-mono font-bold text-[15px]',
        ok ? 'text-ok' : 'text-content-primary',
      ]}
    >
      {children}
    </div>
  </div>
)

/**
 * C3 — submission. When the time is up it opens by itself and cannot be
 * closed: the code is already submitted, only the AI declaration remains.
 */
export const SubmitDialog = (
  { remainingSec, expired }: { remainingSec: number; expired: boolean },
) => {
  const canSubmit = tools.value.length > 0 && !submitting.value
  const results = evalResults.value
  const evalPassed = results?.filter((r) => r.passed).length ?? 0
  const own = ownTests.value
  return (
    <ModalDialog
      id='submit'
      closable={!expired}
      bare
      tw='w-[580px]'
    >
      <div tw='px-6 pt-5 flex gap-3 items-start'>
        <span
          tw={[
            'w-9 h-9 flex-none rounded-[9px] inline-flex items-center justify-center',
            expired
              ? 'bg-warn-soft text-warn'
              : 'bg-accent-soft text-accent-text',
          ]}
        >
          {expired
            ? <TimerOff tw='w-[18px] h-[18px]' />
            : <Send tw='w-[18px] h-[18px]' />}
        </span>
        <div tw='flex-1'>
          <h2 tw='m-0 font-main text-[17px] font-semibold tracking-[-0.01em]'>
            {expired
              ? t(
                'Temps écoulé : votre code a été soumis automatiquement.',
                'Time is up: your code was submitted automatically.',
              )
              : t('Soumettre votre solution ?', 'Submit your solution?')}
          </h2>
          <p tw='mt-1.5 mb-0 text-content-secondary text-[13.5px]'>
            {expired
              ? t(
                'Les 3 tests cachés vont être exécutés, puis votre code sera analysé pour préparer vos 10 questions. Déclarez les outils IA utilisés pour continuer.',
                'The 3 hidden tests will run, then your code will be analysed to prepare your 10 questions. Declare the AI tools you used to continue.',
              )
              : t(
                'Votre code sera figé. Les 3 tests cachés seront exécutés, puis votre code sera analysé pour préparer vos 10 questions.',
                'Your code will be frozen. The 3 hidden tests will run, then your code will be analysed to prepare your 10 questions.',
              )}
          </p>
        </div>
        {!expired && <CloseButton dataTest='submit-close-btn' />}
      </div>
      <div tw='mx-6 mt-[18px] grid grid-cols-3 border border-border-primary rounded-lg overflow-hidden'>
        <Stat
          label={t('Tests d’évaluation', 'Evaluation tests')}
          ok={!!results && evalPassed === results.length}
        >
          {results
            ? (
              <>
                <CircleCheck tw='w-[15px] h-[15px]' />
                {evalPassed}/{results.length}
              </>
            )
            : t('non lancés', 'not run')}
        </Stat>
        <Stat label={t('Mes tests', 'My tests')} ok={!!own && !own.failed}>
          {own
            ? (
              <>
                <CircleCheck tw='w-[15px] h-[15px]' />
                {own.passed}/{own.passed + own.failed}
              </>
            )
            : t('non lancés', 'not run')}
        </Stat>
        <Stat label={t('Temps restant', 'Time left')}>
          <Timer tw='w-[15px] h-[15px] text-content-tertiary' />
          {formatClock(expired ? 0 : remainingSec, false)}
        </Stat>
      </div>
      <fieldset tw='mx-6 mt-[18px] p-0 border-0'>
        <legend tw='text-[13.5px] font-semibold p-0 mb-0.5'>
          {t(
            'Quels outils IA avez-vous utilisés ?',
            'Which AI tools did you use?',
          )} <span tw='text-err font-medium'>*</span>
        </legend>
        <p tw='m-0 mb-2.5 text-[12.5px] text-content-tertiary'>
          {t(
            'Obligatoire. Cette déclaration n’est pas pénalisante.',
            'Required. This declaration carries no penalty.',
          )}
        </p>
        <div tw='grid grid-cols-2 sm:grid-cols-3 gap-1.5'>
          {TOOLS.map((tool) => {
            const on = tools.value.includes(tool)
            return (
              <label
                key={tool}
                tw={[
                  'flex items-center gap-2 h-9 px-2.5 rounded-lg border text-[13px] cursor-pointer',
                  on
                    ? 'border-accent bg-accent-soft'
                    : 'border-border-primary bg-surface-elevated',
                ]}
              >
                <input
                  type='checkbox'
                  data-test={`tool-${tool}`}
                  checked={on}
                  onChange={() => toggle(tool)}
                  tw='w-[15px] h-[15px] m-0'
                  style={{ accentColor: 'var(--color-accent)' }}
                />
                {tv(tool)}
              </label>
            )
          })}
        </div>
        {tools.value.includes('Autre') && (
          <input
            value={otherTool.value}
            onInput={(e) => otherTool.value = e.currentTarget.value}
            placeholder={t('Précisez l’outil', 'Name the tool')}
            aria-label={t('Autre outil', 'Other tool')}
            tw='input mt-2 h-8 py-0 text-[13px]'
          />
        )}
      </fieldset>
      {demoMode.value && !expired && (
        <div
          data-test='demo-submit-step'
          tw='mx-6 mt-4 flex items-center gap-2 px-3 py-2 rounded-lg border border-accent bg-accent-soft text-[12.5px]'
        >
          <Presentation tw='w-[15px] h-[15px] flex-none text-accent-text' />
          <span tw='flex-1 min-w-0'>
            <span tw='font-semibold'>{t('Démo guidée', 'Guided demo')}</span>
            {' · '}
            {t('étape', 'step')} 4/6 · {t('Soumettre', 'Submit')}
          </span>
          <button
            type='button'
            tw='btn btn-secondary h-7 text-[12.5px]'
            onClick={submitExample}
          >
            {t('Étape suivante', 'Next step')}
            <ArrowRight tw='w-3.5 h-3.5' />
          </button>
        </div>
      )}
      <div tw='mt-5 px-6 py-3.5 border-t border-border-primary bg-surface-sunken flex items-center justify-end gap-2 flex-wrap'>
        {!tools.value.length && (
          <span tw='mr-auto text-[12.5px] text-content-tertiary'>
            {t('Cochez au moins une réponse.', 'Tick at least one answer.')}
          </span>
        )}
        {!expired && (
          <A params={{ dialog: null }} tw='btn btn-secondary h-8 text-[13px]'>
            {t('Continuer à coder', 'Keep coding')}
          </A>
        )}
        <button
          type='button'
          tw='btn btn-primary h-8 text-[13px]'
          data-test='confirm-submit-btn'
          disabled={!canSubmit}
          onClick={() => {
            submitDeclaration()
          }}
        >
          {expired
            ? t('Continuer vers les questions', 'Continue to the questions')
            : t('Soumettre définitivement', 'Submit for good')}
        </button>
      </div>
    </ModalDialog>
  )
}
