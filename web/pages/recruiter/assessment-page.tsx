import { paths } from '/web/paths.ts'
import { useEffect, useRef, useState } from 'npm:preact/hooks'
import { A, navigate, url } from '/web/lib/router-signal.ts'
import {
  type AssessmentState,
  assessmentStatus,
  type CandidateStatus,
  type CandidateSummary,
  getAssessment,
  invitationLink,
  inviteCandidate,
  readCv,
  revokeCandidate,
  sendCandidateLink,
} from '/web/lib/assessment-store.ts'
import { member } from '/web/lib/member-store.ts'
import type { CvFields, CvReading } from '/api/cv.ts'
import type { LinkSent } from '/api/email.ts'
import { Input, Label, Textarea } from '/web/ui/form.tsx'
import { Spinner } from '/web/ui/spinner.tsx'
import { formatDate, formatMinutes, levelLabels } from '/web/lib/format.ts'
import { Badge } from '/web/ui/badge.tsx'
import {
  BackLink,
  MetaTag,
  Panel,
  TableWrap,
  td,
  th,
  THead,
} from '/web/ui/page.tsx'
import { NotFoundPage } from '/web/pages/not-found-page.tsx'
import {
  BadgeCheck,
  Ban,
  Check,
  CircleCheck,
  CircleX,
  Clock,
  Copy,
  ExternalLink,
  FilePenLine,
  FileText,
  FileUp,
  LoaderCircle,
  MailCheck,
  MailX,
  Minus,
  RefreshCw,
  Send,
  Sparkles,
  TimerOff,
  UserPlus,
} from '/web/assets/icons.tsx'
import { t, tv } from '/web/lib/i18n.ts'
import { tm } from '/web/lib/messages.ts'

// a function, not a constant: JSX needs the global `h` set up in app.tsx
const statusBadge = (status: CandidateStatus) =>
  ({
    'Invité': (
      <Badge>
        <Minus tw='w-3 h-3' />
        {tv('Invité')}
      </Badge>
    ),
    'Construction en cours': (
      <Badge variant='accent'>
        <FilePenLine tw='w-3 h-3' />
        {tv('Construction en cours')}
      </Badge>
    ),
    'Questions en cours': (
      <Badge variant='accent'>
        <LoaderCircle tw='w-3 h-3' />
        {tv('Questions en cours')}
      </Badge>
    ),
    'Terminé': (
      <Badge variant='success' tw='font-semibold'>
        <CircleCheck tw='w-[13px] h-[13px]' />
        {tv('Terminé')}
      </Badge>
    ),
    'Lien expiré': (
      <Badge variant='warning'>
        <TimerOff tw='w-3 h-3' />
        {tv('Lien expiré')}
      </Badge>
    ),
    'Révoqué': (
      <Badge>
        <Ban tw='w-3 h-3' />
        {tv('Révoqué')}
      </Badge>
    ),
  })[status]

const CopyButton = (
  { text, small, label = t('Copier', 'Copy') }: {
    text: string
    small?: boolean
    label?: string
  },
) => {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <button
      type='button'
      tw={small
        ? 'btn btn-secondary h-8 px-2.5 text-[13px]'
        : 'btn btn-primary h-9 min-w-[96px]'}
      onClick={() => {
        navigator.clipboard?.writeText(text).catch(() => {})
        setCopied(true)
      }}
    >
      {copied
        ? <Check tw='w-[15px] h-[15px]' />
        : <Copy tw='w-[15px] h-[15px]' />}
      {copied ? t('Copié', 'Copied') : label}
    </button>
  )
}

/**
 * an e-mail the recruiter sends themselves (the server sends nothing), in
 * the language of the assessment
 */
const mailto = (
  a: AssessmentState,
  firstName: string,
  email: string,
  link: string,
) => {
  const en = a.input.language === 'en'
  const subject = en
    ? `Your technical assessment: ${a.spec.title}`
    : `Votre épreuve technique : ${a.spec.title}`
  const body = en
    ? `Hello ${firstName},\n\n${a.spec.company} invites you to take the assessment “${a.spec.title}”: ${a.spec.durationMin} min to build a small API, with the AI of your choice, then 10 questions on your own code.\n\nYour personal link (valid for 14 days):\n${link}\n\nGood luck!`
    : `Bonjour ${firstName},\n\n${a.spec.company} vous invite à passer l’épreuve « ${a.spec.title} » : ${a.spec.durationMin} min pour construire une petite API, avec l’IA de votre choix, puis 10 questions sur votre propre code.\n\nVotre lien personnel (valable 14 jours) :\n${link}\n\nBonne épreuve !`
  return `mailto:${encodeURIComponent(email)}?subject=${
    encodeURIComponent(subject)
  }&body=${encodeURIComponent(body)}`
}

