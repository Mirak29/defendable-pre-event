import { paths } from '/web/paths.ts'
import { signal } from '@preact/signals'
import { navigate } from '/web/lib/router-signal.ts'
import {
  invitation,
  invitationError,
  me,
  startBuild,
} from '/web/lib/candidate-store.ts'
import { notify } from '/web/ui/notifications.tsx'
import { Spinner } from '/web/ui/spinner.tsx'
import { demoMode } from '/web/lib/demo.ts'
import {
  Accessibility,
  Building2,
  CalendarClock,
  Clock,
  Database,
  Play,
  Server,
  Timer,
  UserCheck,
  UserX,
  VideoOff,
} from '/web/assets/icons.tsx'
import { t } from '/web/lib/i18n.ts'

const understood = signal(false)
const accepted = signal(false)

const DATA = () =>
  [
    [
      Database,
      t(
        'Collectés : code, résultats d’exécution, réponses, échanges avec l’assistant, sorties de page.',
        'Collected: code, run results, answers, exchanges with the assistant, page leaves.',
      ),
    ],
    [
      Server,
      t(
        'Analysés par des modèles d’IA (NVIDIA Nemotron, Google Gemini) : seuls votre code et vos réponses leur sont transmis.',
        'Analysed by AI models (NVIDIA Nemotron, Google Gemini): only your code and your answers are sent to them.',
      ),
    ],
    [
      UserX,
      t(
        'Aucune donnée d’identité envoyée au modèle.',
        'No identity data sent to the model.',
      ),
    ],
    [VideoOff, t('Ni webcam ni micro.', 'No webcam, no microphone.')],
    [CalendarClock, t('Conservation 30 jours.', 'Kept for 30 days.')],
    [
      UserCheck,
      t(
        'Décision finale prise par une personne.',
        'Final decision made by a person.',
      ),
    ],
  ] as const

const Step = (
  { n, title, text, current }: {
    n: number
    title: string
    text: string
    current?: boolean
  },
) => (
  <li tw='p-3.5 rounded-[10px] border border-border-primary bg-surface-page flex flex-col gap-1.5'>
    <span tw='flex items-center gap-2'>
      <span
        tw={[
          'w-6 h-6 flex-none rounded-full text-[12px] font-semibold inline-flex items-center justify-center',
          current
            ? 'bg-accent text-on-accent'
            : 'bg-surface-sunken border border-border-strong',
        ]}
      >
        {n}
      </span>
      <strong tw='text-[13.5px] font-semibold'>{title}</strong>
    </span>
    <span tw='text-[13px] text-content-secondary'>{text}</span>
  </li>
)

const Check = (
  { value, label, test }: {
    value: typeof understood
    label: string
    test: string
  },
) => (
  <label tw='flex items-center gap-2.5 text-[13.5px] cursor-pointer'>
    <input
      type='checkbox'
      data-test={test}
      checked={value.value}
      onChange={() => value.value = !value.value}
      tw='w-[17px] h-[17px] m-0 flex-none'
      style={{ accentColor: 'var(--color-accent)' }}
    />
    {label}
  </label>
)

/** "Commencer la phase de construction", also the demo's next step */
const starting = signal(false)

export const beginBuild = async () => {
  if (starting.peek()) return
  starting.value = true
  try {
    await startBuild(demoMode.peek())
    // U4: the personal link also resumes, on another device, where it was
    const view = me.peek()
    const href = view?.finishedAt
      ? paths.done
      : view?.questionsStartedAt
      ? paths.questions
      : view?.submittedAt
      ? paths.rules
      : paths.workspace
    navigate({ href, params: { invitation: null } })
  } catch (err) {
    notify({ status: 'failure', description: (err as Error).message })
  } finally {
    starting.value = false
  }
}

