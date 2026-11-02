import { useEffect, useRef, useState } from 'npm:preact/hooks'
import type { AiTrace } from '/web/types.ts'
import { History, Sparkles, TriangleAlert } from '/web/assets/icons.tsx'
import { formatDateTime, formatInt, formatLatency } from '/web/lib/format.ts'
import { t } from '/web/lib/i18n.ts'
import { tm } from '/web/lib/messages.ts'

const POPOVER_WIDTH = 280
const POPOVER_HEIGHT = 330

/**
 * AI trace badge (brief §2.2): violet, small, clickable.
 * The popover lists model, location, latency, tokens and timestamp.
 * Answers served from the replay cache are shown in grey.
 */
export const AiTraceBadge = ({ trace }: { trace: AiTrace }) => {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<Record<string, string>>({})
  const root = useRef<HTMLSpanElement>(null)
  const cache = !!trace.replay
  const latency = formatLatency(trace.latencyMs)
  const label = cache
    ? `${t('Cache de rejeu', 'Replay cache')} · ${latency}`
    : `${trace.model} · ${trace.where} · ${latency}`

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) =>
      root.current?.contains(e.target as Node) || setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = () => {
    const r = root.current?.getBoundingClientRect()
    if (r && !open) {
      const below = r.bottom + POPOVER_HEIGHT < innerHeight
      setPos({
        left: `${
          Math.max(8, Math.min(r.left, innerWidth - POPOVER_WIDTH - 8))
        }px`,
        ...(below
          ? { top: `${r.bottom + 6}px` }
          : { bottom: `${innerHeight - r.top + 6}px` }),
      })
    }
    setOpen(!open)
  }

  const Icon = cache ? History : Sparkles
  const failures = trace.failures?.length ?? 0
  const rows: [string, string][] = [
    [
      t('Modèle', 'Model'),
      cache
        ? `${trace.model} (${t('réponse rejouée', 'replayed answer')})`
        : trace.model,
    ],
    [
      t('Lieu d’exécution', 'Runs on'),
      cache ? t('Cache local de démo', 'Local demo cache') : trace.where,
    ],
    [t('Latence', 'Latency'), latency],
    [t('Tokens en entrée', 'Input tokens'), formatInt(trace.tokensIn)],
    [t('Tokens en sortie', 'Output tokens'), formatInt(trace.tokensOut)],
    [t('Horodatage', 'Timestamp'), formatDateTime(trace.at)],
  ]

  return (
    <span ref={root} tw='inline-flex align-middle'>
      <button
        type='button'
        aria-haspopup='dialog'
        aria-expanded={open}
        title={t('Détails de l’appel au modèle', 'Details of the model call')}
        onClick={toggle}
        tw={[
          'inline-flex items-center gap-[5px] h-5 px-[7px] rounded-md border text-[11.5px] font-medium leading-none whitespace-nowrap cursor-pointer',
          cache
            ? 'text-content-secondary bg-surface-sunken border-border-primary hover:bg-surface-hover'
            : 'text-ai bg-ai-soft border-ai-line hover:brightness-105',
        ]}
      >
        <Icon tw='w-3 h-3' />
        {label}
        {failures > 0 && (
          <TriangleAlert
            tw='w-3 h-3 text-warn'
            aria-label={`${failures} ${
              failures > 1
                ? t('tentatives échouées', 'failed attempts')
                : t('tentative échouée', 'failed attempt')
            } ${t('avant cette réponse', 'before this answer')}`}
          />
        )}
      </button>
      {open && (
        <div
          role='dialog'
          aria-label={t('Trace IA', 'AI trace')}
          style={{ ...pos, width: `${POPOVER_WIDTH}px` }}
          tw={[
            'fixed z-[1000] rounded-[10px] border bg-surface-elevated shadow-[var(--shadow-lg)] px-3.5 py-3 text-[13px] text-content-primary',
            cache ? 'border-border-primary' : 'border-ai-line',
          ]}
        >
          <div
            tw={[
              'flex items-center gap-1.5 mb-2 text-[12px] font-semibold',
              cache ? 'text-content-secondary' : 'text-ai',
            ]}
          >
            <Icon tw='w-3 h-3' />
            {t('Trace IA', 'AI trace')}
          </div>
          <dl
            tw='m-0 grid gap-x-3 gap-y-1.5'
            style={{ gridTemplateColumns: 'auto 1fr' }}
          >
            {rows.map(([k, v]) => (
              <>
                <dt tw='text-content-tertiary text-[12px]'>{k}</dt>
                <dd tw='m-0 text-right font-mono text-[12px] whitespace-nowrap'>
                  {v}
                </dd>
              </>
            ))}
          </dl>
          {failures > 0 && (
            <div tw='mt-2.5 pt-2 border-t border-border-primary text-[12px]'>
              <div tw='flex items-center gap-1.5 font-semibold text-warn mb-1'>
                <TriangleAlert tw='w-3 h-3' />
                {t('Avant cette réponse', 'Before this answer')}
              </div>
              <ol tw='m-0 pl-4 flex flex-col gap-0.5 text-content-secondary'>
                {trace.failures!.map((f, i) => (
                  <li key={i}>
                    {f.model} : {tm(f.reason)} · {formatLatency(f.ms)}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </span>
  )
}
