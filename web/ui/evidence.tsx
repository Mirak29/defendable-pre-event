// Small evidence markers of the report (brief §2.3, 2.4, 2.7, 2.9).
// No information relies on color only: each one has an icon and a label.
import type { Confidence, DimensionStatusValue, Method } from '/web/types.ts'

export type { Confidence, DimensionStatusValue }
import {
  Check,
  FileSearch,
  FlaskConical,
  MessagesSquare,
  Minus,
  Sparkles,
  X,
} from '/web/assets/icons.tsx'
import { t, tv } from '/web/lib/i18n.ts'

/** 2.3 — nature of a statement */
export const NatureBadge = ({ nature }: { nature: 'fact' | 'ai' }) =>
  nature === 'fact'
    ? (
      <span tw='badge h-5 px-[7px] text-[11.5px] bg-surface-sunken border-border-strong text-content-secondary'>
        <Check tw='w-3 h-3' stroke-width={2.25} />
        {t('Fait vérifié', 'Verified fact')}
      </span>
    )
    : (
      <span tw='badge badge-ai h-5 px-[7px] text-[11.5px]'>
        <Sparkles tw='w-3 h-3' />
        {t('Interprétation IA', 'AI interpretation')}
      </span>
    )

const confidenceLevel = { faible: 1, moyenne: 2, élevée: 3 } as const

/** 2.4 — 3 segments + label */
export const ConfidenceMeter = (
  { level, short }: { level: Confidence; short?: boolean },
) => (
  <span tw='inline-flex items-center gap-[7px]'>
    <span tw='inline-flex gap-0.5' aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          tw={[
            'w-2.5 h-1.5 rounded-sm',
            i < confidenceLevel[level]
              ? 'bg-content-secondary'
              : 'bg-border-strong',
          ]}
        />
      ))}
    </span>
    <span tw='text-[12px] text-content-secondary'>
      {short ? tv(level)[0].toUpperCase() + tv(level).slice(1) : t(
        `Confiance ${level}`,
        `${tv(level)[0].toUpperCase()}${tv(level).slice(1)} confidence`,
      )}
    </span>
  </span>
)

const methodIcons = {
  'Tests': FlaskConical,
  'Analyse du code': FileSearch,
  'Questions': MessagesSquare,
} as const

/** 2.9 — evaluation method */
export const MethodBadge = ({ method }: { method: Method }) => {
  const Icon = methodIcons[method]
  return (
    <span tw='badge h-5 px-[7px] text-[11.5px] font-normal bg-transparent border-border-strong text-content-secondary'>
      <Icon tw='w-[11px] h-[11px]' />
      {tv(method)}
    </span>
  )
}

const HalfCircle = () => (
  <span
    tw='w-[11px] h-[11px] flex-none rounded-full border-[1.5px] border-current'
    style={{
      background: 'linear-gradient(90deg, currentColor 50%, transparent 50%)',
    }}
  />
)

const dimensionStyles = {
  'Démontré': ['text-ok bg-ok-soft', Check],
  'Partiel': ['text-warn bg-warn-soft', HalfCircle],
  'Non démontré': ['text-err bg-err-soft', X],
  'Non évalué': ['text-content-secondary bg-surface-sunken', Minus],
} as const

/** 2.7 — status of a report dimension */
export const DimensionStatus = (
  { status }: { status: DimensionStatusValue },
) => {
  const [colors, Icon] = dimensionStyles[status]
  return (
    <span
      tw={[
        'inline-flex items-center gap-[5px] h-[22px] px-2 rounded-md text-[12px] font-semibold whitespace-nowrap',
        colors,
      ]}
    >
      <Icon tw='w-3 h-3' stroke-width={2.25} />
      {tv(status)}
    </span>
  )
}
