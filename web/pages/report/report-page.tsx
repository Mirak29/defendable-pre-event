import { paths } from '/web/paths.ts'
import {
  reportError,
  type ReportView,
  reportView,
  retryReport,
} from '/web/lib/report-store.ts'
import type { Report } from '/web/types.ts'
import { AiErrorBanner } from '/web/ui/stepper.tsx'
import { Spinner } from '/web/ui/spinner.tsx'
import { formatDate, formatMinutes } from '/web/lib/format.ts'
import { AnchorLink, BackLink, navLinkTw } from '/web/ui/page.tsx'
import { useActiveSection } from '/web/lib/scroll-spy.ts'
import { CodeDrawer } from '/web/ui/code-view.tsx'
import { NotFoundPage } from '/web/pages/not-found-page.tsx'
import {
  CodeAnalysis,
  Debrief,
  Execution,
  Integrity,
  Limits,
  QuestionsAnswers,
  SECTIONS,
  Summary,
  Trace,
} from '/web/pages/report/report-sections.tsx'
import { DecisionPanel } from '/web/pages/report/decision-panel.tsx'
import {
  ExternalLink,
  Hammer,
  Mail,
  MessagesSquare,
  Scale,
} from '/web/assets/icons.tsx'
import { t, tv } from '/web/lib/i18n.ts'

const candidateName = (view: ReportView) =>
  view.identity
    ? `${view.identity.firstName} ${view.identity.lastName}`
    : undefined

const Header = ({ view, r }: { view: ReportView; r: Report }) => (
  <header tw='flex flex-col gap-3'>
    <BackLink href={`${paths.assessment}?id=${view.assessmentId}`}>
      {view.assessmentTitle}
    </BackLink>
    <div tw='flex items-baseline gap-3 flex-wrap'>
      <h1 tw='m-0 text-[24px] sm:text-[26px] font-semibold'>
        {candidateName(view) ?? r.candidate}
      </h1>
      <span tw='text-content-tertiary text-[13px]'>
        {t('Rapport d’évaluation', 'Assessment report')} · {formatDate(r.date)}
      </span>
    </div>
    {view.identity && (
      // U4, D7: the company sees who took the assessment, never the models
      <div
        data-test='candidate-identity'
        tw='flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-content-secondary items-center'
      >
        <span tw='inline-flex items-center gap-1.5'>
          <Mail tw='w-3.5 h-3.5 text-content-tertiary' />
          <a href={`mailto:${view.identity.email}`}>{view.identity.email}</a>
        </span>
        {view.identity.profileUrl && (
          <a
            href={view.identity.profileUrl}
            target='_blank'
            rel='noopener noreferrer'
            tw='inline-flex items-center gap-1.5'
          >
            <ExternalLink tw='w-3.5 h-3.5' />
            {t('Profil', 'Profile')}
          </a>
        )}
        <span tw='text-content-tertiary'>
          {t('Pseudonyme :', 'Pseudonym:')} {view.pseudonym}
        </span>
        {view.identity.note && (
          <span tw='basis-full'>
            {t('Note interne :', 'Internal note:')} {view.identity.note}
          </span>
        )}
      </div>
    )}
    <div tw='flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-content-secondary items-center'>
      <span tw='inline-flex items-center gap-1.5'>
        <Hammer tw='w-3.5 h-3.5 text-content-tertiary' />
        {t('Construction', 'Building')}{' '}
        <strong tw='font-semibold text-content-primary'>
          {formatMinutes(r.buildMinutes)}
        </strong>{' '}
        / {formatMinutes(r.buildLimitMinutes)}
      </span>
      <span tw='inline-flex items-center gap-1.5'>
        <MessagesSquare tw='w-3.5 h-3.5 text-content-tertiary' />
        {t('Questions', 'Questions')}{' '}
        <strong tw='font-semibold text-content-primary'>
          {formatMinutes(r.questionsMinutes)}
        </strong>
      </span>
      <span tw='inline-flex items-center gap-1.5 flex-wrap'>
        {t('Outils IA déclarés', 'Declared AI tools')}
        {r.declaredTools.map((tool) => (
          <span key={tool} tw='badge badge-neutral h-[22px]'>{tv(tool)}</span>
        ))}
      </span>
    </div>
    <div tw='flex items-center gap-2 flex-wrap px-3.5 py-2.5 rounded-[10px] border border-border-strong bg-surface-sunken text-[13px] text-content-secondary'>
      <Scale tw='w-[15px] h-[15px] flex-none text-content-primary' />
      <strong tw='font-semibold text-content-primary'>
        {t(
          'Aide à la décision. Aucun score global.',
          'Decision support. No overall score.',
        )}
      </strong>
      {t(
        'Chaque dimension est présentée avec ses preuves ; la décision vous revient.',
        'Each dimension comes with its evidence; the decision is yours.',
      )}
    </div>
  </header>
)

