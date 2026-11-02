import { useEffect } from 'npm:preact/hooks'
import { elapsedBuildSeconds, loadMe, me } from '/web/lib/candidate-store.ts'
import { formatMinutes } from '/web/lib/format.ts'
import { Check } from '/web/assets/icons.tsx'
import { t } from '/web/lib/i18n.ts'

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div tw='px-3.5 py-3 rounded-[10px] border border-border-primary bg-surface-page'>
    <dt tw='text-[12px] text-content-tertiary'>{label}</dt>
    <dd tw='mt-0.5 mb-0 font-mono font-bold text-[18px]'>{value}</dd>
  </div>
)

/** C7 — end. No result is shown to the candidate. */
export const DonePage = () => {
  useEffect(() => {
    document.fullscreenElement && document.exitFullscreen().catch(() => {})
    loadMe() // finishedAt is set by the last answer
  }, [])
  const s = me.value
  const buildMin = Math.round(elapsedBuildSeconds() / 60)
  const questionsMin = s?.questionsStartedAt && s.finishedAt
    ? Math.max(1, Math.round((s.finishedAt - s.questionsStartedAt) / 60000))
    : 0
  const count = s?.answeredCount ?? 10
  return (
    <main tw='flex-1 flex items-center justify-center px-4 sm:px-6 py-12'>
      <article tw='w-[560px] max-w-full p-6 sm:p-8 card rounded-[14px] shadow-[var(--shadow)] flex flex-col gap-[18px]'>
        <span tw='w-11 h-11 rounded-full bg-ok-soft text-ok inline-flex items-center justify-center'>
          <Check tw='w-[22px] h-[22px]' stroke-width={2.25} />
        </span>
        <h1
          data-test='done-title'
          tw='m-0 text-[22px] sm:text-[24px] font-semibold'
        >
          {t('Évaluation terminée. Merci.', 'Assessment finished. Thank you.')}
        </h1>
        <dl tw='m-0 grid grid-cols-1 sm:grid-cols-2 gap-2.5'>
          <Stat
            label={t('Construction', 'Building')}
            value={formatMinutes(buildMin)}
          />
          <Stat
            label={t('Questions', 'Questions')}
            value={t(
              `${count} en ${questionsMin} min`,
              `${count} in ${questionsMin} min`,
            )}
          />
        </dl>
        <p tw='m-0 text-[14px] text-content-secondary'>
          {t(
            'Le recruteur reçoit un rapport. La décision finale est prise par une personne, pas par l’IA.',
            'The recruiter receives a report. The final decision is made by a person, not by AI.',
          )}
        </p>
        <p tw='m-0 text-[12.5px] text-content-tertiary'>
          {t('Vous pouvez fermer cette page.', 'You can close this page.')}
        </p>
      </article>
    </main>
  )
}