const field = (form: FormData, name: string) =>
  String(form.get(name) ?? '').trim()

type CvField = keyof CvFields

const CV_LABELS = (): Record<CvField, string> => ({
  firstName: t('prénom', 'first name'),
  lastName: t('nom', 'last name'),
  email: 'e-mail',
  profileUrl: t('profil', 'profile'),
  headline: t('intitulé', 'headline'),
})

/** violet: a value the AI (or the local reading) put in the form */
const ReadInCv = () => (
  <span tw='inline-flex items-center gap-1 ml-2 text-[11.5px] font-normal text-ai'>
    <Sparkles tw='w-3 h-3' />
    {t('Lu dans le CV', 'Read in the CV')}
  </span>
)

const list = (fields: CvField[]) => fields.map((f) => CV_LABELS()[f]).join(', ')

/** what the reading of the CV did, said once above the form */
const CvBanner = (
  { reading, fileName }: { reading: CvReading; fileName: string },
) => (
  <div
    role='status'
    data-test='cv-banner'
    tw='flex items-start gap-2 px-3 py-2.5 rounded-lg bg-ai-soft border border-ai-line text-[12.5px] leading-[1.5]'
  >
    <Sparkles tw='w-4 h-4 flex-none mt-px text-ai' />
    <span>
      {reading.by === 'model'
        ? (
          <>
            {t('Fiche préremplie depuis', 'Form prefilled from')}{' '}
            <strong>{fileName}</strong>, {t('lue par', 'read by')}{' '}
            {reading.trace?.model ?? t('un modèle d’IA', 'an AI model')}
            {reading.scanned ? t(' sur un CV scanné', ' on a scanned CV') : ''}.
          </>
        )
        : (
          <>
            {t('Fiche préremplie depuis', 'Form prefilled from')}{' '}
            <strong>{fileName}</strong>. {reading.note
              ? tm(reading.note)
              : t('Lecture locale, sans IA.', 'Local reading, without AI.')}
          </>
        )} {reading.scanned
        ? t(
          'Rien n’a pu être vérifié dans le fichier : relisez chaque champ.',
          'Nothing could be checked in the file: read every field again.',
        )
        : reading.by === 'local'
        ? t(
          'Lecture approximative : vérifiez chaque champ avant de créer le lien.',
          'Approximate reading: check every field before creating the link.',
        )
        : t(
          'Chaque valeur a été retrouvée dans le CV ; vérifiez-les avant de créer le lien.',
          'Every value was found in the CV; check them before creating the link.',
        )}
      {reading.discarded.length > 0 && (
        <>
          {' '}
          {t(
            `Écarté${reading.discarded.length > 1 ? 's' : ''} : ${
              list(reading.discarded)
            }, introuvable${
              reading.discarded.length > 1 ? 's' : ''
            } dans le CV.`,
            `Discarded: ${list(reading.discarded)}, not found in the CV.`,
          )}
        </>
      )}
    </span>
  </div>
)

