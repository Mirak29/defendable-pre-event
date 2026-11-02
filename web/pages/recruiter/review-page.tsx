import { paths } from '/web/paths.ts'
import { signal } from '@preact/signals'
import { useEffect, useState } from 'npm:preact/hooks'
import { A, navigate, url } from '/web/lib/router-signal.ts'
import { Spinner } from '/web/ui/spinner.tsx'
import {
  approveAssessment,
  type AssessmentState,
  assessmentStatus,
  deletedTests,
  getAssessment,
  regenerateAssessment,
  renameAssessment,
  setDeletedTests,
  updateBrief,
} from '/web/lib/assessment-store.ts'
import { computeChecks } from '/web/lib/assessment-checks.ts'
import { levelLabels } from '/web/lib/format.ts'
import type { Importance, TestCase } from '/web/types.ts'
import {
  AnchorLink,
  BackLink,
  Collapsible,
  MetaTag,
  navLinkTw,
} from '/web/ui/page.tsx'
import { useActiveSection } from '/web/lib/scroll-spy.ts'
import { ModalDialog } from '/web/ui/dialog.tsx'
import { Textarea } from '/web/ui/form.tsx'
import { notify } from '/web/ui/notifications.tsx'
import { AiTraceBadge } from '/web/ui/ai-trace.tsx'
import { MethodBadge } from '/web/ui/evidence.tsx'
import { VisibilityBadge } from '/web/ui/test-result.tsx'
import {
  fallbackDetail,
  type OperationStep,
  OperationStepper,
} from '/web/ui/stepper.tsx'
import { NotFoundPage } from '/web/pages/not-found-page.tsx'
import {
  BadgeCheck,
  Braces,
  Check,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleX,
  Clock,
  EyeOff,
  FilePenLine,
  FlaskConical,
  Link2,
  Lock,
  OctagonX,
  Pencil,
  RefreshCw,
  ShieldCheck,
  SignalMedium,
  Trash2,
  TriangleAlert,
  Undo2,
} from '/web/assets/icons.tsx'
// `t` names a test in this file: the text helper is `tr`
import { t as tr, tv } from '/web/lib/i18n.ts'

const SECTIONS = () =>
  [
    ['contexte', tr('Contexte', 'Context')],
    ['exigences', tr('Exigences', 'Requirements')],
    ['competences', tr('Compétences', 'Skills')],
    ['api', tr('Contrat d’API', 'API contract')],
    ['tests', 'Tests'],
    ['tracabilite', tr('Traçabilité', 'Traceability')],
  ] as const
const SECTION_IDS = SECTIONS().map(([id]) => id)

const methodColor = {
  GET: 'text-code-kw',
  POST: 'text-code-str',
  DELETE: 'text-err',
} as const

const importanceBars: Record<Importance, number> = {
  haute: 3,
  moyenne: 2,
  basse: 1,
}

// UI state of the page (not part of the assessment)
const openTests = signal<Record<string, boolean>>({})
const confirming = signal<string | null>(null)
// a regeneration was running: its end is notified once (success or error)
const regenerating = signal(false)

/* ---------- header ---------- */

const EditableTitle = ({ a }: { a: AssessmentState }) => {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(a.spec.title)
  const stop = () => {
    renameAssessment(a.id, value)
    setEditing(false)
  }
  if (editing) {
    return (
      <input
        autoFocus
        aria-label={tr('Titre de l’épreuve', 'Title of the assessment')}
        value={value}
        onInput={(e) => setValue(e.currentTarget.value)}
        onBlur={stop}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && stop()}
        tw='w-full font-display font-semibold text-[20px] sm:text-[24px] tracking-[-0.03em] px-2 py-0.5 -ml-[9px] rounded-lg border border-accent bg-surface-elevated focus:outline-none'
      />
    )
  }
  return (
    <div tw='flex items-center gap-2'>
      <h1 tw='m-0 text-[20px] sm:text-[24px] font-semibold'>{a.spec.title}</h1>
      <button
        type='button'
        onClick={() => {
          setValue(a.spec.title)
          setEditing(true)
        }}
        aria-label={tr('Modifier le titre', 'Edit the title')}
        title={tr('Modifier le titre', 'Edit the title')}
        tw='btn btn-ghost w-7 h-7 px-0 flex-none text-content-tertiary'
      >
        <Pencil tw='w-[15px] h-[15px]' />
      </button>
    </div>
  )
}