/**
 * R6 — the report. Anchors on the left, 880 px of content, sticky decision
 * column on the right (below 1280 px the anchors hide, below 1024 px the
 * decision goes under the content).
 */
const SECTION_IDS = SECTIONS().map(([id]) => id)

const Waiting = ({ view }: { view?: ReportView }) => (
  <main tw='flex-1 w-full max-w-[640px] mx-auto px-4 sm:px-8 py-16 flex flex-col gap-4'>
    {view && (
      <BackLink href={`${paths.assessment}?id=${view.assessmentId}`}>
        {view.assessmentTitle}
      </BackLink>
    )}
    {view?.status === 'failed'
      ? (
        <AiErrorBanner
          final
          onRetry={() => retryReport(view.candidateId)}
          message={view.error}
          failures={view.failures}
        />
      )
      : (
        <div
          role='status'
          tw='card px-5 py-4 flex items-center gap-3 text-[14px]'
        >
          <Spinner tw='w-4 h-4' />
          {view
            ? t(
              `Rapport de ${
                candidateName(view) ?? view.pseudonym
              } en cours de génération…`,
              `Report of ${
                candidateName(view) ?? view.pseudonym
              } being generated…`,
            )
            : t('Chargement du rapport…', 'Loading the report…')}
        </div>
      )}
  </main>
)

export const ReportPage = () => {
  const view = reportView.value
  const active = useActiveSection(SECTION_IDS)
  if (!view) return reportError.value ? <NotFoundPage /> : <Waiting />
  const r = view.report
  if (view.status !== 'ready' || !r) return <Waiting view={view} />
  return (
    <div tw='w-full max-w-[1400px] mx-auto px-4 sm:px-8 pt-7 pb-16 grid grid-cols-1 lg:grid-cols-report-md xl:grid-cols-report justify-center gap-8'>
      <nav
        aria-label={t('Sections du rapport', 'Report sections')}
        tw='hidden xl:flex sticky top-20 self-start flex-col gap-px text-[13px]'
      >
        <span tw='font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-content-tertiary px-2.5 pb-2'>
          {t('Rapport', 'Report')}
        </span>
        {SECTIONS().map(([id, label], i) => (
          <AnchorLink
            key={id}
            to={id}
            aria-current={active === id ? 'location' : undefined}
            tw={navLinkTw(active === id)}
          >
            <span tw='w-3 font-mono text-[11.5px] text-content-tertiary'>
              {i + 1}
            </span>
            {label}
          </AnchorLink>
        ))}
      </nav>
      <main tw='min-w-0 flex flex-col gap-7'>
        <Header view={view} r={r} />
        <Summary report={r} />
        {view.results && (
          <Execution
            results={view.results}
            tests={view.tests}
          />
        )}
        <CodeAnalysis report={r} />
        <QuestionsAnswers report={r} />
        <Integrity report={r} />
        <Debrief report={r} />
        <Limits report={r} />
        <Trace report={r} />
      </main>
      <DecisionPanel
        key={view.candidateId}
        candidateId={view.candidateId}
        saved={view.decision}
      />
      <CodeDrawer files={view.files} />
    </div>
  )
}