/** « Importer un CV » (U5): the file is read by the server, never stored */
const CvImport = (
  { assessment, onRead }: {
    assessment: number
    onRead: (reading: CvReading, fileName: string) => void
  },
) => {
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  return (
    <div tw='flex flex-col gap-1.5'>
      <div tw='flex items-center gap-2 flex-wrap'>
        <label
          tw={[
            'btn btn-secondary h-[34px] px-3 text-[13px] cursor-pointer',
            reading && 'opacity-[.6] pointer-events-none',
          ]}
        >
          {reading
            ? <LoaderCircle tw='w-3.5 h-3.5 animate-spin' />
            : <FileUp tw='w-3.5 h-3.5' />}
          {reading
            ? t('Lecture du CV…', 'Reading the CV…')
            : t('Importer un CV', 'Import a CV')}
          <input
            type='file'
            data-test='cv-input'
            accept='.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            tw='sr-only'
            disabled={reading}
            onChange={async (e) => {
              const input = e.currentTarget
              const file = input.files?.[0]
              input.value = '' // the same file can be chosen again
              if (!file) return
              if (file.size > 5 * 1024 * 1024) {
                setError(
                  t('CV trop lourd (5 Mo max).', 'CV too large (5 MB max).'),
                )
                return
              }
              setReading(true)
              setError('')
              try {
                onRead(await readCv(assessment, file), file.name)
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err))
              } finally {
                setReading(false)
              }
            }}
          />
        </label>
        <span tw='text-[12.5px] text-content-tertiary'>
          {t('PDF ou DOCX, 5 Mo au plus', 'PDF or DOCX, 5 MB at most')}
        </span>
      </div>
      <p tw='m-0 text-[12px] text-content-tertiary leading-[1.5]'>
        {t(
          'Le fichier n’est pas conservé. Son texte est lu par un modèle d’IA pour cette seule extraction, jamais pour l’évaluation.',
          'The file is not kept. Its text is read by an AI model for this extraction only, never for the evaluation.',
        )}
      </p>
      {error && (
        <p role='alert' tw='m-0 flex items-start gap-2 text-[13px] text-err'>
          <CircleX tw='w-4 h-4 flex-none mt-px' />
          {error}
        </p>
      )}
    </div>
  )
}

/** the e-mail of the personal link: sent, failed (retry), or not asked */
const MailStatus = (
  { mail, email, onRetry, retrying }: {
    mail?: LinkSent
    email: string
    onRetry: () => void
    retrying: boolean
  },
) =>
  !mail ? null : mail.sent
    ? (
      <p
        role='status'
        data-test='link-emailed'
        tw='m-0 flex items-center gap-2 text-[13px] text-ok'
      >
        <MailCheck tw='w-4 h-4 flex-none' />
        {t(`E-mail envoyé à ${email}.`, `E-mail sent to ${email}.`)}
      </p>
    )
    : (
      <div
        role='alert'
        tw='flex items-start gap-2 px-3 py-2.5 rounded-lg bg-warn-soft border border-warn-line text-[13px]'
      >
        <MailX tw='w-4 h-4 flex-none mt-px text-warn' />
        <span tw='flex-1'>
          {t(
            `L’e-mail n’est pas parti : ${mail.error}. Le lien reste valable : copiez-le ou réessayez.`,
            `The e-mail was not sent: ${
              tm(mail.error)
            }. The link stays valid: copy it or try again.`,
          )}
        </span>
        <button
          type='button'
          tw='btn btn-secondary h-8 px-2.5 text-[13px]'
          disabled={retrying}
          onClick={onRetry}
        >
          <RefreshCw tw='w-3.5 h-3.5' />
          {t('Réessayer', 'Try again')}
        </button>
      </div>
    )

type Sent = {
  candidateId: number
  link: string
  firstName: string
  email: string
  mail?: LinkSent
}

