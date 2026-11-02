import { CloudCheck, CloudOff, Timer as TimerIcon } from '/web/assets/icons.tsx'
import { formatClock } from '/web/lib/format.ts'
import { Spinner } from '/web/ui/spinner.tsx'
import { t } from '/web/lib/i18n.ts'

/**
 * Countdown (brief §2.10): hh:mm:ss (global) or mm:ss (per question).
 * Amber under 20 % of the total time, red under 30 seconds.
 */
export const Timer = (
  { remainingSec, totalSec, withHours = true }: {
    remainingSec: number
    totalSec: number
    withHours?: boolean
  },
) => {
  const level = remainingSec < 30
    ? 'danger'
    : remainingSec < totalSec * 0.2
    ? 'warn'
    : 'normal'
  return (
    <span
      role='timer'
      aria-label={level === 'danger'
        ? t('Moins de 30 secondes restantes', 'Less than 30 seconds left')
        : t('Temps restant', 'Time left')}
      tw={[
        'inline-flex items-center gap-[5px] h-7 px-[9px] rounded-lg border font-mono font-semibold text-[13.5px] tabular-nums',
        level === 'danger'
          ? 'bg-err-soft text-err border-err'
          : level === 'warn'
          ? 'bg-warn-soft text-warn border-border-primary'
          : 'bg-surface-sunken text-content-primary border-border-primary',
      ]}
    >
      <TimerIcon tw='w-3.5 h-3.5' />
      {formatClock(remainingSec, withHours)}
    </span>
  )
}

export type SaveState = 'saved' | 'saving' | 'offline'

/** Save indicator (brief §2.11) */
export const SaveIndicator = (
  { state, savedAgo = t('il y a 2 s', '2 s ago') }: {
    state: SaveState
    savedAgo?: string
  },
) => {
  if (state === 'saving') {
    return (
      <span tw='inline-flex items-center gap-1.5 text-[12.5px] text-content-tertiary whitespace-nowrap'>
        <Spinner />
        {t('Enregistrement…', 'Saving…')}
      </span>
    )
  }
  if (state === 'offline') {
    return (
      <span tw='inline-flex items-center gap-[5px] h-6 px-2 rounded-md bg-warn-soft text-warn font-medium text-[12.5px] whitespace-nowrap'>
        <CloudOff tw='w-3.5 h-3.5' />
        {t('Hors ligne, nouvelle tentative…', 'Offline, retrying…')}
      </span>
    )
  }
  return (
    <span tw='inline-flex items-center gap-[5px] text-[12.5px] text-content-tertiary whitespace-nowrap'>
      <CloudCheck tw='w-3.5 h-3.5' />
      {t('Enregistré', 'Saved')} {savedAgo}
    </span>
  )
}
