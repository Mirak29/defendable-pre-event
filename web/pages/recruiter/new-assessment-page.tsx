import { paths } from '/web/paths.ts'
import { computed, signal } from '@preact/signals'
import { navigate, url } from '/web/lib/router-signal.ts'
import { useEffect } from 'npm:preact/hooks'
import {
  demoPrefilledSkills,
  skillCatalog,
  skillMethods,
} from '/fixtures/demo.ts'
import { demoOf } from '/fixtures/demos.ts'
import {
  generateAssessment,
  getAssessment,
  prefillSkills,
  retryGeneration,
} from '/web/lib/assessment-store.ts'
import type { AiTrace, Level } from '/web/types.ts'
import { notify } from '/web/ui/notifications.tsx'
import { Spinner } from '/web/ui/spinner.tsx'
import { FieldTitle, Input, Label, Segmented, Textarea } from '/web/ui/form.tsx'
import { BackLink, Caption } from '/web/ui/page.tsx'
import { Tooltip } from '/web/ui/tooltip.tsx'
import { AiTraceBadge } from '/web/ui/ai-trace.tsx'
import { MethodBadge } from '/web/ui/evidence.tsx'
import {
  AiErrorBanner,
  fallbackDetail,
  type OperationStep,
  OperationStepper,
} from '/web/ui/stepper.tsx'
import {
  Check,
  ClipboardPaste,
  Info,
  Lock,
  Plus,
  Sparkles,
  TriangleAlert,
} from '/web/assets/icons.tsx'
import { lang, t, tv } from '/web/lib/i18n.ts'
import { tm } from '/web/lib/messages.ts'

// Twind has no decoration-* / underline-offset-* utilities
const underlineStyle = {
  textDecorationColor: 'var(--color-border-strong)',
  textUnderlineOffset: '3px',
}

const MIN_LENGTH = 80
const MAX_SKILLS = 5

/*
 * Form state, module level like tournament pages: the guided demo (T5)
 * fills it with `fillExample()`.
 */
const description = signal('')
const level = signal<Level>('intermediate')
const duration = signal(90)
const skills = signal<string[]>([])
const customSkills = signal<string[]>([])
const customInput = signal('')
const domain = signal('')
// the assessment is written in the language of the interface by default
const language = signal<'fr' | 'en'>(lang.peek())
const prefilled = signal(false)

/** the example of the guided demo, in the language of the site */
export const fillExample = () => {
  const demo = demoOf(lang.value)
  description.value = demo.jobDescription
  level.value = 'intermediate'
  duration.value = 90
  skills.value = [...demoPrefilledSkills]
  domain.value = demo.domain
  language.value = demo.lang
}

// R3 — generation, run by the API: the followed assessment (?id=) carries
// its progress, refreshed by the server events
type Phase = 'form' | 'gen' | 'retry' | 'failed'
const submitting = signal(false)
const submitError = signal('')

const generating = computed(() => {
  const a = url.params.id ? getAssessment(url.params.id) : undefined
  return a && (a.status === 'generating' || a.status === 'failed')
    ? a
    : undefined
})

const phase = computed((): Phase => {
  if (submitting.value) return 'gen'
  const a = generating.value
  if (!a) return 'form'
  if (a.status === 'failed') return 'failed'
  return a.generation?.steps.some((s) => s.state === 'run' && s.fallback)
    ? 'retry'
    : 'gen'
})

const length = computed(() => description.value.trim().length)
const isFull = computed(() => skills.value.length >= MAX_SKILLS)
const helpText = computed(() => {
  const missing = MIN_LENGTH - length.value
  if (missing > 0) {
    return t(
      `Encore ${missing} caractère${
        missing > 1 ? 's' : ''
      } dans la description (${MIN_LENGTH} minimum).`,
      `${missing} more character${
        missing > 1 ? 's' : ''
      } in the description (${MIN_LENGTH} minimum).`,
    )
  }
  if (!skills.value.length) {
    return t('Choisissez au moins une compétence.', 'Pick at least one skill.')
  }
  return ''
})

const toggleSkill = (name: string) => {
  const list = skills.value
  if (list.includes(name)) skills.value = list.filter((s) => s !== name)
  else if (list.length < MAX_SKILLS) skills.value = [...list, name]
}