const Header = ({ a, blocked }: { a: AssessmentState; blocked: boolean }) => (
  <header tw='flex gap-5 items-start flex-wrap'>
    <div tw='flex-1 min-w-[min(320px,100%)] flex flex-col gap-2.5'>
      <BackLink href={paths.recruiter}>
        {tr('Mes épreuves', 'My assessments')}
      </BackLink>
      <EditableTitle a={a} />
      <div tw='flex items-center gap-1.5 flex-wrap'>
        <MetaTag icon={SignalMedium}>{levelLabels[a.spec.level]}</MetaTag>
        <MetaTag icon={Clock}>{a.spec.durationMin} min</MetaTag>
        <MetaTag icon={Braces}>{tv(a.spec.format)}</MetaTag>
        <span tw='inline-flex items-center gap-[5px] h-[22px] px-2 rounded-md bg-surface-sunken border border-dashed border-border-strong text-[12px] font-medium text-content-secondary'>
          <FilePenLine tw='w-3 h-3' />
          {tr('Brouillon', 'Draft')}
        </span>
        <AiTraceBadge trace={a.trace} />
      </div>
    </div>
    <div tw='flex flex-col items-start sm:items-end gap-1.5 sm:pt-[26px]'>
      <div tw='flex gap-2 flex-wrap'>
        <A params={{ dialog: 'regenerate' }} tw='btn btn-secondary h-9'>
          <RefreshCw tw='w-[15px] h-[15px]' />
          {tr('Régénérer avec une consigne', 'Regenerate with an instruction')}
        </A>
        <button
          type='button'
          tw='btn btn-primary h-9'
          data-test='approve-btn'
          disabled={blocked}
          title={blocked
            ? tr(
              'Un contrôle automatique est en échec',
              'An automatic check is failing',
            )
            : undefined}
          onClick={() => {
            if (blocked) return
            approveAssessment(a.id)
              .then(() =>
                navigate({ href: paths.assessment, params: { id: a.id } })
              )
              .catch((err) =>
                notify({ status: 'failure', description: err.message })
              )
          }}
        >
          <BadgeCheck tw='w-[15px] h-[15px]' />
          {tr('Approuver l’épreuve', 'Approve the assessment')}
        </button>
      </div>
      {blocked && (
        <span tw='text-[12px] text-err inline-flex items-center gap-1'>
          <Lock tw='w-3 h-3' />
          {tr(
            'Approbation impossible : un contrôle est en échec.',
            'Approval not possible: a check is failing.',
          )}
        </span>
      )}
    </div>
  </header>
)

/* ---------- automatic checks ---------- */

const ChecksBanner = (
  { a, deleted, checks, uncovered }: {
    a: AssessmentState
    deleted: Set<string>
    checks: ReturnType<typeof computeChecks>['checks']
    uncovered: string[]
  },
) => {
  const failed = checks.filter((c) => !c.ok).length
  // tests excluded by the fairness check stay out: restoring them would
  // only turn another check red
  const excluded = new Set(a.reference?.excluded.map((e) => e.id))
  const byRecruiter = [...deleted].filter((id) => !excluded.has(id))
  const canRestore = uncovered.length > 0 && byRecruiter.length > 0
  return (
    <section
      aria-label={tr('Vérifications automatiques', 'Automatic checks')}
      tw={[
        'card rounded-[10px] px-4 py-3.5',
        failed && 'border-err',
      ]}
    >
      <div tw='flex items-center gap-2 mb-2.5 flex-wrap'>
        <ShieldCheck tw='w-4 h-4 text-content-secondary' />
        <h2 tw='m-0 font-main text-[14px] font-semibold tracking-normal'>
          {tr('Vérifications automatiques', 'Automatic checks')}
        </h2>
        <span tw='text-[12.5px] text-content-tertiary'>
          {failed
            ? `${checks.length - failed}/${checks.length} ${
              tr('réussis', 'passed')
            } · ${failed} ${tr('en échec', 'failing')}`
            : `${checks.length}/${checks.length} ${tr('réussis', 'passed')}`}
        </span>
      </div>
      <div tw='grid grid-cols-checks gap-2'>
        {checks.map((c) => (
          <div
            key={c.label}
            tw={[
              'flex items-start gap-2 px-2.5 py-2 rounded-lg text-[12.5px] leading-snug border',
              c.ok
                ? 'bg-surface-sunken border-transparent'
                : 'bg-err-soft border-err text-err font-semibold',
            ]}
          >
            {c.ok
              ? <CircleCheck tw='w-4 h-4 flex-none mt-px text-ok' />
              : <CircleX tw='w-4 h-4 flex-none mt-px text-err' />}
            <span>{c.label}</span>
          </div>
        ))}
      </div>
      {failed > 0 && (
        <div
          role='alert'
          tw='mt-2.5 px-3 py-2.5 rounded-lg bg-err-soft border border-err flex items-center gap-2.5 text-[13px] flex-wrap'
        >
          <OctagonX tw='w-4 h-4 flex-none text-err' />
          <span tw='flex-1 min-w-[min(260px,100%)]'>
            <strong tw='font-semibold text-err'>
              {tr(
                '« Approuver l’épreuve » est désactivé.',
                '“Approve the assessment” is disabled.',
              )}
            </strong>{' '}
            {uncovered.length
              ? tr(
                `${uncovered.length > 1 ? 'Les exigences' : 'L’exigence'} ${
                  uncovered.join(', ')
                } ${
                  uncovered.length > 1 ? 'ne sont couvertes' : 'n’est couverte'
                } par aucun test. ${
                  canRestore
                    ? 'Restaurez les tests supprimés'
                    : 'Restaurez un test écarté'
                } ou régénérez l’épreuve.`,
                `${uncovered.length > 1 ? 'Requirements' : 'Requirement'} ${
                  uncovered.join(', ')
                } ${uncovered.length > 1 ? 'are' : 'is'} covered by no test. ${
                  canRestore
                    ? 'Restore the deleted tests'
                    : 'Restore an excluded test'
                } or regenerate the assessment.`,
              )
              : tr(
                'Supprimez le test en échec ou régénérez l’épreuve.',
                'Delete the failing test or regenerate the assessment.',
              )}
          </span>
          {canRestore
            ? (
              <button
                type='button'
                tw='btn btn-secondary btn-sm'
                onClick={() =>
                  setDeletedTests(
                    a.id,
                    [...deleted].filter((id) => excluded.has(id)),
                  )}
              >
                <Undo2 tw='w-[13px] h-[13px]' />
                {tr(
                  'Restaurer les tests supprimés',
                  'Restore the deleted tests',
                )}
              </button>
            )
            : (
              <A
                params={{ dialog: 'regenerate' }}
                tw='btn btn-secondary btn-sm'
              >
                <RefreshCw tw='w-[13px] h-[13px]' />
                {tr(
                  'Régénérer avec une consigne',
                  'Regenerate with an instruction',
                )}
              </A>
            )}
        </div>
      )}
    </section>
  )
}

