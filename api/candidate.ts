import { companyOfAssessment } from '/api/schema.ts'
// Candidate journey (C1 → C7). The candidate is identified by a token in an
// httpOnly cookie, set when they start (no account, brief §6). The server is
// the clock: saves are refused after the time limit and the code is
// submitted automatically.
import { respond } from '@01edu/api/response'
import {
  Assessment,
  type AssessmentRow,
  Candidate,
  type CandidateRow,
  Entry,
} from '/api/schema.ts'
import { json, randomToken, starterFiles } from '/api/assessment.ts'
import {
  checkTypes,
  runEvaluation,
  runOwnTests,
  runPlayground,
} from '/api/sandbox.ts'
import { ask } from '/api/llm.ts'
import { prepareQuestions } from '/api/analysis.ts'
import { buildReport } from '/api/report.ts'
import { demoTraces } from '/fixtures/demo.ts'
import { demoOf } from '/fixtures/demos.ts'
import type { Question } from '/fixtures/questions.ts'
import type {
  AiTrace,
  AssessmentSpec,
  AssistantMessage,
  CandidateFiles,
  CandidateView,
  IntegrityKind,
  Invitation,
  InvitationState,
  Progress,
} from '/web/types.ts'

export const QUESTION_GRACE_MS = 5_000
export const ASSISTANT_LIMIT = 3

export type Runs = { run: number; mine: number; eval: number; demo?: boolean }

/** answer as stored on the server, by question number */
export type StoredAnswer = {
  openedAt: number
  sentAt?: number
  choice?: number | 'idk'
  text?: string
  assistant: AssistantMessage[]
  assistantTraces: AiTrace[]
  auto?: boolean
  /** sent after the time and its grace: recorded unanswered (AUD-005) */
  expired?: boolean
}

/* ---------- invitation and start (C1) ---------- */

/** a link not opened for 14 days is no longer valid (spec D9) */
export const INVITATION_DAYS = 14

const byInvitation = Candidate.sql`
  SELECT * FROM candidate WHERE candidateInvitation = :invitation
`.get

const byToken = Candidate.sql`
  SELECT * FROM candidate WHERE candidateToken = :token
`.get

const sameEmail = Candidate.sql`
  SELECT candidateId FROM candidate
  WHERE assessmentId = :assessmentId AND candidateEmail = :email
    AND candidateRevokedAt IS NULL
`.get

export const invitationState = (c: CandidateRow): InvitationState =>
  c.candidateRevokedAt
    ? 'revoked'
    : c.candidateFinishedAt
    ? 'finished'
    : c.candidateStartedAt
    ? 'started'
    : Date.now() - (c.candidateInvitedAt ?? c.candidateCreatedAt ?? 0) >
        INVITATION_DAYS * 24 * 3600_000
    ? 'expired'
    : 'invited'

/** the candidate of a personal link, on an approved assessment */
const findInvitation = (invitation?: string) => {
  const c = invitation ? byInvitation({ invitation }) : undefined
  const a = c && Assessment.get(c.assessmentId)
  if (!c || !a || a.assessmentStatus !== 'approved') {
    throw new respond.NotFoundError({ message: 'Lien d’évaluation invalide' })
  }
  return { c, a }
}

const specOf = (row: AssessmentRow) => json<AssessmentSpec>(row.assessmentSpec)!

export const getInvitation = (invitation?: string): Invitation => {
  const { c, a } = findInvitation(invitation)
  const spec = specOf(a)
  return {
    invitation: c.candidateInvitation!,
    title: spec.title,
    company: spec.company,
    format: spec.format,
    durationMin: a.assessmentDuration,
    firstName: c.candidateFirstName ?? undefined,
    state: invitationState(c),
  }
}

/** "Candidat A7F3", or "Candidate A7F3" on an assessment in English */
const pseudonym = (language: string | null) =>
  `${language === 'en' ? 'Candidate' : 'Candidat'} ${
    Array.from(crypto.getRandomValues(new Uint8Array(2)), (n) =>
      n.toString(16).padStart(2, '0')).join('').toUpperCase()
  }`

const field = (
  value: string | null | undefined,
  label: string,
  max: number,
) => {
  const clean = (value ?? '').trim()
  if (clean.length > max) {
    throw new respond.BadRequestError({ message: `${label} trop long.` })
  }
  return clean
}

/**
 * R5 « Inviter un candidat » (U4): the recruiter enters the identity, the
 * candidate gets a personal link. Nothing is sent: the recruiter shares it.
 */
