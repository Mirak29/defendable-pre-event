import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import {
  Check,
  CodeXml,
  FileCheck,
  FileText,
  MessagesSquare,
  Play,
} from '/web/assets/icons.tsx'
import { t } from '/web/lib/i18n.ts'

const nodes = () => [
  {
    title: t('Votre offre', 'Your job offer'),
    text: t('Vous collez l’annonce', 'You paste the offer'),
    icon: FileText,
  },
  {
    title: 'DEFENDABLE',
    text: t(
      'Génère l’épreuve et ses 11 tests',
      'Generates the assessment and its 11 tests',
    ),
    icon: CodeXml,
  },
  {
    title: t('Le candidat', 'The candidate'),
    text: t('Code avec son IA', 'Codes with their AI'),
    icon: CodeXml,
  },
  {
    title: t('10 questions', '10 questions'),
    text: t('Sur son code, sans aide', 'On their code, without help'),
    icon: MessagesSquare,
  },
  {
    title: t('Le rapport', 'The report'),
    text: t('La décision vous revient', 'The decision is yours'),
    icon: FileCheck,
  },
]

export const WorkflowIllustration = () => {
  const step = useSignal(0)
  const replay = useSignal(0)
  const figure = useRef<HTMLElement>(null)
  useEffect(() => {
    const motion = matchMedia('(prefers-reduced-motion: reduce)')
    let timer: ReturnType<typeof setTimeout> | undefined
    let started = false
    const advance = () => {
      step.value++
      if (step.value < 6) timer = setTimeout(advance, 900)
    }
    const start = () => {
      if (started) return
      started = true
      step.value = motion.matches ? 6 : 1
      if (!motion.matches) timer = setTimeout(advance, 900)
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) start()
    }, { threshold: 0.25 })
    const reduce = () => {
      if (motion.matches) {
        clearTimeout(timer)
        step.value = 6
      }
    }
    step.value = motion.matches ? 6 : 0
    if (replay.value > 0) start()
    else if (figure.current) observer.observe(figure.current)
    motion.addEventListener('change', reduce)
    return () => {
      clearTimeout(timer)
      observer.disconnect()
      motion.removeEventListener('change', reduce)
    }
  }, [replay.value])

  return (
    <figure
      ref={figure}
      class='workflow'
      data-test='workflow'
      data-step={step.value}
    >
      <div
        class='workflow-card'
        tw='border border-border-strong rounded-2xl bg-surface-elevated'
      >
        <div tw='px-5 pt-5 flex items-center justify-between gap-2 text-xs text-content-secondary'>
          <span>
            <span tw='text-ok'>●</span> {t(
              'Une offre reçue. Tout s’enchaîne.',
              'A job offer comes in. Everything follows.',
            )}
          </span>
          <span aria-hidden='true'>•••</span>
        </div>
        <p tw='px-5 mt-4 font-mono text-[10px] tracking-widest text-content-secondary'>
          {t(
            'VOTRE PROCHAINE ÉPREUVE · EXEMPLE LINKLY',
            'YOUR NEXT ASSESSMENT · LINKLY EXAMPLE',
          )}
        </p>
        <div class='workflow-map'>
          <svg
            class='workflow-lines'
            viewBox='0 0 500 270'
            preserveAspectRatio='none'
            aria-hidden='true'
          >
            {['M110 30 H214', 'M286 30 H390', 'M419 60 V140', 'M390 171 H110']
              .map((d, i) => (
                <path
                  key={d}
                  d={d}
                  class={step.value === i + 1 ? 'flowing' : ''}
                />
              ))}
            <g class='workflow-labels'>
              <text x='156' y='18'>
                {t('tests générés', 'tests generated')}
              </text>
              <text x='347' y='18'>
                {t('lien d’épreuve', 'assessment link')}
              </text>
              <text x='366' y='128'>{t('code soumis', 'code submitted')}</text>
              <text x='250' y='161'>{t('réponses', 'answers')}</text>
            </g>
          </svg>
          <ol class='workflow-nodes'>
            {nodes().map(({ title, text, icon: Icon }, i) => (
              <li
                key={i}
                class={`workflow-node node-${i}`}
                data-active={step.value === i + 1}
                data-complete={step.value > i + 1}
              >
                <div
                  class='workflow-orb'
                  tw={i === 1
                    ? 'text-ai border-ai bg-ai-soft'
                    : 'text-content-primary border-border-strong bg-surface-elevated'}
                >
                  {i === 1
                    ? (
                      <span
                        aria-hidden='true'
                        tw='w-7 h-7 border-2 border-ai rounded-lg flex items-center justify-center'
                      >
                        <span tw='w-3 h-3 bg-ai rounded' />
                      </span>
                    )
                    : <Icon tw='w-6 h-6' />}
                  <span class='workflow-check' tw='bg-ok text-on-accent'>
                    <Check tw='w-3 h-3' />
                  </span>
                </div>
                <strong tw='text-sm'>{title}</strong>
                <span tw='text-xs text-content-secondary'>{text}</span>
                {i === 4 && (
                  <span tw='text-[10px] text-content-secondary'>
                    {t('Faits vérifiés', 'Verified facts')} ·{' '}
                    <span tw='text-ai'>
                      {t('Interprétations IA', 'AI interpretations')}
                    </span>
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
        <div tw='mx-5 py-4 border-t border-border-primary flex flex-wrap items-center justify-between gap-2'>
          <button
            type='button'
            data-test='workflow-replay-btn'
            tw='btn btn-secondary btn-sm'
            onClick={() => replay.value++}
          >
            <Play tw='w-3 h-3' />
            {t('Rejouer le parcours', 'Replay the journey')}
          </button>
          <span tw='text-[10px] font-mono text-content-secondary'>
            {t('DÉMO INTERACTIVE', 'INTERACTIVE DEMO')}
          </span>
        </div>
      </div>
      <div
        class='workflow-notification'
        data-visible={step.value === 6}
        tw='bg-surface-elevated border border-border-strong rounded-xl p-4 flex gap-3'
      >
        <Check tw='w-5 h-5 flex-none text-ok' />
        <div tw='text-xs leading-relaxed'>
          <strong tw='block text-sm mb-1'>
            {t(
              'Rapport prêt. Les faits sont là.',
              'Report ready. The facts are in.',
            )}
          </strong>
          {t(
            '8/8 tests publics · 1 contradiction à vérifier en entretien.',
            '8/8 public tests · 1 contradiction to check in the interview.',
          )}
          <br />
          {t(
            'Aucun score : la décision vous revient.',
            'No score: the decision is yours.',
          )}
        </div>
      </div>
      <figcaption tw='text-xs text-content-secondary mt-4 text-center'>
        {t(
          'Ça, c’est une épreuve DEFENDABLE. Bientôt, ce sera la vôtre.',
          'That is a DEFENDABLE assessment. Soon, it will be yours.',
        )}
      </figcaption>
    </figure>
  )
}
