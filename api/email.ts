// U5 bonus: the personal link e-mailed to the candidate through Resend
// (https://resend.com/docs/api-reference/emails/send-email). The link is the
// "magic link" of the candidate: no account, the token opens the assessment
// for 14 days, on any device. Without RESEND_API_KEY nothing is sent and R5
// keeps the manual way (copy the link, prepare an e-mail).
import { ENV } from '@01edu/api/env'
import { respond } from '@01edu/api/response'
import { sql } from '@01edu/db'
import { BASE_URL, ORIGIN } from '/api/lib/env.ts'
import { log } from '/api/lib/log.ts'
import { paths } from '/web/paths.ts'
import {
  Assessment,
  Candidate,
  type CandidateRow,
  Company,
  companyOfAssessment,
  demoCompanyId,
  Entry,
} from '/api/schema.ts'
import { INVITATION_DAYS } from '/api/candidate.ts'

/** mutable so tests can point it at a local mock */
export const emailConfig = {
  apiKey: ENV('RESEND_API_KEY', ''),
  // a verified domain of the Resend account; onboarding@resend.dev only
  // delivers to the owner of the account
  from: ENV('RESEND_FROM', 'Defendable <onboarding@resend.dev>'),
  baseUrl: 'https://api.resend.com',
  /** e-mails per company and per hour (the demo space is shared) */
  perHour: 30,
  demoPerHour: 5,
}

export const emailEnabled = () => !!emailConfig.apiKey

/** the personal link, as the candidate opens it */
export const candidateLink = (invitation: string) =>
  new URL(
    `${BASE_URL.replace(/^\//, '')}${paths.candidate.slice(1)}?invitation=${
      encodeURIComponent(invitation)
    }`,
    ORIGIN.endsWith('/') ? ORIGIN : `${ORIGIN}/`,
  ).href

const sentCount = sql<{ count: number }, { companyId: number; since: number }>`
  SELECT count(*) AS count FROM entryInternal
  WHERE type = ${Entry.type.CANDIDATE_LINK_SENT}
    AND companyId = :companyId AND createdAt > :since
`.get

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const dateIn = (ms: number, lang: 'fr' | 'en') =>
  new Date(ms).toLocaleDateString(lang === 'en' ? 'en-GB' : 'fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Paris',
  })

export type Invitation = {
  firstName: string
  company: string
  title: string
  durationMin: number
  link: string
  expiresAt: number
  /** the language of the assessment (French by default) */
  lang?: 'fr' | 'en'
}

/** the words of the invitation, in the language of the assessment */
const wording = (i: Invitation, until: string) =>
  i.lang === 'en'
    ? {
      subject: `${i.company} invites you to a technical assessment`,
      hello: (name: string) => `Hello ${name},`,
      invites: (company: string, title: string) =>
        `${company} invites you to take the assessment “${title}” on Defendable.`,
      invitesHtml: (company: string, title: string) =>
        `<strong>${company}</strong> invites you to take the assessment <strong>“${title}”</strong>.`,
      how:
        `${i.durationMin} min to build a small HTTP API in TypeScript (Deno), with the AI of your choice, then 10 questions on your own code. No webcam, no microphone, no screen recording.`,
      steps: 'How it works:',
      linkUntil: `Your personal link, valid until ${until}:`,
      open: 'Open my assessment',
      personal:
        `Personal link, valid until ${until}. It opens the assessment without a password: do not forward it. You can resume on another device with the same link.`,
      keep:
        'This link opens the assessment without a password: do not forward it. You can resume on another device with the same link.',
      ignore: 'If you were not expecting this invitation, ignore this e-mail.',
    }
    : {
      subject: `${i.company} vous invite à une épreuve technique`,
      hello: (name: string) => `Bonjour ${name},`,
      invites: (company: string, title: string) =>
        `${company} vous invite à passer l’épreuve « ${title} » sur Defendable.`,
      invitesHtml: (company: string, title: string) =>
        `<strong>${company}</strong> vous invite à passer l’épreuve <strong>« ${title} »</strong>.`,
      how:
        `${i.durationMin} min pour construire une petite API HTTP en TypeScript (Deno), avec l’IA de votre choix, puis 10 questions sur votre propre code. Ni webcam, ni micro, ni capture d’écran.`,
      steps: 'Déroulé :',
      linkUntil: `Votre lien personnel, valable jusqu’au ${until} :`,
      open: 'Ouvrir mon épreuve',
      personal:
        `Lien personnel, valable jusqu’au ${until}. Il ouvre l’épreuve sans mot de passe : ne le transférez pas. Vous pouvez reprendre sur un autre appareil avec le même lien.`,
      keep:
        'Ce lien ouvre l’épreuve sans mot de passe : ne le transférez pas. Vous pouvez reprendre sur un autre appareil avec le même lien.',
      ignore: 'Si vous n’attendiez pas cette invitation, ignorez cet e-mail.',
    }