export const inviteCandidate = (
  assessmentId: number,
  memberId: number,
  input: {
    firstName: string
    lastName: string
    email: string
    profileUrl?: string | null
    note?: string | null
    /** 'cv': prefilled from a CV (U5), each field validated by the recruiter */
    source?: 'manual' | 'cv'
  },
) => {
  const a = Assessment.require(assessmentId)
  if (a.assessmentStatus !== 'approved') {
    throw new respond.BadRequestError({
      message: 'Approuvez l’épreuve avant d’inviter un candidat.',
    })
  }
  const firstName = field(input.firstName, 'Prénom', 80)
  const lastName = field(input.lastName, 'Nom', 80)
  const email = field(input.email, 'E-mail', 254).toLowerCase()
  const profileUrl = field(input.profileUrl, 'Profil', 300)
  const note = field(input.note, 'Note', 500)
  if (!firstName || !lastName) {
    throw new respond.BadRequestError({
      message: 'Le prénom et le nom sont obligatoires.',
    })
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new respond.BadRequestError({ message: 'E-mail invalide.' })
  }
  if (profileUrl && !/^https:\/\/\S+$/.test(profileUrl)) {
    throw new respond.BadRequestError({
      message: 'Le profil doit être une adresse https://.',
    })
  }
  if (sameEmail({ assessmentId, email })) {
    throw new respond.ConflictError({
      message: 'Cette personne a déjà un lien pour cette épreuve.',
    })
  }
  const now = Date.now()
  const invitation = randomToken(24)
  const candidateId = Candidate.insert({
    candidateToken: randomToken(24),
    candidatePseudonym: pseudonym(a.assessmentLanguage),
    assessmentId,
    candidateCreatedAt: now,
    candidateInvitation: invitation,
    candidateInvitedAt: now,
    candidateInvitedBy: memberId,
    candidateFirstName: firstName,
    candidateLastName: lastName,
    candidateEmail: email,
    candidateProfileUrl: profileUrl || undefined,
    candidateNote: note || undefined,
    candidateIdentitySource: input.source === 'cv' ? 'cv' : 'manual',
  })
  Entry.insert.CANDIDATE_INVITED({
    companyId: companyOfAssessment(assessmentId),
    assessmentId,
    candidateId,
  })
  return { candidateId, invitation }
}

/** R5 « Révoquer le lien »: the link stops working, the report stays */
export const revokeInvitation = (candidateId: number) => {
  const c = Candidate.require(candidateId)
  if (c.candidateFinishedAt) {
    throw new respond.BadRequestError({
      message: 'L’épreuve est terminée : le lien ne donne plus accès à rien.',
    })
  }
  Candidate.update({ candidateId, candidateRevokedAt: Date.now() })
}

/**
 * C1 "Commencer la phase de construction", from the personal link: starts
 * the clock the first time, then only gives the session back (another
 * device, a lost cookie). In the guided demo the clock starts at 01:12:43 on
 * the draft of the prototype (brief C2).
 */
export const startCandidate = (invitation: string, demo: boolean) => {
  const { c, a } = findInvitation(invitation)
  const state = invitationState(c)
  if (state === 'expired' || state === 'revoked') {
    throw new respond.BadRequestError({
      message: `Ce lien n’est plus valable. Demandez un nouveau lien à ${
        specOf(a).company
      }.`,
    })
  }
  if (state !== 'invited') return c.candidateToken
  const spec = specOf(a)
  const now = Date.now()
  // guided demo: the draft of the demo, in the language of the assessment
  const demoSet = demoOf(a.assessmentLanguage)
  const files = demo && spec.company === 'Linkly'
    ? {
      ...demoSet.files,
      'src/links_repository.ts': demoSet.draftRepository,
    }
    : json<CandidateFiles>(a.assessmentStarterFiles) ?? starterFiles(spec)
  Candidate.update({
    candidateId: c.candidateId,
    candidateStartedAt: now - (demo ? (72 * 60 + 43) * 1000 : 0),
    candidateFiles: files,
    candidateSavedAt: now,
    candidateRuns: { run: 0, mine: 0, eval: 0, demo } satisfies Runs,
    candidateTools: [],
    candidateAnswers: {},
  })
  Entry.insert.CANDIDATE_BUILD_STARTED({
    companyId: companyOfAssessment(a.assessmentId),
    assessmentId: a.assessmentId,
    candidateId: c.candidateId,
  })
  return c.candidateToken
}

/* ---------- session ---------- */

