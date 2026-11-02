import type { Visibility } from '/web/types.ts'
import { CircleCheck, CircleX, EyeOff, Minus } from '/web/assets/icons.tsx'
import { t, tv } from '/web/lib/i18n.ts'

export const VisibilityBadge = ({ visibility }: { visibility: Visibility }) => (
  <span tw='inline-flex items-center gap-1 h-[18px] px-1.5 rounded-[5px] border border-border-strong text-content-secondary text-[11px]'>
    {visibility === 'caché' && <EyeOff tw='w-[11px] h-[11px]' />}
    {tv(visibility)}
  </span>
)

type TestResultRowProps = {
  id: string
  title: string
  visibility: Visibility
  /** undefined: not run yet */
  passed?: boolean
  durationMs?: number
  expected?: string
  received?: string
  request?: string
}

/**
 * Test result line (brief §2.8): icon, id, title, public/hidden, duration.
 * A failed test is unfolded with "Attendu : 400 · Reçu : 201" and the request.
 */
export const TestResultRow = (
  { id, title, visibility, passed, durationMs, expected, received, request }:
    TestResultRowProps,
) => (
  <div tw='border-t border-border-primary first:border-t-0'>
    <div tw='flex items-center gap-2.5 h-9 px-3.5 text-[13px]'>
      {passed === undefined
        ? (
          <Minus
            tw='w-4 h-4 flex-none text-content-tertiary'
            aria-label={t('Pas encore lancé', 'Not run yet')}
          />
        )
        : passed
        ? (
          <CircleCheck
            tw='w-4 h-4 flex-none text-ok'
            aria-label={t('Réussi', 'Passed')}
          />
        )
        : (
          <CircleX
            tw='w-4 h-4 flex-none text-err'
            aria-label={t('Échoué', 'Failed')}
          />
        )}
      <span tw='w-7 flex-none font-mono font-semibold text-[12px] text-content-secondary'>
        {id}
      </span>
      <span tw='flex-1 min-w-0 truncate'>{title}</span>
      <VisibilityBadge visibility={visibility} />
      <span tw='w-10 flex-none text-right font-mono text-[11.5px] text-content-tertiary'>
        {durationMs !== undefined ? `${durationMs} ms` : ''}
      </span>
    </div>
    {passed === false && (expected || request || received) && (
      <div tw='pl-[52px] pr-3.5 pt-2 pb-2.5 bg-err-soft text-[12.5px]'>
        {!expected && received && (
          <div tw='font-semibold text-err'>{received}</div>
        )}
        {expected && (
          <div tw='font-semibold text-err'>
            {t('Attendu :', 'Expected:')} <span tw='font-mono'>{expected}</span>
            {received && (
              <>
                {' '}· {t('Reçu :', 'Received:')}{' '}
                <span tw='font-mono'>{received}</span>
              </>
            )}
          </div>
        )}
        {request && (
          <div tw='mt-[3px] font-mono text-[12px] text-content-secondary break-all'>
            {request}
          </div>
        )}
      </div>
    )}
  </div>
)

/** Bordered list of TestResultRow */
export const TestResultList = (
  { children }: { children: preact.ComponentChildren },
) => (
  <div tw='rounded-[10px] border border-border-primary bg-surface-elevated overflow-hidden'>
    {children}
  </div>
)
