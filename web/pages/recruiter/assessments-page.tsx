import { paths } from '/web/paths.ts'
import { useEffect } from 'npm:preact/hooks'
import { A, navigate, url } from '/web/lib/router-signal.ts'
import {
  assessments,
  assessmentsLoading,
  loadAssessments,
} from '/web/lib/assessment-store.ts'
import type { AssessmentState } from '/web/types.ts'
import { formatDate, levelLabels } from '/web/lib/format.ts'
import { Badge } from '/web/ui/badge.tsx'
import { TableWrap, td, th, THead } from '/web/ui/page.tsx'
import { Spinner } from '/web/ui/spinner.tsx'
import {
  BadgeCheck,
  CircleX,
  ClipboardList,
  FilePenLine,
  Plus,
} from '/web/assets/icons.tsx'
import { lang, t } from '/web/lib/i18n.ts'
import { member } from '/web/lib/member-store.ts'

const StatusBadge = ({ status }: { status: AssessmentState['status'] }) =>
  status === 'approved'
    ? (
      <Badge variant='success' tw='font-semibold'>
        <BadgeCheck tw='w-[13px] h-[13px]' />
        {t('Approuvée', 'Approved')}
      </Badge>
    )
    : status === 'generating'
    ? (
      <Badge variant='accent'>
        <Spinner tw='w-3 h-3' />
        {t('Génération…', 'Generating…')}
      </Badge>
    )
    : status === 'failed'
    ? (
      <Badge variant='error'>
        <CircleX tw='w-3 h-3' />
        {t('Échec de génération', 'Generation failed')}
      </Badge>
    )
    : (
      <Badge tw='border-dashed border-border-strong'>
        <FilePenLine tw='w-3 h-3' />
        {t('Brouillon', 'Draft')}
      </Badge>
    )

// R3 progress and errors are shown on the R2 page
const hrefOf = (a: AssessmentState) =>
  a.status === 'approved'
    ? paths.assessment
    : a.status === 'draft'
    ? paths.review
    : paths.newAssessment

const NewButton = () => (
  <A href={paths.newAssessment} tw='btn btn-primary h-9'>
    <Plus tw='w-[15px] h-[15px]' />
    {t('Nouvelle épreuve', 'New assessment')}
  </A>
)

const Empty = () => (
  <div tw='px-6 py-14 rounded-xl border border-dashed border-border-strong bg-surface-elevated flex flex-col items-center gap-3.5 text-center'>
    <span tw='w-11 h-11 rounded-[10px] border border-border-strong inline-flex items-center justify-center text-content-tertiary'>
      <ClipboardList tw='w-5 h-5' />
    </span>
    <p tw='m-0 text-[14px] text-content-secondary max-w-[420px]'>
      {t(
        'Aucune épreuve. Décrivez un poste pour générer votre première épreuve.',
        'No assessment yet. Describe a job to generate your first one.',
      )}
    </p>
    <NewButton />
  </div>
)

/** R1 — list of the recruiter's assessments */
export const AssessmentsPage = () => {
  useEffect(() => {
    loadAssessments()
  }, [])
  // ?etat=vide shows the empty state of the prototype
  // the demo space holds the demo in French and in English: the one of the
  // language of the site
  const demo = member.value?.demo === true
  const list = url.params.etat === 'vide'
    ? []
    : assessments.value.filter((a) => !demo || a.input.language === lang.value)
  if (assessmentsLoading.value && url.params.etat !== 'vide') {
    return (
      <main tw='flex-1 flex items-center justify-center py-16'>
        <Spinner tw='w-5 h-5 text-content-tertiary' />
      </main>
    )
  }
  return (
    <main tw='w-full max-w-[1120px] mx-auto px-4 sm:px-8 pt-8 pb-16 flex flex-col gap-5'>
      <div tw='flex items-center justify-between gap-4 flex-wrap'>
        <h1 tw='m-0 text-[22px] sm:text-[24px] font-semibold'>
          {t('Mes épreuves', 'My assessments')}
        </h1>
        <NewButton />
      </div>
      {list.length === 0 ? <Empty /> : (
        <TableWrap minWidth={760}>
          <THead>
            <th tw={[th, 'pl-4']}>{t('Titre', 'Title')}</th>
            <th tw={th}>{t('Niveau', 'Level')}</th>
            <th tw={th}>{t('Durée', 'Duration')}</th>
            <th tw={th}>{t('Statut', 'Status')}</th>
            <th tw={[th, 'text-right']}>{t('Candidats', 'Candidates')}</th>
            <th tw={[th, 'pr-4']}>{t('Date', 'Date')}</th>
          </THead>
          <tbody>
            {list.map((a) => {
              const href = hrefOf(a)
              return (
                <tr
                  key={a.id}
                  tw='border-t border-border-primary cursor-pointer hover:bg-surface-hover'
                  onClick={() => navigate({ href, params: { id: a.id } })}
                >
                  <td tw={[td, 'pl-4']}>
                    <A
                      href={href}
                      params={{ id: a.id }}
                      tw='text-content-primary font-medium no-underline hover:underline'
                    >
                      {a.spec.title}
                    </A>
                    <div tw='text-[12px] text-content-tertiary mt-px'>
                      {a.spec.format} · {a.spec.company}
                    </div>
                  </td>
                  <td tw={td}>{levelLabels[a.spec.level]}</td>
                  <td tw={[td, 'font-mono text-[12.5px]']}>
                    {a.spec.durationMin} min
                  </td>
                  <td tw={td}>
                    <StatusBadge status={a.status} />
                  </td>
                  <td tw={[td, 'text-right font-mono text-[12.5px]']}>
                    {a.candidates.length}
                  </td>
                  <td tw={[td, 'pr-4 text-content-secondary']}>
                    {formatDate(a.createdAt)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </TableWrap>
      )}
    </main>
  )
}