export const findCandidate = (token?: string) => {
  const row = token ? byToken({ token }) : undefined
  if (!row) {
    throw new respond.UnauthorizedError({ message: 'Session candidat absente' })
  }
  return row
}

const assessmentOf = (c: CandidateRow) => Assessment.require(c.assessmentId)

const deadline = (c: CandidateRow) =>
  (c.candidateStartedAt ?? Date.now()) +
  assessmentOf(c).assessmentDuration * 60_000

/** time is up: the code is submitted as it was last saved (brief C3) */
export const autoSubmitIfExpired = (c: CandidateRow) => {
  if (c.candidateSubmittedAt || Date.now() < deadline(c)) return c
  submitCode(c, { tools: [], auto: true })
  return Candidate.require(c.candidateId)
}

export const answersOf = (c: CandidateRow) =>
  json<Record<number, StoredAnswer>>(c.candidateAnswers) ?? {}

export const runsOf = (c: CandidateRow): Runs =>
  json<Runs>(c.candidateRuns) ?? { run: 0, mine: 0, eval: 0 }

export const toView = (c: CandidateRow): CandidateView => {
  const spec = specOf(assessmentOf(c))
  const answers = answersOf(c)
  return {
    id: c.candidateId,
    pseudonym: c.candidatePseudonym,
    demo: !!runsOf(c).demo,
    now: Date.now(),
    assessment: {
      title: spec.title,
      company: spec.company,
      format: spec.format,
      durationMin: spec.durationMin,
      candidateBrief: spec.candidateBrief,
      requirements: spec.requirements.map(({ id, title, statement }) => ({
        id,
        title,
        statement,
      })),
      routes: spec.routes,
      constraints: spec.constraints,
      publicTests: spec.tests.filter((t) => t.visibility === 'public'),
      hiddenCount: spec.tests.filter((t) => t.visibility !== 'public').length,
    },
    startedAt: c.candidateStartedAt ?? undefined,
    submittedAt: c.candidateSubmittedAt ?? undefined,
    autoSubmitted: !!c.candidateAutoSubmitted,
    declaredTools: json<string[]>(c.candidateTools) ?? [],
    files: json<CandidateFiles>(c.candidateFiles) ?? {},
    savedAt: c.candidateSavedAt ?? undefined,
    preparation: json(c.candidatePreparation),
    questionsStartedAt: c.candidateQuestionsStartedAt ?? undefined,
    finishedAt: c.candidateFinishedAt ?? undefined,
    answeredCount: Object.values(answers).filter((a) => a.sentAt).length,
  }
}

/* ---------- workspace (C2) ---------- */

const assertBuilding = (c: CandidateRow) => {
  if (autoSubmitIfExpired(c).candidateSubmittedAt) {
    throw new respond.ConflictError({
      message: 'Votre code est soumis : il ne peut plus être modifié.',
    })
  }
}

export const saveFiles = (c: CandidateRow, files: CandidateFiles) => {
  assertBuilding(c)
  const savedAt = Date.now()
  Candidate.update({
    candidateId: c.candidateId,
    candidateFiles: files,
    candidateSavedAt: savedAt,
  })
  return { savedAt }
}

const countRun = (c: CandidateRow, kind: 'run' | 'mine' | 'eval') => {
  const runs = runsOf(Candidate.require(c.candidateId))
  runs[kind]++
  Candidate.update({ candidateId: c.candidateId, candidateRuns: runs })
}

export const runCode = async (
  c: CandidateRow,
  kind: 'run' | 'mine' | 'eval',
  files: CandidateFiles,
) => {
  saveFiles(c, files)
  countRun(c, kind)
  if (kind === 'run') return { kind, run: await runPlayground(files) }
  if (kind === 'mine') return { kind, own: await runOwnTests(files) }
  const tests = specOf(assessmentOf(c)).tests.filter((t) =>
    t.visibility === 'public'
  )
  return { kind, results: await runEvaluation(files, tests) }
}

export const checkCode = (files: CandidateFiles) => checkTypes(files)

/* ---------- submission (C3) → preparation (C4) ---------- */