/** subject, text and HTML of the invitation, in the assessment's language */
export const invitationEmail = (i: Invitation) => {
  const lang = i.lang === 'en' ? 'en' : 'fr'
  const w = wording(i, dateIn(i.expiresAt, lang))
  const text = `${w.hello(i.firstName)}

${w.invites(i.company, i.title)}

${w.steps} ${w.how}

${w.linkUntil}
${i.link}

${w.keep}

${w.ignore}`
  const e = {
    firstName: escape(i.firstName),
    company: escape(i.company),
    title: escape(i.title),
    link: escape(i.link),
  }
  const html = `<!doctype html>
<html lang="${lang}"><body style="margin:0;padding:24px;background:#f4f5f8;font-family:Helvetica,Arial,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #dadde6;border-radius:12px">
<tr><td style="padding:28px 32px 8px;font-size:13px;letter-spacing:2px;font-weight:700;color:#5b5bd6">DEFENDABLE</td></tr>
<tr><td style="padding:8px 32px 0;font-size:15px;line-height:1.6">
<p style="margin:0 0 14px">${w.hello(e.firstName)}</p>
<p style="margin:0 0 14px">${w.invitesHtml(e.company, e.title)}</p>
<p style="margin:0 0 20px;color:#374151">${w.how}</p>
</td></tr>
<tr><td style="padding:0 32px 8px"><a href="${e.link}" style="display:inline-block;background:#5b5bd6;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">${w.open}</a></td></tr>
<tr><td style="padding:12px 32px 28px;font-size:13px;line-height:1.6;color:#5b6275">
<p style="margin:0 0 10px">${w.personal}</p>
<p style="margin:0 0 10px;word-break:break-all">${e.link}</p>
<p style="margin:0">${w.ignore}</p>
</td></tr>
</table></td></tr></table>
</body></html>`
  return { subject: w.subject, text, html }
}

class SendError extends Error {}

/** one e-mail through the Resend API; returns its id */
const send = async (
  to: string,
  mail: { subject: string; text: string; html: string },
  idempotencyKey: string,
) => {
  const res = await fetch(`${emailConfig.baseUrl}/emails`, {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${emailConfig.apiKey}`,
      // a retried request never sends the same e-mail twice
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({ from: emailConfig.from, to: [to], ...mail }),
  }).catch((err) => {
    throw new SendError(
      err instanceof Error && err.name === 'TimeoutError'
        ? 'service d’e-mail injoignable (délai dépassé)'
        : 'service d’e-mail injoignable',
    )
  })
  const body = await res.json().catch(() => ({})) as {
    id?: string
    message?: string
  }
  if (!res.ok || !body.id) {
    throw new SendError(
      res.status === 401 || res.status === 403
        ? `envoi refusé (${res.status}) : ${
          body.message ?? 'clé ou expéditeur'
        }`
        : res.status === 422
        ? `adresse refusée (422) : ${body.message ?? ''}`.trim()
        : res.status === 429
        ? 'trop d’envois (429), réessayez dans une minute'
        : `erreur du service d’e-mail (${res.status})`,
    )
  }
  return body.id
}

export type LinkSent = { sent: true; at: string } | {
  sent: false
  error: string
}

/**
 * Sends the personal link of a candidate. A failure is stored and returned
 * (R5 shows it, the link can still be copied), never thrown: the invitation
 * itself is done.
 */
export const sendCandidateLink = async (c: CandidateRow): Promise<LinkSent> => {
  if (!emailEnabled()) {
    throw new respond.BadRequestError({
      message: 'L’envoi d’e-mails n’est pas configuré (RESEND_API_KEY).',
    })
  }
  if (!c.candidateEmail || !c.candidateInvitation || c.candidateRevokedAt) {
    throw new respond.BadRequestError({
      message: 'Ce candidat n’a pas de lien personnel actif.',
    })
  }
  if (c.candidateStartedAt) {
    throw new respond.BadRequestError({
      message: 'L’épreuve est commencée : le candidat a déjà son lien.',
    })
  }
  const companyId = companyOfAssessment(c.assessmentId)
  const limit = companyId === demoCompanyId
    ? emailConfig.demoPerHour
    : emailConfig.perHour
  const sent = sentCount({ companyId, since: Date.now() / 1000 - 3600 })
    ?.count ?? 0
  if (sent >= limit) {
    throw new respond.TooManyRequestsError({
      message:
        `Limite de ${limit} e-mails par heure atteinte : copiez le lien pour l’envoyer vous-même.`,
    })
  }
  const a = Assessment.require(c.assessmentId)
  const spec = a.assessmentSpec as { title?: string } | undefined
  const invitedAt = c.candidateInvitedAt ?? c.candidateCreatedAt ?? Date.now()
  const mail = invitationEmail({
    firstName: c.candidateFirstName ?? '',
    company: Company.require(companyId).companyName,
    title: spec?.title ?? a.assessmentTitle,
    durationMin: a.assessmentDuration,
    link: candidateLink(c.candidateInvitation),
    expiresAt: invitedAt + INVITATION_DAYS * 24 * 3600 * 1000,
    lang: a.assessmentLanguage === 'en' ? 'en' : 'fr',
  })
  const entry = {
    companyId,
    assessmentId: c.assessmentId,
    candidateId: c.candidateId,
  }
  try {
    // one key per sending: a double click sends one e-mail, « Renvoyer »
    // after a sent one (or a failure) sends a new one
    const id = await send(
      c.candidateEmail,
      mail,
      `link-${c.candidateId}-${c.candidateEmailSentAt ?? 0}-${
        c.candidateEmailError ? Date.now() : 0
      }`,
    )
    const at = Date.now()
    Candidate.update({
      candidateId: c.candidateId,
      candidateEmailSentAt: at,
      candidateEmailError: null,
    })
    Entry.insert.CANDIDATE_LINK_SENT({ ...entry, data: { sent: true, id } })
    return { sent: true, at: new Date(at).toISOString() }
  } catch (err) {
    if (!(err instanceof SendError)) throw err
    log.warn('candidate-link-failed', {
      candidateId: c.candidateId,
      reason: err.message,
    })
    Candidate.update({
      candidateId: c.candidateId,
      candidateEmailError: err.message,
    })
    Entry.insert.CANDIDATE_LINK_SENT({
      ...entry,
      data: { sent: false, error: err.message },
    })
    return { sent: false, error: err.message }
  }
}