/* ---------- sections ---------- */

const subheadingTw =
  'font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-content-tertiary mb-1.5'

/**
 * A paragraph edited in place: saved on blur only when it changed, Escape
 * or an empty text brings the saved one back. Keyed by its value, so a saved
 * text remounts it and Preact never renders over what was typed.
 */
const EditableText = (
  { value, label, onSave }: {
    value: string
    label: string
    onSave: (text: string) => void
  },
) => (
  <p
    key={value}
    contentEditable='plaintext-only'
    role='textbox'
    aria-label={label}
    aria-multiline='true'
    onBlur={(e) => {
      const text = e.currentTarget.innerText.trim()
      if (text && text !== value) onSave(text)
      else e.currentTarget.innerText = value
    }}
    onKeyDown={(e) => {
      if (e.key !== 'Escape') return
      e.currentTarget.innerText = value
      e.currentTarget.blur()
    }}
    tw='m-0 -ml-2.5 px-2.5 py-2 rounded-lg border border-transparent text-[13.5px] leading-[1.65] max-w-[760px] whitespace-pre-wrap hover:border-border-strong focus:border-accent focus:bg-surface-page focus:outline-none'
  >
    {value}
  </p>
)

const saveBrief = (id: number, field: 'context' | 'mission', text: string) =>
  updateBrief(id, field, text)
    .then(() =>
      notify({
        status: 'success',
        description: field === 'context'
          ? tr('Contexte enregistré.', 'Context saved.')
          : tr('Mission enregistrée.', 'Task saved.'),
      })
    )
    .catch((err) => notify({ status: 'failure', description: err.message }))

/** The brief as the candidate reads it in C2 (side panel « Énoncé ») */
const ContextSection = ({ a }: { a: AssessmentState }) => (
  <Collapsible
    id='contexte'
    title={tr('Contexte et mission', 'Context and task')}
  >
    <div tw='pl-4 sm:pl-[39px] pr-4 pb-4 flex flex-col gap-3'>
      <div>
        <div tw={subheadingTw}>{tr('Contexte', 'Context')}</div>
        <EditableText
          value={a.spec.candidateBrief.context}
          label={tr(
            'Contexte lu par le candidat',
            'Context read by the candidate',
          )}
          onSave={(text) => saveBrief(a.id, 'context', text)}
        />
      </div>
      <div>
        <div tw={subheadingTw}>{tr('Mission', 'Task')}</div>
        <EditableText
          value={a.spec.candidateBrief.mission}
          label={tr(
            'Mission lue par le candidat',
            'Task read by the candidate',
          )}
          onSave={(text) => saveBrief(a.id, 'mission', text)}
        />
        <span tw='text-[11.5px] text-content-tertiary inline-flex items-center gap-1'>
          <Pencil tw='w-[11px] h-[11px]' />
          {tr(
            'Cliquez sur un texte pour le modifier : c’est celui que lit le candidat.',
            'Click a text to edit it: it is the one the candidate reads.',
          )}
        </span>
      </div>
      <div>
        <div tw={subheadingTw}>
          {tr('Contraintes', 'Constraints')}
        </div>
        <ul tw='m-0 pl-[18px] text-[13px] text-content-secondary flex flex-col gap-[3px]'>
          {a.spec.constraints.map((c) => <li key={c}>{c}</li>)}
        </ul>
      </div>
    </div>
  </Collapsible>
)