/** R5 « Inviter un candidat » (U4, U5): by hand or from a CV, link e-mailed */
const InvitePanel = ({ a }: { a: AssessmentState }) => {
  const canEmail = member.value?.canEmail === true
  const [sent, setSent] = useState<Sent | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [sendEmail, setSendEmail] = useState(true)
  const [cv, setCv] = useState<{ reading: CvReading; fileName: string }>()
  const form = useRef<HTMLFormElement>(null)
  const fromCv = (name: CvField) => cv?.reading.fields[name] !== undefined

  /** what the last CV put in each field: a new CV replaces it, never an edit */
  const filled = useRef<Record<string, string>>({})
  const fill = (reading: CvReading, fileName: string) => {
    const el = form.current
    if (!el) return
    const values: Record<string, string> = {
      firstName: reading.fields.firstName ?? '',
      lastName: reading.fields.lastName ?? '',
      email: reading.fields.email ?? '',
      profileUrl: reading.fields.profileUrl ?? '',
      note: reading.fields.headline
        ? `${t('Profil :', 'Profile:')} ${reading.fields.headline}`
        : '',
    }
    for (const [name, value] of Object.entries(values)) {
      const input = el.elements.namedItem(name) as HTMLInputElement | null
      if (!input) continue
      // empty, or still what the previous CV wrote: the new reading wins
      const untouched = !input.value || input.value === filled.current[name]
      if (untouched) input.value = value
    }
    filled.current = values
    setCv({ reading, fileName })
  }

  if (sent) {
    return (
      <Panel title={t('Lien personnel créé', 'Personal link created')}>
        <p tw='m-0 text-[13px] text-content-secondary'>
          {sent.mail?.sent
            ? t(`Envoyé à ${sent.firstName}`, `Sent to ${sent.firstName}`)
            : t(
              `À transmettre à ${sent.firstName}`,
              `To send to ${sent.firstName}`,
            )} ({sent.email}). {t(
              'Valable 14 jours, révocable depuis le tableau des candidats.',
              'Valid for 14 days, can be revoked from the candidates table.',
            )}
        </p>
        <MailStatus
          mail={sent.mail}
          email={sent.email}
          retrying={retrying}
          onRetry={async () => {
            setRetrying(true)
            try {
              const mail = await sendCandidateLink(sent.candidateId)
              setSent({ ...sent, mail })
            } catch (err) {
              setSent({
                ...sent,
                mail: {
                  sent: false,
                  error: err instanceof Error ? err.message : String(err),
                },
              })
            } finally {
              setRetrying(false)
            }
          }}
        />
        <div tw='flex gap-2'>
          <code
            data-test='candidate-link'
            tw='flex-1 min-w-0 h-9 px-3 rounded-lg border border-border-strong bg-surface-sunken font-mono text-[13px] flex items-center overflow-hidden whitespace-nowrap'
          >
            <span tw='truncate'>{sent.link}</span>
          </code>
          <CopyButton text={sent.link} />
        </div>
        <div tw='flex items-center gap-2 flex-wrap'>
          {!sent.mail?.sent && (
            <a
              href={mailto(a, sent.firstName, sent.email, sent.link)}
              tw='btn btn-secondary h-[34px] px-3 text-[13px]'
            >
              <Send tw='w-3.5 h-3.5' />
              {t('Préparer un e-mail', 'Draft an e-mail')}
            </a>
          )}
          <a
            href={sent.link}
            data-test='open-as-candidate-btn'
            tw='btn btn-secondary h-[34px] px-3 text-[13px]'
          >
            <ExternalLink tw='w-3.5 h-3.5' />
            {t('Ouvrir en tant que candidat', 'Open as the candidate')}
          </a>
          <button
            type='button'
            data-test='invite-another-btn'
            tw='btn btn-ghost h-[34px] px-3 text-[13px]'
            onClick={() => {
              setSent(null)
              setCv(undefined)
            }}
          >
            <UserPlus tw='w-3.5 h-3.5' />
            {t('Inviter une autre personne', 'Invite someone else')}
          </button>
        </div>
      </Panel>
    )
  }
  return (
    <Panel title={t('Inviter un candidat', 'Invite a candidate')}>
      <CvImport assessment={a.id} onRead={fill} />
      {cv && <CvBanner {...cv} />}
      <form
        ref={form}
        tw='flex flex-col gap-3'
        onSubmit={async (e) => {
          e.preventDefault()
          if (pending) return
          const data = new FormData(e.currentTarget)
          const identity = {
            firstName: field(data, 'firstName'),
            lastName: field(data, 'lastName'),
            email: field(data, 'email'),
            profileUrl: field(data, 'profileUrl') || undefined,
            note: field(data, 'note') || undefined,
          }
          const emailIt = canEmail && sendEmail
          setPending(true)
          setError('')
          try {
            const { candidateId, link, email } = await inviteCandidate(
              a.id,
              identity,
              { sendEmail: emailIt, fromCv: !!cv },
            )
            setSent({
              candidateId,
              link,
              firstName: identity.firstName,
              email: identity.email,
              mail: email,
            })
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
          } finally {
            setPending(false)
          }
        }}
      >
        <div tw='grid grid-cols-1 sm:grid-cols-2 gap-3'>
          <div tw='flex flex-col gap-1.5'>
            <Label for='firstName' required>
              {t('Prénom', 'First name')}
              {fromCv('firstName') && <ReadInCv />}
            </Label>
            <Input
              name='firstName'
              required
              autocomplete='off'
              data-test='invite-first-name'
            />
          </div>
          <div tw='flex flex-col gap-1.5'>
            <Label for='lastName' required>
              {t('Nom', 'Last name')}
              {fromCv('lastName') && <ReadInCv />}
            </Label>
            <Input
              name='lastName'
              required
              autocomplete='off'
              data-test='invite-last-name'
            />
          </div>
        </div>
        <div tw='flex flex-col gap-1.5'>
          <Label for='email' required>
            E-mail{fromCv('email') && <ReadInCv />}
          </Label>
          <Input
            name='email'
            type='email'
            required
            autocomplete='off'
            data-test='invite-email'
          />
        </div>
        <div tw='flex flex-col gap-1.5'>
          <Label for='profileUrl'>
            {t(
              'Profil (LinkedIn, GitHub, portfolio)',
              'Profile (LinkedIn, GitHub, portfolio)',
            )}
            {fromCv('profileUrl') && <ReadInCv />}
          </Label>
          <Input
            name='profileUrl'
            type='url'
            placeholder='https://'
            autocomplete='off'
            data-test='invite-profile'
          />
        </div>
        <div tw='flex flex-col gap-1.5'>
          <Label for='note'>
            {t('Note interne', 'Internal note')}
            {fromCv('headline') && <ReadInCv />}
          </Label>
          <Textarea
            name='note'
            rows={2}
            maxLength={500}
            placeholder={t(
              'Visible par votre équipe seulement',
              'Visible to your team only',
            )}
          />
        </div>
        {canEmail && (
          <label tw='flex items-center gap-2.5 text-[13.5px] cursor-pointer'>
            <input
              type='checkbox'
              data-test='invite-send-email'
              checked={sendEmail}
              onChange={() => setSendEmail(!sendEmail)}
              tw='w-[17px] h-[17px] m-0 flex-none'
              style={{ accentColor: 'var(--color-accent)' }}
            />
            {t(
              'Envoyer le lien par e-mail à la personne',
              'E-mail the link to the person',
            )}
          </label>
        )}
        {error && (
          <p
            role='alert'
            tw='m-0 flex items-start gap-2 text-[13px] text-err'
          >
            <CircleX tw='w-4 h-4 flex-none mt-px' />
            {tm(error)}
          </p>
        )}
        <div tw='flex items-center gap-3 flex-wrap'>
          <button
            type='submit'
            data-test='invite-btn'
            tw='btn btn-primary h-9 px-4'
            disabled={pending}
          >
            {canEmail && sendEmail
              ? <Send tw='w-[15px] h-[15px]' />
              : <UserPlus tw='w-[15px] h-[15px]' />}
            {pending
              ? canEmail && sendEmail
                ? t('Envoi du lien…', 'Sending the link…')
                : t('Création du lien…', 'Creating the link…')
              : canEmail && sendEmail
              ? t('Créer et envoyer le lien', 'Create and send the link')
              : t('Créer le lien personnel', 'Create the personal link')}
          </button>
          <span tw='text-[12.5px] text-content-tertiary'>
            {t(
              'L’identité n’est jamais transmise aux modèles qui évaluent.',
              'The identity is never sent to the models that assess.',
            )}
          </span>
        </div>
      </form>
    </Panel>
  )
}