const addCustomSkill = () => {
  const name = customInput.value.trim()
  const all = [...skillCatalog, ...customSkills.value]
  if (!name || isFull.value || all.includes(name)) return
  customSkills.value = [...customSkills.value, name]
  skills.value = [...skills.value, name]
  customInput.value = ''
}

const prefillTrace = signal<AiTrace | undefined>(undefined)
const prefilling = signal(false)

const prefill = async () => {
  prefilling.value = true
  try {
    const result = await prefillSkills(description.value)
    level.value = result.level
    skills.value = result.skills.slice(0, MAX_SKILLS)
    customSkills.value = result.skills.filter((s) =>
      !(skillCatalog as readonly string[]).includes(s)
    )
    prefillTrace.value = result.trace
    prefilled.value = true
  } catch (err) {
    notify({ status: 'failure', description: (err as Error).message })
  } finally {
    prefilling.value = false
  }
}

const runGeneration = async () => {
  submitting.value = true
  submitError.value = ''
  try {
    // ?etat=repli|echec replays the error states of the prototype for real
    const etat = url.params.etat
    const id = await generateAssessment({
      jobDescription: description.value,
      level: level.value,
      durationMin: duration.value,
      skills: skills.value,
      domain: domain.value.trim() || undefined,
      language: language.value,
    }, etat === 'repli' || etat === 'echec' ? etat : undefined)
    navigate({ params: { id, etat: null }, replace: true })
  } catch (err) {
    submitError.value = (err as Error).message
  } finally {
    submitting.value = false
  }
}

const retry = () => {
  const a = generating.value
  if (a) retryGeneration(a.id)
}

const STEPS = () => [
  t('Analyse du besoin', 'Analysing the need'),
  t(
    'Rédaction du scénario et des exigences',
    'Writing the scenario and requirements',
  ),
  t('Génération des tests', 'Generating the tests'),
  t('Vérifications automatiques', 'Automatic checks'),
]

const generationSteps = computed((): OperationStep[] => {
  const progress = generating.value?.generation?.steps
  return STEPS().map((label, i) => {
    const step = progress?.[i]
    const state = step?.state ?? (i === 0 && submitting.value ? 'run' : 'wait')
    let detail: string | undefined
    if (step?.state === 'run' && step.fallback) {
      detail = fallbackDetail(step.fallbackReason)
    }
    if (step?.state === 'error') {
      detail = generating.value?.generation?.failures?.at(-1)?.reason
        ? `${t('Erreur :', 'Error:')} ${
          tm(generating.value.generation.failures.at(-1)!.reason)
        }`
        : t(
          'Erreur : pas de réponse du modèle',
          'Error: no answer from the model',
        )
    }
    return { label, state, detail, trace: step?.trace }
  })
})

const GenerationOverlay = () => (
  <div tw='fixed inset-x-0 bottom-0 top-14 z-30 flex items-center justify-center p-4 sm:p-6'>
    <div
      role='status'
      aria-live='polite'
      tw='w-[520px] max-w-full card shadow-[var(--shadow-lg)] px-[22px] py-5 flex flex-col gap-3.5'
    >
      <div tw='flex items-baseline justify-between gap-3'>
        <h2 tw='m-0 text-[16px] font-semibold'>
          {t('Génération de l’épreuve', 'Generating the assessment')}
        </h2>
        <span tw='text-[12.5px] text-content-tertiary whitespace-nowrap'>
          {t('1 à 3 min', '1 to 3 min')}
        </span>
      </div>
      {phase.value === 'retry' && (
        <AiErrorBanner
          reason={generating.value?.generation?.steps.find((s) => s.fallback)
            ?.fallbackReason}
        />
      )}
      {phase.value === 'failed' && (
        <AiErrorBanner
          final
          onRetry={retry}
          message={generating.value?.generation?.error}
          failures={generating.value?.generation?.failures}
        />
      )}
      <OperationStepper steps={generationSteps.value} />
    </div>
  </div>
)