const RequirementsSection = (
  { a, cover, alert }: {
    a: AssessmentState
    cover: Record<string, string[]>
    alert: boolean
  },
) => (
  <Collapsible
    id='exigences'
    title={tr('Exigences', 'Requirements')}
    count={a.spec.requirements.length}
    alert={alert}
  >
    <div tw='px-4 pb-4 grid grid-cols-cards gap-2.5'>
      {a.spec.requirements.map((r) => {
        const n = cover[r.id]?.length || 0
        return (
          <article
            key={r.id}
            tw={[
              'p-3.5 rounded-[10px] border flex flex-col gap-2',
              n
                ? 'border-border-primary bg-surface-elevated'
                : 'border-err bg-err-soft',
            ]}
          >
            <div tw='flex items-center gap-2'>
              <span tw='font-mono font-bold text-[12px] h-5 px-1.5 rounded-[5px] bg-surface-sunken border border-border-primary inline-flex items-center'>
                {r.id}
              </span>
              <h3 tw='m-0 text-[14px] font-semibold flex-1'>{r.title}</h3>
            </div>
            <p tw='m-0 text-[13px] text-content-secondary'>{r.statement}</p>
            <div tw='px-2.5 py-2 rounded-lg bg-surface-sunken text-[12.5px] text-content-secondary'>
              <strong tw='font-semibold text-content-primary'>
                {tr('Pourquoi ·', 'Why ·')}
              </strong>{' '}
              {r.why}
            </div>
            <div tw='flex items-center gap-1.5 flex-wrap mt-auto'>
              {r.skills.map((k) => (
                <span
                  key={k}
                  tw='h-5 px-[7px] rounded-[5px] border border-border-strong text-[11.5px] text-content-secondary inline-flex items-center'
                >
                  {tv(k)}
                </span>
              ))}
              <span tw='flex-1' />
              <span
                tw={[
                  'inline-flex items-center gap-1 text-[12px] font-medium',
                  n ? 'text-content-secondary' : 'text-err',
                ]}
              >
                {n ? <FlaskConical tw='w-3 h-3' /> : <CircleX tw='w-3 h-3' />}
                {n
                  ? tr(
                    `${n} test${n > 1 ? 's' : ''} lié${n > 1 ? 's' : ''}`,
                    `${n} linked test${n > 1 ? 's' : ''}`,
                  )
                  : tr('Aucun test', 'No test')}
              </span>
            </div>
          </article>
        )
      })}
    </div>
  </Collapsible>
)