/** the personal link still opens the test (not finished, revoked, expired) */
const linkUsable = (c: CandidateSummary) =>
  !!c.invitation &&
  ['Invité', 'Construction en cours', 'Questions en cours'].includes(c.status)

const revoke = (c: CandidateSummary) => {
  const who = c.identity
    ? `${c.identity.firstName} ${c.identity.lastName}`
    : c.pseudonym
  if (
    !confirm(
      t(
        `Révoquer le lien de ${who} ? Il ne donnera plus accès à l’épreuve.`,
        `Revoke the link of ${who}? It will no longer open the assessment.`,
      ),
    )
  ) {
    return
  }
  revokeCandidate(c.id).catch((err) =>
    alert(err instanceof Error ? err.message : String(err))
  )
}

/** the e-mail of the personal link, under the candidate's e-mail (U5) */
const LinkMail = ({ c }: { c: CandidateSummary }) =>
  c.emailSentAt
    ? (
      <span tw='flex items-center gap-1 text-[12px] text-ok'>
        <MailCheck tw='w-3 h-3' />
        {t('Lien envoyé le', 'Link sent on')} {formatDate(c.emailSentAt)}
      </span>
    )
    : c.emailError
    ? (
      <span
        tw='flex items-center gap-1 text-[12px] text-warn'
        title={tm(c.emailError)}
      >
        <MailX tw='w-3 h-3' />
        {t('Échec de l’envoi', 'Sending failed')}
      </span>
    )
    : null