export const submitCode = (
  c: CandidateRow,
  { tools, otherTool, auto = false }: {
    tools: string[]
    otherTool?: string
    auto?: boolean
  },
) => {
  if (c.candidateSubmittedAt) {
    // after an automatic submission, only the AI declaration remains
    Candidate.update({
      candidateId: c.candidateId,
      candidateTools: otherTool ? [...tools, otherTool] : tools,
    })
    return
  }
  const progress: Progress = {
    steps: [{ state: 'done' }, { state: 'wait' }, { state: 'wait' }, {
      state: 'wait',
    }],
  }
  Candidate.update({
    candidateId: c.candidateId,
    candidateSubmittedAt: Math.min(Date.now(), deadline(c)),
    candidateAutoSubmitted: auto ? 1 : 0,
    candidateTools: otherTool ? [...tools, otherTool] : tools,
    candidatePreparation: progress,
  })
  Entry.insert.CANDIDATE_CODE_SUBMITTED({
    companyId: companyOfAssessment(c.assessmentId),
    assessmentId: c.assessmentId,
    candidateId: c.candidateId,
    data: { tools, auto },
  })
  prepareQuestions(c.candidateId, progress)
}

/* ---------- questions (C5, C6) ---------- */

export const questionsOf = (c: CandidateRow) =>
  json<Question[]>(c.candidateQuestions) ?? []

/** a question as the candidate sees it: no answer key */
const forCandidate = (q: Question, demo: boolean) => {
  if (q.type === 'qcm') {
    const { correct: _, check: __, asks: ___, example, ...rest } = q
    return { ...rest, example: demo ? example : -1 }
  }
  const { example, ...rest } = q
  return { ...rest, assistantReply: '', example: demo ? example : '' }
}

export const startQuestions = (c: CandidateRow) => {
  if (!questionsOf(c).length) {
    throw new respond.ConflictError({
      message: 'Vos questions sont encore en préparation.',
    })
  }
  if (c.candidateQuestionsStartedAt) return
  Candidate.update({
    candidateId: c.candidateId,
    candidateQuestionsStartedAt: Date.now(),
  })
  Entry.insert.CANDIDATE_QUESTIONS_STARTED({
    companyId: companyOfAssessment(c.assessmentId),
    assessmentId: c.assessmentId,
    candidateId: c.candidateId,
  })
}

/** Opens the next question: one at a time, no going back (brief C4) */
export const openQuestion = (c: CandidateRow) => {
  if (!c.candidateQuestionsStartedAt) startQuestions(c)
  const questions = questionsOf(c)
  const answers = answersOf(c)
  const n = Object.values(answers).filter((a) => a.sentAt).length + 1
  if (n > questions.length) return { done: true as const, n }
  const now = Date.now()
  const stored = answers[n] ??
    { openedAt: now, assistant: [], assistantTraces: [] }
  answers[n] = stored
  Candidate.update({ candidateId: c.candidateId, candidateAnswers: answers })
  const q = questions[n - 1]
  return {
    done: false as const,
    n,
    total: questions.length,
    question: forCandidate(q, !!runsOf(c).demo),
    secondsLeft: Math.max(
      0,
      Math.round((stored.openedAt + q.seconds * 1000 - now) / 1000),
    ),
    assistant: stored.assistant,
    assistantTraces: stored.assistantTraces,
  }
}

export const sendAnswer = (
  c: CandidateRow,
  { n, choice, text, auto }: {
    n: number
    choice?: number | 'idk' | null
    text?: string | null
    auto?: boolean | null
  },
) => {
  const questions = questionsOf(c)
  const answers = answersOf(c)
  const stored = answers[n]
  if (!stored || stored.sentAt) {
    throw new respond.ConflictError({ message: 'Question déjà envoyée.' })
  }
  const q = questions[n - 1]
  const now = Date.now()
  // the server is the clock: past the time and its grace, the answer is
  // not recorded, the question counts as unanswered « temps écoulé »
  const expired = now > stored.openedAt + q.seconds * 1000 + QUESTION_GRACE_MS
  answers[n] = {
    ...stored,
    sentAt: now,
    choice: q.type === 'qcm' && !expired ? choice ?? 'idk' : undefined,
    text: q.type === 'free'
      ? expired ? '' : (text ?? '').slice(0, 6000)
      : undefined,
    auto: !!auto,
    ...(expired && { expired: true }),
  }
  const finished = n >= questions.length
  Candidate.update({
    candidateId: c.candidateId,
    candidateAnswers: answers,
    ...(finished && { candidateFinishedAt: now }),
  })
  Entry.insert.CANDIDATE_ANSWER_SENT({
    companyId: companyOfAssessment(c.assessmentId),
    assessmentId: c.assessmentId,
    candidateId: c.candidateId,
    data: { n, auto: !!auto, expired },
  })
  if (finished) {
    Entry.insert.CANDIDATE_FINISHED({
      companyId: companyOfAssessment(c.assessmentId),
      assessmentId: c.assessmentId,
      candidateId: c.candidateId,
    })
    buildReport(c.candidateId)
  }
  return { finished }
}