const SkillsSection = ({ a }: { a: AssessmentState }) => (
  <Collapsible
    id='competences'
    title={tr('Compétences', 'Skills')}
    count={a.spec.skills.length}
  >
    <div tw='border-t border-border-primary overflow-x-auto'>
      <table tw='w-full min-w-[640px] border-collapse text-[13px]'>
        <thead>
          <tr tw='bg-surface-sunken text-content-tertiary text-[12px] text-left'>
            <th tw='px-4 py-2 font-medium'>{tr('Compétence', 'Skill')}</th>
            <th tw='px-2.5 py-2 font-medium'>{tr('Importance', 'Weight')}</th>
            <th tw='px-2.5 py-2 font-medium'>{tr('Méthode', 'Method')}</th>
            <th tw='pl-2.5 pr-4 py-2 font-medium'>
              {tr('Justification', 'Rationale')}
            </th>
          </tr>
        </thead>
        <tbody>
          {a.spec.skills.map((k) => {
            const questionsOnly = k.methods.length === 1 &&
              k.methods[0] === 'Questions'
            return (
              <tr key={k.name} tw='border-t border-border-primary align-top'>
                <td tw='px-4 py-2.5 font-medium'>{tv(k.name)}</td>
                <td tw='px-2.5 py-2.5'>
                  <span tw='inline-flex items-center gap-1.5 text-[12.5px] text-content-secondary'>
                    <span tw='inline-flex gap-0.5 items-end' aria-hidden>
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          tw={[
                            'w-1 rounded-[1px]',
                            i < importanceBars[k.importance]
                              ? 'bg-content-secondary'
                              : 'bg-border-strong',
                          ]}
                          style={{ height: `${10 + i * 3}px` }}
                        />
                      ))}
                    </span>
                    {tv(k.importance)}
                  </span>
                </td>
                <td tw='px-2.5 py-2.5'>
                  <span tw='flex gap-1 flex-wrap'>
                    {k.methods.map((m) => <MethodBadge key={m} method={m} />)}
                  </span>
                </td>
                <td tw='pl-2.5 pr-4 py-2.5 text-content-secondary'>
                  {k.justification}
                  {questionsOnly && (
                    <span tw='flex items-center gap-[5px] mt-1 text-[12px] text-warn'>
                      <TriangleAlert tw='w-3 h-3 flex-none' />
                      {tr(
                        'Évalué par des questions : l’environnement n’a pas de base de données.',
                        'Assessed by questions: the environment has no database.',
                      )}
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  </Collapsible>
)

const ApiSection = ({ a }: { a: AssessmentState }) => (
  <Collapsible
    id='api'
    title={tr('Contrat d’API', 'API contract')}
    count={`${a.spec.routes.length} routes`}
  >
    <div tw='border-t border-border-primary overflow-x-auto'>
      <table tw='w-full min-w-[640px] border-collapse text-[13px]'>
        <thead>
          <tr tw='bg-surface-sunken text-content-tertiary text-[12px] text-left'>
            <th tw='px-4 py-2 font-medium w-[84px]'>
              {tr('Méthode', 'Method')}
            </th>
            <th tw='px-2.5 py-2 font-medium'>{tr('Chemin', 'Path')}</th>
            <th tw='px-2.5 py-2 font-medium'>Description</th>
            <th tw='pl-2.5 pr-4 py-2 font-medium'>
              {tr('Codes de réponse', 'Response codes')}
            </th>
          </tr>
        </thead>
        <tbody>
          {a.spec.routes.map((r) => (
            <tr key={r.method + r.path} tw='border-t border-border-primary'>
              <td
                tw={[
                  'px-4 py-2.5 font-mono font-bold text-[12px]',
                  methodColor[r.method],
                ]}
              >
                {r.method}
              </td>
              <td tw='px-2.5 py-2.5 font-mono text-[12.5px]'>{r.path}</td>
              <td tw='px-2.5 py-2.5 text-content-secondary'>{r.description}</td>
              <td tw='pl-2.5 pr-4 py-2.5'>
                <span tw='flex gap-1 flex-wrap'>
                  {r.codes.map((c) => (
                    <span
                      key={c}
                      tw='h-5 px-1.5 rounded-[5px] bg-surface-sunken border border-border-primary font-mono text-[11.5px] inline-flex items-center'
                    >
                      {c}
                    </span>
                  ))}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </Collapsible>
)

const TestRow = (
  { t, deleted, excluded, referenceFailure, onDelete, onRestore }: {
    t: TestCase
    deleted: boolean
    /** reason of the fairness check (api/reference.ts) */
    excluded?: string
    /** the reference solution fails this test (api/reference.ts) */
    referenceFailure?: {
      received?: string
      reason?: string
      fault?: 'test' | 'solution'
    }
    onDelete: () => void
    onRestore: () => void
  },
) => {
  const isConfirming = confirming.value === t.id && !deleted
  const open = !deleted && !!openTests.value[t.id]
  return (
    <div
      tw={[
        'group border-t border-border-primary',
        isConfirming ? 'bg-err-soft' : !deleted && 'hover:bg-surface-hover',
        deleted && 'opacity-[.55]',
      ]}
    >
      <div tw='flex items-center gap-2.5 min-h-[42px] py-1 pl-4 pr-3 text-[13px] flex-wrap'>
        <span tw='w-7 font-mono font-bold text-[12px] text-content-secondary'>
          {t.id}
        </span>
        <span
          tw={['flex-1 min-w-[min(220px,100%)]', deleted && 'line-through']}
        >
          <span tw='font-mono text-[12.5px]'>{t.route}</span> {t.condition}{' '}
          <span tw='text-content-tertiary'>→</span>{' '}
          <strong tw='font-mono font-bold text-[12.5px]'>{t.expected}</strong>
        </span>
        <VisibilityBadge visibility={t.visibility} />
        <AnchorLink
          to='exigences'
          tw='h-5 px-1.5 rounded-[5px] bg-surface-sunken font-mono text-[11.5px] text-content-secondary inline-flex items-center gap-[3px] no-underline'
        >
          <Link2 tw='w-[11px] h-[11px]' />
          {t.requirementIds.join(' · ')}
        </AnchorLink>
        {isConfirming && (
          <span tw='inline-flex items-center gap-1.5 text-[12.5px] text-err'>
            {tr(`Supprimer ${t.id} ?`, `Delete ${t.id}?`)}
            <button
              type='button'
              tw='btn btn-secondary h-[26px] px-[9px] text-[12px] font-normal'
              onClick={() => confirming.value = null}
            >
              {tr('Annuler', 'Cancel')}
            </button>
            <button
              type='button'
              tw='btn btn-danger h-[26px] px-[9px] text-[12px]'
              onClick={onDelete}
            >
              {tr('Supprimer', 'Delete')}
            </button>
          </span>
        )}
        {!deleted && !isConfirming && (
          <>
            <button
              type='button'
              tw='btn btn-ghost h-[26px] px-2 text-[12.5px] text-accent-text'
              aria-expanded={open}
              onClick={() =>
                openTests.value = { ...openTests.value, [t.id]: !open }}
            >
              {tr('Voir le détail', 'See the details')}
              {open
                ? <ChevronUp tw='w-[13px] h-[13px]' />
                : <ChevronDown tw='w-[13px] h-[13px]' />}
            </button>
            <button
              type='button'
              aria-label={tr('Supprimer ce test', 'Delete this test')}
              title={tr('Supprimer ce test', 'Delete this test')}
              onClick={() => confirming.value = t.id}
              tw='btn btn-ghost w-7 h-7 px-0 text-content-tertiary opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-err-soft hover:text-err'
            >
              <Trash2 tw='w-[15px] h-[15px]' />
            </button>
          </>
        )}
        {deleted && (
          <>
            <span tw='text-[12px] text-content-tertiary'>
              {tr('Supprimé', 'Deleted')}
            </span>
            <button
              type='button'
              tw='btn btn-secondary h-[26px] px-[9px] text-[12px] font-normal'
              onClick={onRestore}
            >
              <Undo2 tw='w-3 h-3' />
              {tr('Restaurer', 'Restore')}
            </button>
          </>
        )}
      </div>
      {!deleted && referenceFailure && (
        // judged fair by the model, still failed: blocks until resolved
        referenceFailure.fault === 'solution'
          ? (
            <p tw='mx-4 sm:ml-[54px] mb-2.5 mt-0 flex items-start gap-1.5 text-[12.5px] text-warn'>
              <TriangleAlert tw='w-[13px] h-[13px] flex-none mt-[3px]' />
              <span>
                {tr(
                  'Test jugé conforme à l’énoncé par l’IA, mais la solution de référence échoue :',
                  'Test judged consistent with the brief by the AI, but the reference solution fails:',
                )} {referenceFailure.reason} {tr(
                  'Vérifiez le test ; s’il est faux, supprimez-le.',
                  'Check the test; if it is wrong, delete it.',
                )}
              </span>
            </p>
          )
          : (
            <p tw='mx-4 sm:ml-[54px] mb-2.5 mt-0 flex items-start gap-1.5 text-[12.5px] text-err'>
              <CircleX tw='w-[13px] h-[13px] flex-none mt-[3px]' />
              <span>
                {tr(
                  'La solution écrite depuis l’énoncé échoue à ce test',
                  'The solution written from the brief fails this test',
                )}
                {referenceFailure.received
                  ? ` (${tr('reçu :', 'received:')} ${
                    clip(referenceFailure.received)
                  })`
                  : ''}. {referenceFailure.reason ??
                  tr(
                    'Vérifiez que l’énoncé le justifie, sinon supprimez-le.',
                    'Check that the brief justifies it, otherwise delete it.',
                  )}
              </span>
            </p>
          )
      )}
      {deleted && excluded && (
        <p tw='mx-4 sm:ml-[54px] mb-2.5 mt-0 flex items-start gap-1.5 text-[12.5px] text-content-secondary'>
          <ShieldCheck tw='w-[13px] h-[13px] flex-none mt-[3px]' />
          <span>
            {tr(
              'Écarté par la vérification d’équité :',
              'Excluded by the fairness check:',
            )} {excluded}
          </span>
        </p>
      )}
      {open && (
        <ol tw='mx-4 sm:ml-[54px] mb-3 p-0 list-none rounded-lg border border-border-primary bg-code-bg font-mono text-[12px] leading-[1.6] overflow-hidden'>
          {t.steps.map((s, i) => (
            <li
              key={i}
              tw='grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1 px-3 py-2 border-t border-border-primary first:border-t-0'
            >
              <span>
                <span tw='block font-main font-bold text-[10.5px] text-content-tertiary uppercase tracking-[0.05em]'>
                  {i + 1} · {tr('Requête', 'Request')}
                </span>
                <span tw='text-code-text break-all'>{s.request}</span>
              </span>
              <span>
                <span tw='block font-main font-bold text-[10.5px] text-content-tertiary uppercase tracking-[0.05em]'>
                  {tr('Réponse attendue', 'Expected response')}
                </span>
                <span tw='text-code-text break-all'>{s.response}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/** first line of an output, 120 characters at most */
const clip = (text: string) => {
  const line = text.split('\n')[0]
  return line.length > 120 ? `${line.slice(0, 119)}…` : line
}

const referenceFailure = (a: AssessmentState, id: string) => {
  const result = a.reference?.results.find((r) => r.id === id)
  return result && !result.passed ? result : undefined
}

const TestsSection = (
  { a, deleted }: { a: AssessmentState; deleted: Set<string> },
) => {
  const alive = a.spec.tests.filter((t) => !deleted.has(t.id))
  const pub = alive.filter((t) => t.visibility === 'public').length
  const setDeleted = (ids: string[]) => setDeletedTests(a.id, ids)
  return (
    <Collapsible
      id='tests'
      title='Tests'
      count={tr(
        `${pub} publics + ${alive.length - pub} cachés`,
        `${pub} public + ${alive.length - pub} hidden`,
      )}
    >
      <div>
        {a.spec.tests.map((t) => (
          <TestRow
            key={t.id}
            t={t}
            deleted={deleted.has(t.id)}
            excluded={a.reference?.excluded.find((e) => e.id === t.id)?.reason}
            referenceFailure={referenceFailure(a, t.id)}
            onDelete={() => {
              setDeleted([...deleted, t.id])
              confirming.value = null
              notify({
                status: 'info',
                description: tr(
                  `${t.id} supprimé. Les vérifications ont été relancées.`,
                  `${t.id} deleted. The checks were run again.`,
                ),
              })
            }}
            onRestore={() => setDeleted([...deleted].filter((x) => x !== t.id))}
          />
        ))}
      </div>
    </Collapsible>
  )
}

const TraceabilitySection = (
  { a, cover, deleted, alert }: {
    a: AssessmentState
    cover: Record<string, string[]>
    deleted: Set<string>
    alert: boolean
  },
) => {
  const cols =
    `minmax(150px,1.6fr) repeat(${a.spec.tests.length},minmax(36px,1fr))`
  return (
    <Collapsible
      id='tracabilite'
      title={tr('Traçabilité', 'Traceability')}
      count={tr('Exigences × tests', 'Requirements × tests')}
      alert={alert}
    >
      <div tw='px-4 pb-4 overflow-x-auto'>
        <div
          role='table'
          tw='min-w-[640px] text-[12.5px] border border-border-primary rounded-lg overflow-hidden'
        >
          <div
            role='row'
            tw='grid bg-surface-sunken'
            style={{ gridTemplateColumns: cols }}
          >
            <span
              role='columnheader'
              tw='px-3 py-2 text-content-tertiary text-[12px]'
            >
              {tr('Exigence', 'Requirement')}
            </span>
            {a.spec.tests.map((t) => (
              <span
                key={t.id}
                role='columnheader'
                tw={[
                  'py-2 flex items-center justify-center gap-0.5 font-mono font-bold text-[11.5px] border-l border-border-primary',
                  deleted.has(t.id)
                    ? 'text-content-tertiary line-through'
                    : 'text-content-secondary',
                ]}
              >
                {t.id}
                {t.visibility === 'caché' && <EyeOff tw='w-2.5 h-2.5' />}
              </span>
            ))}
          </div>
          {a.spec.requirements.map((r) => {
            const none = !cover[r.id]?.length
            return (
              <div
                key={r.id}
                role='row'
                tw={[
                  'grid border-t border-border-primary',
                  none && 'bg-err-soft shadow-[inset_3px_0_0_var(--color-err)]',
                ]}
                style={{ gridTemplateColumns: cols }}
              >
                <span tw='px-3 py-2 flex items-center gap-1.5 min-w-0'>
                  <span tw='font-mono font-bold text-[12px]'>{r.id}</span>
                  <span
                    tw={[
                      'truncate text-[12px]',
                      none
                        ? 'text-err font-semibold'
                        : 'text-content-secondary',
                    ]}
                  >
                    {none ? tr('Aucun test', 'No test') : r.title}
                  </span>
                </span>
                {a.spec.tests.map((t) => {
                  const on = !deleted.has(t.id) &&
                    t.requirementIds.includes(r.id)
                  return (
                    <span
                      key={t.id}
                      role='cell'
                      aria-label={on
                        ? tr(`${t.id} couvre ${r.id}`, `${t.id} covers ${r.id}`)
                        : undefined}
                      tw='flex items-center justify-center min-h-[34px] border-l border-border-primary'
                    >
                      {on && (
                        <Check tw='w-3.5 h-3.5 text-ok' stroke-width={2.5} />
                      )}
                    </span>
                  )
                })}
              </div>
            )
          })}
        </div>
        <div tw='flex gap-4 mt-2 text-[12px] text-content-tertiary flex-wrap'>
          <span tw='inline-flex items-center gap-1'>
            <Check tw='w-3 h-3 text-ok' stroke-width={2.5} />
            {tr('Test lié à l’exigence', 'Test linked to the requirement')}
          </span>
          <span tw='inline-flex items-center gap-1'>
            <EyeOff tw='w-[11px] h-[11px]' />
            {tr('Test caché', 'Hidden test')}
          </span>
          <span tw='inline-flex items-center gap-1'>
            <span tw='w-2.5 h-2.5 rounded-sm bg-err-soft border border-err' />
            {tr('Exigence sans test', 'Requirement without a test')}
          </span>
        </div>
      </div>
    </Collapsible>
  )
}

/* ---------- regenerate ---------- */

const REGEN_STEPS = () => [
  tr('Analyse de la consigne', 'Analysing the instruction'),
  tr(
    'Réécriture du scénario et des exigences',
    'Rewriting the scenario and requirements',
  ),
  tr('Régénération des tests', 'Regenerating the tests'),
  tr('Vérifications automatiques', 'Automatic checks'),
]

const startRegeneration = (id: number, prompt: string) => {
  navigate({ params: { dialog: null } })
  regenerating.value = true
  regenerateAssessment(
    id,
    prompt.trim() ||
      tr(
        'Rendre l’épreuve un peu plus difficile',
        'Make the assessment a bit harder',
      ),
  ).catch((err) => {
    regenerating.value = false
    notify({ status: 'failure', description: err.message })
  })
}

const RegenerateDialog = ({ id }: { id: number }) => {
  const [text, setText] = useState('')
  return (
    <ModalDialog
      id='regenerate'
      heading={tr(
        'Régénérer avec une consigne',
        'Regenerate with an instruction',
      )}
    >
      <p tw='m-0 text-[13px] text-content-secondary'>
        {tr(
          'L’épreuve sera réécrite par le modèle, puis revérifiée. Vos modifications manuelles seront perdues.',
          'The model will rewrite the assessment, then check it again. Your manual edits will be lost.',
        )}
      </p>
      <Textarea
        name='regenerate-prompt'
        rows={4}
        value={text}
        onInput={(e) => setText(e.currentTarget.value)}
        placeholder={tr(
          'Ex. : rendre l’épreuve un peu plus difficile',
          'E.g. make the assessment a bit harder',
        )}
      />
      <div tw='flex justify-end gap-2'>
        <A params={{ dialog: null }} tw='btn btn-secondary'>
          {tr('Annuler', 'Cancel')}
        </A>
        <button
          type='button'
          tw='btn btn-primary'
          onClick={() => {
            startRegeneration(id, text)
            setText('')
          }}
        >
          <RefreshCw tw='w-3.5 h-3.5' />
          {tr('Régénérer', 'Regenerate')}
        </button>
      </div>
    </ModalDialog>
  )
}

const RegenerationOverlay = ({ a }: { a: AssessmentState }) => {
  const progress = a.generation?.steps ?? []
  const steps: OperationStep[] = REGEN_STEPS().map((label, i) => ({
    label,
    state: progress[i]?.state ?? 'wait',
    detail: progress[i]?.fallback && progress[i].state === 'run'
      ? fallbackDetail(progress[i].fallbackReason)
      : undefined,
    trace: progress[i]?.trace,
  }))
  return (
    <div tw='fixed inset-0 z-50 bg-scrim flex items-center justify-center p-4 sm:p-6'>
      <div
        role='status'
        aria-live='polite'
        tw='w-[520px] max-w-full card shadow-[var(--shadow-lg)] px-[22px] py-5 flex flex-col gap-3.5'
      >
        <div tw='flex items-baseline justify-between gap-3'>
          <h2 tw='m-0 text-[16px] font-semibold'>
            {tr('Régénération de l’épreuve', 'Regenerating the assessment')}
          </h2>
          <span tw='text-[12.5px] text-content-tertiary whitespace-nowrap'>
            {tr('environ 30 s', 'about 30 s')}
          </span>
        </div>
        <p tw='m-0 px-2.5 py-2 rounded-lg bg-surface-sunken text-[12.5px] text-content-secondary'>
          <strong tw='font-semibold text-content-primary'>
            {tr('Consigne ·', 'Instruction ·')}
          </strong>{' '}
          {a.generation?.instruction}
        </p>
        <OperationStepper steps={steps} />
      </div>
    </div>
  )
}

/* ---------- page ---------- */

const Loading = () => (
  <main tw='flex-1 flex items-center justify-center py-16'>
    <Spinner tw='w-5 h-5 text-content-tertiary' />
  </main>
)

/** R4 — review and approval of the generated assessment */
export const ReviewPage = () => {
  const a = getAssessment(url.params.id)
  // ?variante=echec replays the failed-check variant (T7 deleted)
  useEffect(() => {
    if (a && url.params.variante === 'echec') setDeletedTests(a.id, ['T7'])
  }, [a?.id])
  const regenerationRunning = a?.status === 'generating' &&
    a.generation?.kind === 'regeneration'
  // end of a regeneration: the draft is rewritten and rechecked
  useEffect(() => {
    if (!a || regenerationRunning || !regenerating.peek()) return
    regenerating.value = false
    openTests.value = {}
    confirming.value = null
    const error = a.generation?.error
    notify(
      error
        ? {
          status: 'failure',
          description: tr(
            `La régénération a échoué : ${error}`,
            `The regeneration failed: ${error}`,
          ),
        }
        : {
          status: 'success',
          description: tr(
            'Épreuve régénérée. Les vérifications ont été relancées.',
            'Assessment regenerated. The checks were run again.',
          ),
        },
    )
  }, [regenerationRunning])
  const active = useActiveSection(SECTION_IDS)
  if (!a) {
    return assessmentStatus.value === 'loading' ? <Loading /> : <NotFoundPage />
  }
  // generation (R3) or its failure are shown on the R2 page
  if (
    a.status === 'failed' || (a.status === 'generating' && !regenerationRunning)
  ) {
    navigate({ href: paths.newAssessment, params: { id: a.id }, replace: true })
    return null
  }
  if (a.status === 'approved' && !url.params.variante) {
    navigate({
      href: paths.assessment,
      params: { id: a.id },
      replace: true,
    })
    return null
  }
  const deleted = new Set(deletedTests.value[a.id] || [])
  const { cover, uncovered, checks, blocked } = computeChecks(
    a.spec,
    deleted,
    a.starterFails ?? true,
    a.reference,
  )
  const alert = uncovered.length > 0
  return (
    <div tw='w-full max-w-[1320px] mx-auto px-4 sm:px-8 pt-6 sm:pt-7 grid grid-cols-1 xl:grid-cols-nav-main gap-8'>
      <nav
        aria-label={tr('Sections', 'Sections')}
        tw='hidden xl:flex sticky top-20 self-start flex-col gap-px text-[13px]'
      >
        <span tw='font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-content-tertiary px-2.5 pb-2'>
          {tr('Épreuve', 'Assessment')}
        </span>
        {SECTIONS().map(([id, label]) => (
          <AnchorLink
            key={id}
            to={id}
            aria-current={active === id ? 'location' : undefined}
            tw={navLinkTw(active === id)}
          >
            {label}
            {alert && (id === 'exigences' || id === 'tracabilite') && (
              <CircleX
                tw='w-[13px] h-[13px] text-err ml-auto'
                aria-label={tr('Problème', 'Problem')}
              />
            )}
          </AnchorLink>
        ))}
      </nav>
      <main tw='min-w-0 flex flex-col gap-5 pb-16'>
        <Header a={a} blocked={blocked} />
        <ChecksBanner
          a={a}
          deleted={deleted}
          checks={checks}
          uncovered={uncovered}
        />
        <ContextSection a={a} />
        <RequirementsSection a={a} cover={cover} alert={alert} />
        <SkillsSection a={a} />
        <ApiSection a={a} />
        <TestsSection a={a} deleted={deleted} />
        <TraceabilitySection
          a={a}
          cover={cover}
          deleted={deleted}
          alert={alert}
        />
      </main>
      <RegenerateDialog id={a.id} />
      {regenerationRunning && <RegenerationOverlay a={a} />}
    </div>
  )
}