const SkillChip = ({ name }: { name: string }) => {
  const on = skills.value.includes(name)
  const disabled = !on && isFull.value
  const chip = (
    <button
      type='button'
      aria-pressed={on}
      disabled={disabled}
      onClick={() => toggleSkill(name)}
      tw={[
        'h-[30px] px-[11px] rounded-full border text-[13px] inline-flex items-center gap-[5px] cursor-pointer',
        on
          ? 'border-accent bg-accent-soft text-accent-text font-medium'
          : 'border-border-strong bg-surface-elevated text-content-primary hover:border-accent',
        // let the tooltip wrapper receive the pointer when disabled
        disabled && 'opacity-[.45] cursor-not-allowed pointer-events-none',
      ]}
    >
      {on && <Check tw='w-[13px] h-[13px]' stroke-width={2.25} />}
      {tv(name)}
    </button>
  )
  if (!disabled) return chip
  return (
    <Tooltip summary={chip}>
      {t(
        '5 compétences maximum. Retirez-en une pour choisir celle-ci.',
        '5 skills at most. Remove one to pick this one.',
      )}
    </Tooltip>
  )
}

const Form = () => {
  const busy = phase.value !== 'form'
  const cantGenerate = !!helpText.value
  return (
    <form
      onSubmit={(e) => e.preventDefault()}
      aria-disabled={busy}
      tw={[
        'card p-4 sm:p-[22px] flex flex-col gap-[22px] min-w-0',
        busy && 'opacity-40 pointer-events-none grayscale',
      ]}
    >
      <div tw='flex flex-col gap-1.5'>
        <div tw='flex items-baseline justify-between gap-3'>
          <Label for='description'>
            {t('Description du poste', 'Job description')}
          </Label>
          <span
            tw={[
              'font-mono text-[12px]',
              length.value >= MIN_LENGTH ? 'text-ok' : 'text-content-tertiary',
            ]}
          >
            {length.value} / {MIN_LENGTH} min.
          </span>
        </div>
        <Textarea
          name='description'
          rows={8}
          value={description.value}
          onInput={(e) => description.value = e.currentTarget.value}
          placeholder={t(
            'Collez une offre d’emploi ou décrivez le poste…',
            'Paste a job offer or describe the position…',
          )}
        />
        <div tw='flex items-center gap-2 flex-wrap'>
          <button
            type='button'
            onClick={prefill}
            disabled={length.value < MIN_LENGTH || prefilling.value}
            tw='inline-flex items-center gap-1.5 py-1 text-[13px] font-medium text-content-primary underline cursor-pointer disabled:opacity-[.45] disabled:cursor-not-allowed'
            style={underlineStyle}
          >
            <Sparkles tw='w-3.5 h-3.5 text-ai' />
            {t(
              'Préremplir niveau et compétences depuis la description',
              'Prefill level and skills from the description',
            )}
          </button>
          {prefilling.value && <Spinner />}
          {prefilled.value && prefillTrace.value && (
            <AiTraceBadge trace={prefillTrace.value} />
          )}
        </div>
      </div>

      <div tw='grid grid-cols-1 sm:grid-cols-2 gap-5'>
        <div tw='flex flex-col gap-1.5'>
          <FieldTitle>{t('Niveau', 'Level')}</FieldTitle>
          <Segmented
            label={t('Niveau', 'Level')}
            value={level.value}
            onChange={(v) => level.value = v}
            options={[
              ['junior', 'Junior'],
              ['intermediate', t('Intermédiaire', 'Intermediate')],
              ['senior', 'Senior'],
            ]}
          />
        </div>
        <div tw='flex flex-col gap-1.5'>
          <FieldTitle>{t('Durée', 'Duration')}</FieldTitle>
          <Segmented
            label={t('Durée', 'Duration')}
            value={duration.value}
            onChange={(v) => duration.value = v}
            options={[[60, '60 min'], [90, '90 min'], [120, '120 min']]}
          />
        </div>
      </div>

      <div tw='flex flex-col gap-2'>
        <div tw='flex items-baseline justify-between gap-3'>
          <FieldTitle>
            {t('Compétences prioritaires (5 max)', 'Priority skills (5 max)')}
          </FieldTitle>
          <span
            tw={[
              'font-mono font-bold text-[12.5px]',
              isFull.value ? 'text-warn' : 'text-content-secondary',
            ]}
          >
            {skills.value.length}/{MAX_SKILLS}
          </span>
        </div>
        <div tw='flex flex-wrap gap-1.5'>
          {[...skillCatalog, ...customSkills.value].map((name) => (
            <SkillChip key={name} name={name} />
          ))}
        </div>
        <div tw='flex gap-1.5 max-w-[420px]'>
          <Input
            name='customSkill'
            aria-label={t('Ajouter une compétence', 'Add a skill')}
            value={customInput.value}
            disabled={isFull.value}
            placeholder={t('Ajouter une compétence', 'Add a skill')}
            onInput={(e) => customInput.value = e.currentTarget.value}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              addCustomSkill()
            }}
          />
          <button
            type='button'
            tw='btn btn-secondary h-[34px] px-3 text-[13px] font-normal'
            disabled={isFull.value || !customInput.value.trim()}
            onClick={addCustomSkill}
          >
            <Plus tw='w-3.5 h-3.5' />
            {t('Ajouter', 'Add')}
          </button>
        </div>
      </div>

      <div tw='grid grid-cols-1 sm:grid-cols-wide-narrow gap-5'>
        <div tw='flex flex-col gap-1.5'>
          <Label for='domain'>
            {t('Domaine métier (facultatif)', 'Business domain (optional)')}
          </Label>
          <Input
            name='domain'
            value={domain.value}
            onInput={(e) => domain.value = e.currentTarget.value}
            placeholder={t(
              'Ex. : marketing, paiement, logistique',
              'E.g. marketing, payments, logistics',
            )}
          />
        </div>
        <div tw='flex flex-col gap-1.5'>
          <FieldTitle>
            {t('Langue de l’épreuve', 'Language of the assessment')}
          </FieldTitle>
          <Segmented
            label={t('Langue', 'Language')}
            value={language.value}
            onChange={(v) => language.value = v}
            options={[['fr', 'Français'], ['en', 'English']]}
          />
        </div>
      </div>

      <div tw='flex gap-2 px-3 py-2.5 rounded-lg bg-surface-sunken border border-border-primary text-[13px] text-content-secondary'>
        <Lock tw='w-[15px] h-[15px] mt-0.5 flex-none' />
        <span>
          <strong tw='font-semibold text-content-primary'>
            {t('Format fixé :', 'Fixed format:')}
          </strong>{' '}
          {t(
            'API HTTP en TypeScript (Deno), sans base de données ni dépendance externe.',
            'HTTP API in TypeScript (Deno), with no database and no external dependency.',
          )}
        </span>
      </div>

      <div tw='flex flex-col items-start gap-1.5 pt-1'>
        <button
          type='button'
          tw='btn btn-primary h-10 px-[18px] text-[14px]'
          data-test='generate-btn'
          disabled={cantGenerate || busy}
          onClick={() => cantGenerate || runGeneration()}
        >
          <Sparkles tw='w-[15px] h-[15px]' />
          {t('Générer l’épreuve', 'Generate the assessment')}
        </button>
        {!busy && helpText.value && (
          <span tw='text-[12.5px] text-content-tertiary inline-flex items-center gap-[5px]'>
            <Info tw='w-[13px] h-[13px] flex-none' />
            {helpText.value}
          </span>
        )}
        {submitError.value && (
          <span tw='text-[12.5px] text-err inline-flex items-center gap-[5px]'>
            <TriangleAlert tw='w-[13px] h-[13px] flex-none' />
            {submitError.value}
          </span>
        )}
      </div>
    </form>
  )
}

