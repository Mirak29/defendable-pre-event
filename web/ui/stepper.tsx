import type { AiFailure, AiTrace } from '/web/types.ts'
import { formatLatency } from '/web/lib/format.ts'
import {
  Check,
  OctagonX,
  RotateCcw,
  TriangleAlert,
  X,
} from '/web/assets/icons.tsx'
import { AiTraceBadge } from '/web/ui/ai-trace.tsx'
import { Spinner } from '/web/ui/spinner.tsx'
import { t } from '/web/lib/i18n.ts'
import { tm } from '/web/lib/messages.ts'

export type StepState = 'wait' | 'run' | 'done' | 'error'

export type OperationStep = {
  label: string
  state: StepState
  /** shown on steps that call a model */
  trace?: AiTrace
  /** overrides the default state label */
  detail?: string
}

const stateLabels = (): Record<StepState, string> => ({
  wait: t('En attente', 'Waiting'),
  run: t('En cours…', 'Running…'),
  done: t('Terminé', 'Done'),
  error: t('Erreur', 'Error'),
})

const dotStyles: Record<StepState, string> = {
  wait: 'text-content-tertiary bg-surface-sunken border border-border-strong',
  run: 'text-accent bg-accent-soft',
  done: 'text-ok bg-ok-soft',
  error: 'text-err bg-err-soft',
}

/** Long operation stepper (brief §2.12): vertical steps with their state */
export const OperationStepper = ({ steps }: { steps: OperationStep[] }) => (
  <ol tw='list-none m-0 p-0 flex flex-col'>
    {steps.map((step, i) => (
      <li
        key={step.label}
        tw='grid gap-3'
        style={{ gridTemplateColumns: '22px 1fr' }}
      >
        <span tw='flex flex-col items-center'>
          <span
            tw={[
              'w-[22px] h-[22px] flex-none rounded-full inline-flex items-center justify-center',
              dotStyles[step.state],
            ]}
          >
            {step.state === 'run' && <Spinner />}
            {step.state === 'done' && <Check tw='w-3 h-3' stroke-width={2.5} />}
            {step.state === 'error' && <X tw='w-3 h-3' stroke-width={2.5} />}
          </span>
          {i < steps.length - 1 && (
            <span tw='w-px flex-1 min-h-[12px] bg-border-strong' />
          )}
        </span>
        <span tw='pt-px pb-3 flex flex-col gap-[3px]'>
          <span
            tw={[
              'text-[13px] font-medium',
              step.state === 'wait'
                ? 'text-content-tertiary'
                : step.state === 'error'
                ? 'text-err'
                : 'text-content-primary',
            ]}
          >
            {step.label}
          </span>
          <span tw='text-[12px] text-content-tertiary'>
            {step.detail ?? stateLabels()[step.state]}
          </span>
          {step.trace && step.state !== 'wait' && (
            <span>
              <AiTraceBadge trace={step.trace} />
            </span>
          )}
        </span>
      </li>
    ))}
  </ol>
)

/**
 * AI error (brief §2.13): amber banner while retrying with the fallback
 * model, red banner with "Réessayer" on final failure.
 */
/** « Pourquoi ? »: every failed attempt, model by model */
export const FailureList = ({ failures }: { failures: AiFailure[] }) => (
  <details tw='text-[12.5px]'>
    <summary tw='cursor-pointer font-medium'>
      {t('Pourquoi ?', 'Why?')} {failures.length} {failures.length > 1
        ? t('tentatives échouées', 'failed attempts')
        : t('tentative échouée', 'failed attempt')}
    </summary>
    <ol tw='m-0 mt-1.5 pl-[18px] flex flex-col gap-1'>
      {failures.map((f, i) => (
        <li key={i}>
          <strong tw='font-semibold'>{f.model}</strong> : {tm(f.reason)}
          <span tw='text-content-tertiary'>· {formatLatency(f.ms)}</span>
          {f.detail && (
            <span
              title={f.detail}
              tw='block font-mono text-[11.5px] text-content-tertiary truncate'
            >
              {f.detail}
            </span>
          )}
        </li>
      ))}
    </ol>
  </details>
)

export const AiErrorBanner = (
  { final, onRetry, message, reason, failures }: {
    final?: boolean
    onRetry?: () => void
    /** final: what failed, in words ("Les modèles sont surchargés…") */
    message?: string
    /** fallback: why the main model failed */
    reason?: string
    failures?: AiFailure[]
  },
) =>
  final
    ? (
      <div
        role='alert'
        tw='flex flex-col gap-2 px-3 py-2.5 rounded-lg bg-err-soft border border-err text-[13px]'
      >
        <div tw='flex items-center gap-2.5'>
          <OctagonX tw='w-4 h-4 flex-none text-err' />
          <span tw='flex-1'>
            <strong tw='font-semibold text-err'>
              {t('Échec de l’appel au modèle.', 'The model call failed.')}
            </strong>
            {message && <>{' '}{tm(message)}</>}
          </span>
          <button
            type='button'
            onClick={onRetry}
            tw='btn h-[30px] px-3 rounded-[7px] border-err bg-surface-elevated text-err text-[12.5px] font-semibold hover:bg-err-soft'
          >
            <RotateCcw tw='w-[13px] h-[13px]' />
            {t('Réessayer', 'Retry')}
          </button>
        </div>
        {failures?.length ? <FailureList failures={failures} /> : null}
      </div>
    )
    : (
      <div
        role='alert'
        tw='flex gap-2 px-3 py-2.5 rounded-lg bg-warn-soft border border-warn-line text-[13px]'
      >
        <TriangleAlert tw='w-[15px] h-[15px] flex-none mt-0.5 text-warn' />
        <span>
          {t('Le modèle n’a pas répondu', 'The model did not answer')}
          {reason ? ` (${tm(reason)})` : ''}. {t(
            'Nouvelle tentative avec le modèle de repli…',
            'Trying again with the fallback model…',
          )}
        </span>
      </div>
    )

/** stepper detail of a step running on the fallback model */
export const fallbackDetail = (reason?: string) =>
  reason ? `${t('Repli après :', 'Fallback after:')} ${tm(reason)}` : t(
    'Nouvelle tentative (modèle de repli)…',
    'Trying again (fallback model)…',
  )