/** R5 « Envoyer / Renvoyer » the personal link by e-mail (U5) */
const SendLinkButton = ({ c }: { c: CandidateSummary }) => {
  const [pending, setPending] = useState(false)
  return (
    <button
      type='button'
      data-test='send-link-btn'
      tw='btn btn-ghost h-8 px-2.5 text-[13px]'
      disabled={pending}
      onClick={async () => {
        setPending(true)
        try {
          const result = await sendCandidateLink(c.id)
          if (!result.sent) {
            alert(
              t(
                `L’e-mail n’est pas parti : ${result.error}`,
                `The e-mail was not sent: ${tm(result.error)}`,
              ),
            )
          }
        } catch (err) {
          alert(err instanceof Error ? err.message : String(err))
        } finally {
          setPending(false)
        }
      }}
    >
      {pending
        ? <LoaderCircle tw='w-3.5 h-3.5 animate-spin' />
        : <Send tw='w-3.5 h-3.5' />}
      {c.emailSentAt ? t('Renvoyer', 'Resend') : t('Envoyer', 'Send')}
    </button>
  )
}

/** R5 — approved assessment: invitations, summary, candidates */
export const AssessmentPage = () => {
  const canEmail = member.value?.canEmail === true
  const a = getAssessment(url.params.id)
  if (!a) {
    return assessmentStatus.value === 'loading'
      ? (
        <main tw='flex-1 flex items-center justify-center py-16'>
          <Spinner tw='w-5 h-5 text-content-tertiary' />
        </main>
      )
      : <NotFoundPage />
  }
  if (a.status !== 'approved') {
    navigate({ href: paths.review, params: { id: a.id }, replace: true })
    return null
  }
  const { spec } = a
  const hidden = spec.tests.filter((t) => t.visibility === 'caché').length
  return (
    <main tw='w-full max-w-[1120px] mx-auto px-4 sm:px-8 pt-7 pb-16 flex flex-col gap-[18px]'>
      <BackLink href={paths.recruiter}>
        {t('Mes épreuves', 'My assessments')}
      </BackLink>
      <div
        role='status'
        tw='flex items-center gap-2.5 px-3.5 py-[11px] rounded-[10px] bg-ok-soft border border-ok text-[13.5px] flex-wrap'
      >
        <CircleCheck tw='w-[17px] h-[17px] flex-none text-ok' />
        <strong tw='font-semibold'>
          {t('Épreuve approuvée.', 'Assessment approved.')}
        </strong>
        <span tw='text-content-secondary'>
          {t('Elle ne sera plus modifiée.', 'It will no longer change.')}
        </span>
      </div>
      <div tw='flex flex-col gap-2'>
        <h1 tw='m-0 text-[20px] sm:text-[24px] font-semibold'>{spec.title}</h1>
        <div tw='flex gap-1.5 flex-wrap'>
          <MetaTag>{levelLabels[spec.level]}</MetaTag>
          <MetaTag icon={Clock}>{spec.durationMin} min</MetaTag>
          <MetaTag>{tv(spec.format)}</MetaTag>
          <Badge variant='success' tw='font-semibold'>
            <BadgeCheck tw='w-[13px] h-[13px]' />
            {t('Approuvée le', 'Approved on')}{' '}
            {formatDate(a.approvedAt || a.createdAt)}
          </Badge>
        </div>
      </div>
      <div tw='grid grid-cols-1 lg:grid-cols-split gap-4'>
        <InvitePanel a={a} />
        <Panel title={t('Récapitulatif', 'Summary')}>
          <dl
            tw='m-0 grid gap-x-4 gap-y-2 text-[13px]'
            style={{ gridTemplateColumns: 'auto 1fr' }}
          >
            <dt tw='text-content-tertiary'>Routes</dt>
            <dd tw='m-0 font-mono text-[12.5px] leading-[1.7]'>
              {spec.routes.map((r) => `${r.method} ${r.path}`).join(' · ')}
            </dd>
            <dt tw='text-content-tertiary'>Tests</dt>
            <dd tw='m-0'>
              {t(
                `${spec.tests.length} : ${
                  spec.tests.length - hidden
                } publics + ${hidden} cachés`,
                `${spec.tests.length}: ${
                  spec.tests.length - hidden
                } public + ${hidden} hidden`,
              )}
            </dd>
            <dt tw='text-content-tertiary'>{t('Compétences', 'Skills')}</dt>
            <dd tw='m-0'>{spec.skills.map((s) => tv(s.name)).join(', ')}</dd>
          </dl>
        </Panel>
      </div>
      <section tw='flex flex-col gap-2.5 min-w-0'>
        <h2 tw='m-0 text-[17px] font-semibold'>
          {t('Candidats', 'Candidates')}
        </h2>
        <TableWrap>
          <THead>
            <th tw={[th, 'pl-4']}>{t('Candidat', 'Candidate')}</th>
            <th tw={th}>{t('Pseudonyme', 'Pseudonym')}</th>
            <th tw={th}>{t('Statut', 'Status')}</th>
            <th tw={th}>{t('Durée', 'Duration')}</th>
            <th tw={th}>Date</th>
            <th tw={[th, 'pr-4']}>
              <span tw='sr-only'>{t('Rapport', 'Report')}</span>
            </th>
          </THead>
          <tbody>
            {!a.candidates.length && (
              <tr tw='border-t border-border-primary'>
                <td
                  colSpan={6}
                  tw={[td, 'pl-4 text-content-tertiary text-[13px]']}
                >
                  {t(
                    'Aucun candidat pour l’instant. Invitez une première personne ci-dessus.',
                    'No candidate yet. Invite a first person above.',
                  )}
                </td>
              </tr>
            )}
            {a.candidates.map((c) => {
              const done = c.status === 'Terminé'
              return (
                <tr key={c.id} tw='border-t border-border-primary'>
                  <td tw={[td, 'pl-4']}>
                    {c.identity
                      ? (
                        <span tw='flex flex-col'>
                          <span tw='font-medium'>
                            {c.identity.firstName} {c.identity.lastName}
                          </span>
                          <span tw='text-[12.5px] text-content-secondary'>
                            {c.identity.email}
                          </span>
                          <LinkMail c={c} />
                        </span>
                      )
                      : (
                        <span tw='text-[13px] text-content-tertiary'>
                          {t('Identité non renseignée', 'Identity not given')}
                        </span>
                      )}
                  </td>
                  <td tw={[td, 'text-content-secondary']}>{c.pseudonym}</td>
                  <td tw={td}>{statusBadge(c.status)}</td>
                  <td tw={[td, 'text-content-secondary']}>
                    {c.buildMinutes
                      ? `${formatMinutes(c.buildMinutes)}${
                        c.questionsMinutes ? ` + ${c.questionsMinutes} min` : ''
                      }`
                      : '—'}
                  </td>
                  <td tw={[td, 'text-content-secondary']}>
                    {formatDate(c.date)}
                  </td>
                  <td tw={[td, 'pr-4 text-right']}>
                    <span tw='inline-flex items-center gap-2 justify-end flex-wrap'>
                      {canEmail && c.status === 'Invité' && c.invitation && (
                        <SendLinkButton c={c} />
                      )}
                      {linkUsable(c) && (
                        <CopyButton
                          small
                          label={t('Lien', 'Link')}
                          text={invitationLink(c.invitation!)}
                        />
                      )}
                      {c.status !== 'Terminé' && c.status !== 'Révoqué' && (
                        <button
                          type='button'
                          data-test='revoke-btn'
                          tw='btn btn-ghost h-8 px-2.5 text-[13px]'
                          onClick={() => revoke(c)}
                        >
                          <Ban tw='w-3.5 h-3.5' />
                          {t('Révoquer', 'Revoke')}
                        </button>
                      )}
                      {done
                        ? (
                          <A
                            href={paths.report}
                            params={{ candidate: c.id }}
                            data-test='report-link'
                            tw='btn btn-secondary h-8 px-3 text-[13px]'
                          >
                            <FileText tw='w-3.5 h-3.5' />
                            {t('Voir le rapport', 'See the report')}
                          </A>
                        )
                        : (
                          <button
                            type='button'
                            disabled
                            title={t(
                              'Disponible une fois l’évaluation terminée',
                              'Available once the assessment is finished',
                            )}
                            tw='btn btn-secondary h-8 px-3 text-[13px]'
                          >
                            <FileText tw='w-3.5 h-3.5' />
                            {t('Voir le rapport', 'See the report')}
                          </button>
                        )}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </TableWrap>
        <p tw='m-0 text-[12.5px] text-content-tertiary'>
          {t(
            'Statuts possibles : Invité, Construction en cours, Questions en cours, Terminé, Lien expiré (non ouvert sous 14 jours), Révoqué. Le rapport est disponible une fois l’évaluation terminée.',
            'Possible statuses: Invited, Building, Answering questions, Finished, Link expired (not opened within 14 days), Revoked. The report is available once the assessment is finished.',
          )}
        </p>
      </section>
    </main>
  )
}