const levelText = () => ({
  junior: 'Junior',
  intermediate: t('Intermédiaire', 'Intermediate'),
  senior: 'Senior',
})

const Preview = () => {
  const chosen = skills.value.map((name) => ({
    name,
    methods: skillMethods[name] || ['Questions' as const],
  }))
  const questionsOnly = chosen.filter((s) =>
    s.methods.length === 1 && s.methods[0] === 'Questions'
  )
  return (
    <aside
      aria-label={t('Aperçu du cadrage', 'Scope preview')}
      tw='lg:sticky lg:top-20 card px-[18px] py-4 flex flex-col gap-3.5 min-w-0'
    >
      <div tw='flex items-center justify-between gap-3'>
        <h2 tw='m-0 text-[15px] font-semibold'>
          {t('Aperçu du cadrage', 'Scope preview')}
        </h2>
        <span tw='text-[11.5px] text-content-tertiary inline-flex items-center gap-1 whitespace-nowrap'>
          <span tw='w-1.5 h-1.5 rounded-full bg-ok' />
          {t('Mis à jour en direct', 'Live update')}
        </span>
      </div>
      <dl
        tw='m-0 grid gap-x-4 gap-y-2 text-[13px]'
        style={{ gridTemplateColumns: 'auto 1fr' }}
      >
        <dt tw='text-content-tertiary'>Format</dt>
        <dd tw='m-0'>{tv('API HTTP en TypeScript (Deno)')}</dd>
        <dt tw='text-content-tertiary'>{t('Niveau', 'Level')}</dt>
        <dd tw='m-0'>{levelText()[level.value]}</dd>
        <dt tw='text-content-tertiary'>{t('Durée', 'Duration')}</dt>
        <dd tw='m-0'>
          {duration.value} {t(
            'min + environ 20 min de questions',
            'min + about 20 min of questions',
          )}
        </dd>
        <dt tw='text-content-tertiary'>Routes</dt>
        <dd tw='m-0'>4 routes</dd>
        <dt tw='text-content-tertiary'>Tests</dt>
        <dd tw='m-0'>
          {t('8 tests publics + 3 cachés', '8 public tests + 3 hidden')}
        </dd>
      </dl>
      <div tw='border-t border-border-primary pt-3 flex flex-col gap-2'>
        <Caption>{t('Compétences évaluées', 'Assessed skills')}</Caption>
        {!chosen.length && (
          <span tw='text-[13px] text-content-tertiary'>
            {t('Aucune compétence choisie.', 'No skill picked.')}
          </span>
        )}
        {chosen.map((s) => (
          <div key={s.name} tw='flex items-center gap-2 text-[13px] flex-wrap'>
            <span tw='flex-1 min-w-[120px]'>{tv(s.name)}</span>
            {s.methods.map((m) => <MethodBadge key={m} method={m} />)}
          </div>
        ))}
        {questionsOnly.map((s) => (
          <div
            key={s.name}
            tw='flex gap-2 px-2.5 py-2 rounded-lg bg-warn-soft border border-warn-line text-[12.5px]'
          >
            <TriangleAlert tw='w-3.5 h-3.5 flex-none mt-0.5 text-warn' />
            <span>
              <strong tw='font-semibold'>{tv(s.name)}</strong>
              {t(
                ' : évalué par des questions uniquement ; l’environnement n’a pas de base de données. Confiance moyenne au plus.',
                ': assessed by questions only; the environment has no database. Medium confidence at most.',
              )}
            </span>
          </div>
        ))}
      </div>
      <button
        type='button'
        data-test='fill-example-btn'
        onClick={fillExample}
        tw='self-start inline-flex items-center gap-[5px] text-[13px] font-medium text-accent-text hover:underline cursor-pointer'
      >
        <ClipboardPaste tw='w-3.5 h-3.5' />
        {t('Remplir avec l’exemple', 'Fill in the example')}
      </button>
    </aside>
  )
}