/** C1 — candidate welcome and consent */
export const ConsentPage = () => {
  const ok = understood.value && accepted.value
  const info = invitation.value
  if (!info) {
    return (
      <main tw='flex-1 flex items-center justify-center px-4 py-16'>
        {invitationError.value
          ? (
            <p tw='m-0 card px-5 py-4 text-[14px] text-content-secondary'>
              {t(
                'Ce lien d’évaluation n’est pas valide. Vérifiez le lien reçu.',
                'This assessment link is not valid. Check the link you received.',
              )}
            </p>
          )
          : <Spinner tw='w-5 h-5 text-content-tertiary' />}
      </main>
    )
  }
  const { title, company, durationMin, firstName, state } = info
  if (state !== 'invited') {
    const closed = state === 'expired' || state === 'revoked'
    return (
      <main tw='flex-1 flex items-center justify-center px-4 py-16'>
        <article
          data-test='invitation-state'
          tw='card w-[520px] max-w-full px-6 py-5 flex flex-col gap-3'
        >
          <span tw='text-[12.5px] text-content-tertiary inline-flex items-center gap-1.5'>
            <Building2 tw='w-3.5 h-3.5' />
            {company} · {title}
          </span>
          <p tw='m-0 text-[15px] font-medium'>
            {closed
              ? t(
                `Ce lien n’est plus valable. Demandez un nouveau lien à ${company}.`,
                `This link is no longer valid. Ask ${company} for a new one.`,
              )
              : state === 'finished'
              ? t(
                `Vous avez terminé cette épreuve${
                  firstName ? `, ${firstName}` : ''
                }. Merci ! ${company} reviendra vers vous.`,
                `You have finished this assessment${
                  firstName ? `, ${firstName}` : ''
                }. Thank you! ${company} will get back to you.`,
              )
              : t(
                `Votre épreuve est en cours${
                  firstName ? `, ${firstName}` : ''
                }. Reprenez là où vous en étiez : le chrono continue.`,
                `Your assessment is in progress${
                  firstName ? `, ${firstName}` : ''
                }. Pick up where you left off: the timer keeps running.`,
              )}
          </p>
          {state === 'started' && (
            <button
              type='button'
              tw='btn btn-primary h-[38px] px-4 self-start'
              data-test='resume-btn'
              disabled={starting.value}
              onClick={beginBuild}
            >
              <Play tw='w-[15px] h-[15px]' />
              {t('Reprendre l’épreuve', 'Resume the assessment')}
            </button>
          )}
        </article>
      </main>
    )
  }
  return (
    <main tw='px-4 sm:px-6 pt-8 sm:pt-10 pb-16 flex justify-center'>
      <article tw='w-[720px] max-w-full card rounded-[14px] shadow-[var(--shadow)] overflow-hidden'>
        <header tw='px-5 sm:px-7 pt-6 pb-5 border-b border-border-primary flex flex-col gap-1.5'>
          <span tw='text-[12.5px] text-content-tertiary inline-flex items-center gap-1.5'>
            <Building2 tw='w-3.5 h-3.5' />
            {company}
          </span>
          {firstName && (
            <span tw='text-[14px] text-content-secondary'>
              {t(`Bonjour ${firstName},`, `Hello ${firstName},`)}
            </span>
          )}
          <h1 tw='m-0 text-[20px] sm:text-[22px] font-semibold'>{title}</h1>
          <span tw='text-[13.5px] text-content-secondary inline-flex items-center gap-1.5'>
            <Clock tw='w-3.5 h-3.5' />
            {durationMin} {t(
              'min + environ 20 min de questions',
              'min + about 20 min of questions',
            )}
          </span>
        </header>
        <div tw='px-5 sm:px-7 py-[22px] flex flex-col gap-5'>
          <section tw='flex flex-col gap-2.5'>
            <h2 tw='m-0 font-main text-[14px] font-semibold tracking-normal'>
              {t('Comment se déroule l’évaluation', 'How the assessment works')}
            </h2>
            <ol tw='list-none m-0 p-0 grid grid-cols-1 sm:grid-cols-2 gap-2.5'>
              <Step
                n={1}
                current
                title={t(
                  `Phase de construction (${durationMin} min)`,
                  `Building phase (${durationMin} min)`,
                )}
                text={t(
                  'Vous codez dans un éditeur en ligne. Vous pouvez utiliser librement l’IA (ChatGPT, Claude, Copilot…), la documentation et Internet.',
                  'You code in an online editor. You may freely use AI (ChatGPT, Claude, Copilot…), documentation and the Internet.',
                )}
              />
              <Step
                n={2}
                title={t(
                  'Phase de questions (environ 20 min)',
                  'Question phase (about 20 min)',
                )}
                text={t(
                  '10 questions sur votre propre code, 6 QCM et 4 réponses libres, chronométrées. Copier-coller désactivé, sorties de la page enregistrées. Un assistant documentation est disponible pour les réponses libres.',
                  '10 timed questions on your own code, 6 multiple-choice and 4 open answers. Copy-paste disabled, page leaves recorded. A documentation assistant is available for open answers.',
                )}
              />
            </ol>
          </section>
          <p tw='m-0 px-4 py-3.5 rounded-[10px] border border-accent bg-accent-soft text-[15px] font-medium leading-[1.45]'>
            {t(
              'L’IA peut vous aider à construire et à réfléchir. Elle ne peut pas expliquer à votre place.',
              'AI can help you build and think. It cannot explain for you.',
            )}
          </p>
          <section tw='flex flex-col gap-2.5'>
            <h2 tw='m-0 font-main text-[14px] font-semibold tracking-normal'>
              {t('Vos données', 'Your data')}
            </h2>
            <p tw='m-0 text-[13px] text-content-secondary'>
              {t(
                `${company} nous a transmis votre nom et votre e-mail pour rattacher cette épreuve à votre candidature. Ils ne sont jamais envoyés aux modèles d’IA.`,
                `${company} gave us your name and e-mail to link this assessment to your application. They are never sent to the AI models.`,
              )}
            </p>
            <ul tw='list-none m-0 p-0 grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-2 text-[13px] text-content-secondary'>
              {DATA().map(([Icon, text]) => (
                <li key={text} tw='flex gap-2'>
                  <Icon tw='w-[15px] h-[15px] flex-none mt-0.5 text-content-tertiary' />
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </section>
          <div tw='flex flex-col gap-2 pt-3 border-t border-border-primary'>
            <Check
              value={understood}
              label={t(
                'J’ai compris le déroulement',
                'I understand how it works',
              )}
              test='understood-check'
            />
            <Check
              value={accepted}
              test='consent-check'
              label={t(
                'J’accepte le traitement de mes données décrit ci-dessus',
                'I accept the processing of my data described above',
              )}
            />
          </div>
        </div>
        <footer tw='px-5 sm:px-7 py-4 border-t border-border-primary bg-surface-sunken flex items-center gap-4 flex-wrap'>
          <a
            href='#'
            onClick={(e) => e.preventDefault()}
            tw='text-[13px] inline-flex items-center gap-[5px]'
          >
            <Accessibility tw='w-3.5 h-3.5' />
            {t(
              'Besoin d’un aménagement (accessibilité) ?',
              'Need an adjustment (accessibility)?',
            )}
          </a>
          <span tw='flex-1' />
          <span tw='text-[12.5px] text-content-tertiary inline-flex items-center gap-[5px]'>
            <Timer tw='w-[13px] h-[13px]' />
            {t('Le chrono démarre au clic.', 'The timer starts on click.')}
          </span>
          <button
            type='button'
            tw='btn btn-primary h-[38px] px-4'
            data-test='start-build-btn'
            disabled={!ok || starting.value}
            onClick={() => {
              ok && beginBuild()
            }}
          >
            <Play tw='w-[15px] h-[15px]' />
            {t(
              'Commencer la phase de construction',
              'Start the building phase',
            )}
          </button>
        </footer>
      </article>
    </main>
  )
}
