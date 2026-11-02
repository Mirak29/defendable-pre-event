// U5: the personal link e-mailed through Resend, against a local mock of its
// API. Nothing leaves the machine.
import { eq, test } from '/api/lib/test.ts'
import {
  candidateLink,
  emailConfig,
  invitationEmail,
  sendCandidateLink,
} from '/api/email.ts'
import { inviteCandidate, startCandidate } from '/api/candidate.ts'
import { randomToken } from '/api/assessment.ts'
import { Candidate, demoCompanyId, demoMemberId } from '/api/schema.ts'
import { seedDemoAssessment } from '/fixtures/seed.ts'
import { mockResend } from '/api/lib/email-mock.ts'
import { ORIGIN } from '/api/lib/env.ts'

const invite = (assessmentId, identity = {}) =>
  Candidate.require(
    inviteCandidate(assessmentId, demoMemberId, {
      firstName: 'Awa',
      lastName: 'Diop',
      email: `awa.${randomToken(8)}@example.com`,
      ...identity,
    }).candidateId,
  )

/** a 4xx of the API, with its message for the recruiter */
const refused = async (fn, text) => {
  const err = await fn().then(() => undefined, (e) => e)
  const body = await err?.response?.clone().json()
  eq(body?.message?.includes(text), true, body?.message ?? String(err))
}

test('candidate link e-mail', async (step) => {
  const assessmentId = seedDemoAssessment(randomToken(10))

  await step('the link opens C1 of the app', () => {
    eq(
      candidateLink('abc'),
      `${ORIGIN}/candidate?invitation=abc`,
    )
  })

  await step('the message: French, the link, nothing unescaped', () => {
    const mail = invitationEmail({
      firstName: '<b>Awa</b>',
      company: 'Acme & fils',
      title: 'API de liens',
      durationMin: 90,
      link: 'https://app.example.com/candidate?invitation=abc',
      expiresAt: Date.UTC(2026, 9, 12, 12),
    })
    eq(mail.subject, 'Acme & fils vous invite à une épreuve technique')
    eq(mail.html.includes('&lt;b&gt;Awa&lt;/b&gt;'), true)
    eq(mail.html.includes('<b>Awa</b>'), false)
    eq(mail.html.includes('Acme &amp; fils'), true)
    eq(mail.text.includes('valable jusqu’au 12 octobre 2026'), true)
    eq(
      mail.text.includes('https://app.example.com/candidate?invitation=abc'),
      true,
    )
  })

  await step('without RESEND_API_KEY nothing is sent', async () => {
    const c = invite(assessmentId)
    const saved = emailConfig.apiKey
    emailConfig.apiKey = ''
    await refused(() => sendCandidateLink(c), 'RESEND_API_KEY')
    emailConfig.apiKey = saved
  })

  await step('sent: to the candidate, from the sender, stored', async () => {
    await using m = mockResend()
    const c = invite(assessmentId)
    const result = await sendCandidateLink(c)
    eq(result.sent, true)
    const { headers, body } = m.calls[0]
    eq(body.to, [c.candidateEmail])
    eq(body.from, 'Defendable <test@example.com>')
    eq(headers.get('authorization'), 'Bearer re_test')
    eq(!!headers.get('idempotency-key'), true)
    eq(body.html.includes(`invitation=${c.candidateInvitation}`), true)
    eq(body.text.startsWith('Bonjour Awa,'), true)
    const row = Candidate.require(c.candidateId)
    eq([!!row.candidateEmailSentAt, row.candidateEmailError], [true, null])
  })

  await step('refused by Resend: said, stored, the link stays', async () => {
    await using _m = mockResend(() => [422, { message: 'Invalid `to` field' }])
    const c = invite(assessmentId)
    const result = await sendCandidateLink(c)
    eq(result, {
      sent: false,
      error: 'adresse refusée (422) : Invalid `to` field',
    })
    const row = Candidate.require(c.candidateId)
    eq(row.candidateEmailError, result.error)
    eq(!!row.candidateInvitation && !row.candidateRevokedAt, true)
  })

  await step('a started assessment needs no e-mail', async () => {
    await using _m = mockResend()
    const c = invite(assessmentId)
    startCandidate(c.candidateInvitation, false)
    await refused(
      () => sendCandidateLink(Candidate.require(c.candidateId)),
      'commencée',
    )
  })

  await step('the demo space sends 5 e-mails an hour at most', async () => {
    await using m = mockResend()
    const before = m.calls.length
    let limited = false
    for (let i = 0; i < 12 && !limited; i++) {
      const err = await sendCandidateLink(invite(assessmentId)).then(
        () => undefined,
        (e) => e,
      )
      if (err) {
        eq(err.response.status, 429)
        limited = true
      }
    }
    eq(limited, true)
    // this demo assessment belongs to the demo company
    eq(demoCompanyId > 0, true)
    eq(m.calls.length - before <= emailConfig.demoPerHour, true)
  })
})