/** R2 — describe the need; R3 — generation in progress */
export const NewAssessmentPage = () => {
  // generated: on to the review (R4)
  const a = url.params.id ? getAssessment(url.params.id) : undefined
  useEffect(() => {
    if (a?.status === 'draft') {
      navigate({ href: paths.review, params: { id: a.id }, replace: true })
    }
  }, [a?.status])
  return <Page />
}

const Page = () => (
  <div tw='w-full max-w-[1240px] mx-auto px-4 sm:px-8 pt-7 pb-16'>
    <BackLink href={paths.recruiter}>
      {t('Mes épreuves', 'My assessments')}
    </BackLink>
    <h1 tw='mt-2 mb-1 text-[22px] sm:text-[24px] font-semibold'>
      {t('Nouvelle épreuve', 'New assessment')}
    </h1>
    <p tw='m-0 mb-6 text-[13.5px] text-content-secondary'>
      {t(
        'Décrivez le besoin. L’épreuve, ses exigences et ses tests seront générés, puis soumis à votre validation.',
        'Describe the need. The assessment, its requirements and its tests will be generated, then submitted for your approval.',
      )}
    </p>
    <div tw='grid grid-cols-1 lg:grid-cols-form-preview gap-7 items-start'>
      <Form />
      <Preview />
    </div>
    {phase.value !== 'form' && <GenerationOverlay />}
  </div>
)