/* ---------- documentation assistant (C6) ---------- */

const ASSISTANT_SYSTEM =
  'Tu es un assistant de documentation technique pendant une évaluation. Tu ne vois ni le code du candidat ni la question posée. Tu expliques des concepts, des API et des bonnes pratiques de façon générale, dans la langue de la question (en français, en vouvoyant ; en anglais si la question est en anglais), en 120 mots au plus. Tu n’écris jamais de code, ni de solution à un exercice, même si on te le demande : dans ce cas, rappelle cette règle et propose une explication du concept.'

// assistant calls waiting for the model, by candidate and question: counted
// by the limit before the reply, so parallel calls cannot pass it (AUD-007)
const pendingAssistant = new Map<string, number>()

export const askAssistant = async (
  c: CandidateRow,
  { n, message }: { n: number; message: string },
) => {
  const questions = questionsOf(c)
  const q = questions[n - 1]
  const answers = answersOf(c)
  const stored = answers[n]
  if (!q || q.type !== 'free' || !stored || stored.sentAt) {
    throw new respond.BadRequestError({
      message:
        'L’assistant n’est disponible que sur une réponse libre en cours.',
    })
  }
  const slot = `${c.candidateId}:${n}`
  const pending = pendingAssistant.get(slot) ?? 0
  const used = stored.assistant.filter((m) => m.role === 'user').length +
    pending
  if (used >= ASSISTANT_LIMIT) {
    throw new respond.BadRequestError({
      message: `${ASSISTANT_LIMIT} messages maximum par question.`,
    })
  }
  // reserved synchronously, before the first await; released on failure
  pendingAssistant.set(slot, pending + 1)
  try {
    return await replyAssistant(c, n, message, stored, used)
  } finally {
    const left = (pendingAssistant.get(slot) ?? 1) - 1
    if (left) pendingAssistant.set(slot, left)
    else pendingAssistant.delete(slot)
  }
}

const replyAssistant = async (
  c: CandidateRow,
  n: number,
  message: string,
  stored: StoredAnswer,
  used: number,
) => {
  const text = message.trim().slice(0, 500)
  const history = stored.assistant
    .map((m) => `${m.role === 'user' ? 'Question' : 'Réponse'} : ${m.text}`)
    .join('\n')
  const { data, trace } = await ask({
    task: 'assistant',
    // the candidate waits, on a 3 min question: the quickest model, and past
    // 12 s Ultra (Lightning's free endpoint takes 30 s and more)
    tier: 'super',
    fallback: 'precise',
    timeoutMs: 12_000,
    system: ASSISTANT_SYSTEM,
    prompt: `${history ? `${history}\n` : ''}Question : ${text}`,
    json: false,
    maxTokens: 400,
    temperature: 0.3,
    parse: (v) => {
      const reply = String(v).trim()
      if (!reply) throw Error('réponse vide')
      return reply
    },
    // demo: the replies of the prototype (C6 streams the first one)
    demo: () => {
      const d = demoOf(
        Assessment.require(c.assessmentId).assessmentLanguage,
      )
      return text === d.assistantQuestion
        ? d.assistantAnswer
        : (d.questions[n - 1] as { assistantReply?: string })
          ?.assistantReply ||
          (d.lang === 'en'
            ? 'I can explain a concept or an API, without seeing your code or the question.'
            : 'Je peux expliquer un concept ou une API, sans voir votre code ni la question.')
    },
    demoTrace: demoTraces.assistant,
  })
  const latest = answersOf(Candidate.require(c.candidateId))
  latest[n] = {
    ...latest[n],
    assistant: [...latest[n].assistant, { role: 'user', text }, {
      role: 'bot',
      text: data,
    }],
    assistantTraces: [...latest[n].assistantTraces, trace],
  }
  Candidate.update({ candidateId: c.candidateId, candidateAnswers: latest })
  return { reply: data, trace, left: ASSISTANT_LIMIT - used - 1 }
}

/* ---------- integrity (C6): facts, no automatic penalty ---------- */

export const logIntegrity = (
  c: CandidateRow,
  event: {
    kind: IntegrityKind
    question: number
    durationSec?: number | null
  },
) => {
  Entry.insert.CANDIDATE_INTEGRITY_EVENT({
    companyId: companyOfAssessment(c.assessmentId),
    assessmentId: c.assessmentId,
    candidateId: c.candidateId,
    data: event,
  })
}
