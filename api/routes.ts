import { deleteCookie, setCookie } from 'jsr:@std/http/cookie'
import type { RequestContext } from '@01edu/api/context'
import { makeRouter, route } from '@01edu/api/router'
import { respond } from '@01edu/api/response'
import { metrics } from '@01edu/db'
import {
  ARR,
  BOOL,
  LIST,
  NUM,
  OBJ,
  optional,
  STR,
  UNION,
} from '@01edu/api/validator'
import { log } from '/api/lib/log.ts'
import { replayForDemo } from '/api/lib/ai-context.ts'
import { APP_ENV } from '/api/lib/env.ts'
import { FILES, JSON_OF } from '/api/lib/validator.ts'
import {
  Assessment,
  Candidate,
  companyOfAssessment,
  demoCompanyId,
  demoMemberId,
  entryInsertListeners,
  type EntryListener,
} from '/api/schema.ts'
import {
  authenticate,
  createCompany,
  decodeSession,
  generateSession,
  logout,
  type MemberSession,
  type MemberView,
  memberView,
  SESSION_SECONDS,
} from '/api/member.ts'
import {
  approveAssessment,
  createAssessment,
  getAssessment,
  listCompanyAssessments,
  prefillFromDescription,
  regenerateAssessment,
  retryGeneration,
  setDeletedTests,
  updateAssessment,
} from '/api/assessment.ts'
import {
  askAssistant,
  autoSubmitIfExpired,
  checkCode,
  findCandidate,
  getInvitation,
  inviteCandidate,
  logIntegrity,
  openQuestion,
  revokeInvitation,
  runCode,
  saveFiles,
  sendAnswer,
  startCandidate,
  startQuestions,
  submitCode,
  toView,
} from '/api/candidate.ts'
import { retryPreparation } from '/api/analysis.ts'
import { CV_MAX_BYTES, type CvReading, readCv } from '/api/cv.ts'
import { type LinkSent, sendCandidateLink } from '/api/email.ts'
import { decodeBase64 } from 'jsr:@std/encoding/base64'
import {
  type Decision,
  getReport,
  type ReportView,
  retryReport,
  saveDecision,
} from '/api/report.ts'
import type { CodeProblem, OwnTestsRun, SandboxRun } from '/api/sandbox.ts'
import type {
  AiTrace,
  AssessmentState,
  AssistantMessage,
  CandidateView,
  Invitation,
  TestResult,
} from '/web/types.ts'

const ACK_PAYLOAD = new TextEncoder().encode('event: ack\ndata: \n\n')
const CANDIDATE_COOKIE = 'dfd_candidate'

/* ---------- sessions ---------- */

const MEMBER_COOKIE = 'dfd_session'
// the guided demo can log in the demo member (POST/api/demo/session)
const demoAccess = () => Deno.env.get('DEMO_ACCESS') === '1'
const withSession = async (ctx: RequestContext) => {
  const session = await decodeSession(ctx.cookies[MEMBER_COOKIE])
  if (!session) {
    throw new respond.UnauthorizedError({ message: 'Connexion requise.' })
  }
  return session
}
// U3: every recruiter route needs a session, in every environment
const withMember = async (ctx: RequestContext): Promise<MemberSession> => {
  if (ctx.req.method !== 'GET') checkOrigin(ctx)
  const session = await withSession(ctx)
  // the demo company replays the recorded answers (api/lib/ai-context.ts)
  replayForDemo(session.companyId === demoCompanyId)
  return session
}
const memberOf = (ctx: RequestContext) =>
  (ctx as RequestContext & { session: MemberSession }).session
const ownedAssessment = (ctx: RequestContext, value: string | number) => {
  const assessmentId = id(value)
  const row = Assessment.get(assessmentId)
  if (!row || row.companyId !== memberOf(ctx).companyId) {
    throw new respond.NotFoundError({ message: 'Épreuve introuvable.' })
  }
  return assessmentId
}
const ownedCandidate = (ctx: RequestContext, value: string | number) => {
  const candidateId = id(value)
  const row = Candidate.get(candidateId)
  if (!row) {
    throw new respond.NotFoundError({ message: 'Candidat introuvable.' })
  }
  ownedAssessment(ctx, row.assessmentId)
  return candidateId
}
// Same host only: behind a TLS proxy the server sees http:// while the
// browser sends Origin: https://, so the scheme is not compared.
const checkOrigin = (ctx: RequestContext) => {
  const origin = ctx.req.headers.get('origin')
  let host: string | undefined
  try {
    host = origin ? new URL(origin).host : undefined
  } catch { /* malformed Origin: refused below */ }
  if (origin && host !== ctx.url.host) {
    throw new respond.ForbiddenError({ message: 'Origine non autorisée.' })
  }
}
const sessionResponse = async (token: string) => {
  const session = await decodeSession(token)
  if (!session) {
    throw new respond.UnauthorizedError({ message: 'Session invalide.' })
  }
  const response = respond.OK(memberView(session.memberId))
  setCookie(response.headers, {
    name: MEMBER_COOKIE,
    value: token,
    httpOnly: true,
    secure: APP_ENV === 'prod',
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_SECONDS,
  })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

const withCandidate = (ctx: RequestContext) => {
  const c = findCandidate(ctx.cookies[CANDIDATE_COOKIE])
  // a candidate of the demo company: replay, set before any automatic
  // submission (it starts the analysis)
  replayForDemo(companyOfAssessment(c.assessmentId) === demoCompanyId)
  return autoSubmitIfExpired(c)
}

const candidateOf = (ctx: RequestContext) =>
  (ctx as RequestContext & { session: ReturnType<typeof withCandidate> })
    .session

const id = (value: string | number) => {
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) {
    throw new respond.BadRequestError({ message: 'Identifiant invalide' })
  }
  return n
}

/* ---------- shared validators ---------- */

const ASSESSMENT = JSON_OF<AssessmentState>('Assessment and its state')
const CANDIDATE = JSON_OF<CandidateView>('Candidate session')
const TRACE = JSON_OF<AiTrace>('AI trace: model, place, latency, tokens')
const LEVEL = LIST(['junior', 'intermediate', 'senior'], 'Level')
// The framework's default validator report echoes invalid values. Auth fields
// must never be echoed, even when a password has an unexpected JSON type.
const signupInput = {
  ...OBJ({
    companyName: STR('Company name'),
    name: STR('Member name'),
    email: STR('Email'),
    password: STR('Password'),
    confirmPassword: optional(STR('Password typed again')),
  }),
  report: () => [],
}
const loginInput = {
  ...OBJ({ email: STR('Email'), password: STR('Password') }),
  report: () => [],
}

const defs = {
  // Prevent makeRouter from injecting unrestricted SQL/dev endpoints.
  'POST/api/sql/execute': route({ fn: () => respond.NotFound() }),
  'GET/api/sql/metrics': route({ fn: () => respond.NotFound() }),
  'GET/api/router/metrics': route({ fn: () => respond.NotFound() }),
  'POST/api/signup': route({
    fn: async (ctx, input) => {
      checkOrigin(ctx)
      return sessionResponse(await generateSession(await createCompany(input)))
    },
    input: signupInput,
    output: JSON_OF<MemberView>('Current member and company'),
  }),
  'POST/api/login': route({
    fn: async (ctx, { email, password }) => {
      checkOrigin(ctx)
      return sessionResponse(await authenticate(email, password))
    },
    input: loginInput,
    output: JSON_OF<MemberView>('Current member and company'),
  }),
  'POST/api/logout': route({
    fn: async (ctx) => {
      checkOrigin(ctx)
      const session = await decodeSession(ctx.cookies[MEMBER_COOKIE])
      if (session) logout(session)
      const response = respond.NoContent()
      deleteCookie(response.headers, MEMBER_COOKIE, { path: '/' })
      return response
    },
  }),
  'GET/api/me': route({
    authorize: withSession,
    fn: (ctx) => {
      const response = respond.OK(memberView(ctx.session.memberId))
      response.headers.set('Cache-Control', 'no-store')
      return response
    },
    output: JSON_OF<MemberView>('Current member and company'),
  }),
  'POST/api/demo/session': route({
    fn: async (ctx) => {
      if (!demoAccess()) {
        throw new respond.NotFoundError({ message: 'Démo indisponible.' })
      }
      checkOrigin(ctx)
      return sessionResponse(await generateSession(demoMemberId))
    },
    output: JSON_OF<MemberView>('Demo member and company'),
  }),
  'GET/api/demo': route({
    fn: () => ({ available: demoAccess() }),
    output: OBJ({ available: BOOL('Demo account available (DEMO_ACCESS)') }),
    description: 'Whether « Essayer la démo » can log in the demo member',
  }),
  'GET/api/health': route({
    fn: () => ({ status: 'ok', env: APP_ENV }),
    output: OBJ({
      status: STR('Always "ok" when the server answers'),
      env: STR('Current APP_ENV (dev, test or prod)'),
    }),
    description: 'Healthcheck used by docker and the dev tooling',
  }),

  /* ---------- recruiter: assessments (R1 → R5) ---------- */

  'GET/api/assessments': route({
    authorize: withMember,
    fn: (ctx) => listCompanyAssessments(memberOf(ctx).companyId),
    output: ARR(ASSESSMENT, 'Every assessment, newest first'),
    description: 'R1 « Mes épreuves »',
  }),

  'GET/api/assessment': route({
    authorize: withMember,
    fn: (ctx, { id: value }) => getAssessment(ownedAssessment(ctx, value)),
    input: OBJ({ id: STR('Assessment id') }),
    output: ASSESSMENT,
    description: 'One assessment, with its generation progress (R3, R4, R5)',
  }),

  'POST/api/assessment/prefill': route({
    authorize: withMember,
    fn: (_ctx, { jobDescription }) => prefillFromDescription(jobDescription),
    input: OBJ({ jobDescription: STR('Job description, 80 chars or more') }),
    output: OBJ({
      level: LEVEL,
      skills: ARR(STR('Skill name'), 'Suggested skills, 5 at most'),
      trace: TRACE,
    }),
    description: 'R2 « Préremplir niveau et compétences »',
  }),

  'POST/api/assessment': route({
    authorize: withMember,
    fn: (ctx, { simulate, ...input }) => {
      if (input.jobDescription.trim().length < 80) {
        throw new respond.BadRequestError({
          message: 'La description doit compter au moins 80 caractères.',
        })
      }
      if (!input.skills.length || input.skills.length > 5) {
        throw new respond.BadRequestError({
          message: 'Choisissez entre 1 et 5 compétences.',
        })
      }
      // the durations of the form: the timer and the prompt trust it (AUD-009)
      if (![60, 90, 120].includes(input.durationMin)) {
        throw new respond.BadRequestError({
          message: 'La durée doit être de 60, 90 ou 120 minutes.',
        })
      }
      return createAssessment(
        {
          ...input,
          domain: input.domain || undefined,
          language: input.language,
        },
        simulate as 'repli' | 'echec' | undefined,
        memberOf(ctx),
      )
    },
    input: OBJ({
      jobDescription: STR('Job description'),
      level: LEVEL,
      durationMin: NUM('60, 90 or 120 minutes'),
      skills: ARR(STR('Skill name'), '1 to 5 skills'),
      domain: optional(STR('Business domain')),
      language: LIST(['fr', 'en'], 'Language of the assessment'),
      simulate: optional(
        LIST(['repli', 'echec'], 'Replays an error state of the prototype'),
      ),
    }),
    output: OBJ({ id: NUM('Id of the assessment being generated') }),
    description: 'R2 « Générer l’épreuve »: starts the generation (R3)',
  }),

  'POST/api/assessment/retry': route({
    authorize: withMember,
    fn: (ctx, { id: value }) => retryGeneration(ownedAssessment(ctx, value)),
    input: OBJ({ id: NUM('Assessment id') }),
    description: 'R3 « Réessayer » after a failed generation',
  }),

  'POST/api/assessment/update': route({
    authorize: withMember,
    fn: (ctx, { id: value, ...patch }) => {
      updateAssessment(ownedAssessment(ctx, value), patch)
      return getAssessment(ownedAssessment(ctx, value))
    },
    input: OBJ({
      id: NUM('Assessment id'),
      title: optional(STR('New title')),
      context: optional(STR('New context, as the candidate reads it')),
      mission: optional(STR('New mission, as the candidate reads it')),
    }),
    output: ASSESSMENT,
    description: 'R4 inline edits of a draft',
  }),

  'POST/api/assessment/deleted-tests': route({
    authorize: withMember,
    fn: (ctx, { id: value, testIds }) => {
      setDeletedTests(ownedAssessment(ctx, value), testIds)
      return getAssessment(ownedAssessment(ctx, value))
    },
    input: OBJ({
      id: NUM('Assessment id'),
      testIds: ARR(STR('Test id'), 'Tests removed before approval'),
    }),
    output: ASSESSMENT,
    description: 'R4 test deletion (applied at approval)',
  }),

  'POST/api/assessment/regenerate': route({
    authorize: withMember,
    fn: (ctx, { id: value, instruction }) =>
      regenerateAssessment(ownedAssessment(ctx, value), instruction),
    input: OBJ({
      id: NUM('Assessment id'),
      instruction: STR('Recruiter instruction'),
    }),
    description: 'R4 « Régénérer avec une consigne »',
  }),

  'POST/api/assessment/approve': route({
    authorize: withMember,
    fn: (ctx, { id: value }) => approveAssessment(ownedAssessment(ctx, value)),
    input: OBJ({ id: NUM('Assessment id') }),
    output: ASSESSMENT,
    description: 'R4 → R5: freezes the assessment, creates the candidate link',
  }),

  /* ---------- recruiter: candidates (R5, U4) ---------- */

  'POST/api/candidate/invite': route({
    authorize: withMember,
    fn: async (ctx, { assessment, sendEmail, fromCv, ...identity }) => {
      const invited = inviteCandidate(
        ownedAssessment(ctx, assessment),
        memberOf(ctx).memberId,
        { ...identity, source: fromCv ? 'cv' : 'manual' },
      )
      const email = sendEmail
        ? await sendCandidateLink(Candidate.require(invited.candidateId))
        : undefined
      return { ...invited, email }
    },
    input: OBJ({
      assessment: NUM('Assessment id'),
      firstName: STR('First name'),
      lastName: STR('Last name'),
      email: STR('Email'),
      profileUrl: optional(STR('LinkedIn, GitHub or portfolio (https://)')),
      note: optional(STR('Internal note, never shown to the candidate')),
      fromCv: optional(BOOL('Prefilled from a CV, validated by the recruiter')),
      sendEmail: optional(BOOL('E-mail the personal link (Resend)')),
    }),
    output: OBJ({
      candidateId: NUM('Invited candidate'),
      invitation: STR('Token of the personal link'),
      email: optional(JSON_OF<LinkSent>('E-mail of the personal link')),
    }),
    description: 'R5 « Inviter un candidat »: identity and personal link',
  }),

  'POST/api/candidate/send-link': route({
    authorize: withMember,
    fn: (ctx, { candidate }) =>
      sendCandidateLink(Candidate.require(ownedCandidate(ctx, candidate))),
    input: OBJ({ candidate: NUM('Candidate id') }),
    output: JSON_OF<LinkSent>('Sent, or the reason of the failure'),
    description: 'R5 « Envoyer / renvoyer le lien par e-mail »',
  }),

  'POST/api/candidate/cv': route({
    authorize: withMember,
    fn: (ctx, { assessment, data }) => {
      ownedAssessment(ctx, assessment)
      // base64 of 5 MB at most: the file never leaves this request
      if (data.length > Math.ceil(CV_MAX_BYTES / 3) * 4 + 4) {
        throw new respond.BadRequestError({
          message: 'CV trop lourd (5 Mo max).',
        })
      }
      let bytes: Uint8Array
      try {
        bytes = decodeBase64(data)
      } catch {
        throw new respond.BadRequestError({ message: 'Fichier illisible.' })
      }
      return readCv(bytes)
    },
    input: OBJ({
      assessment: NUM('Assessment id the candidate will be invited to'),
      data: STR('The CV file (PDF or DOCX), base64'),
    }),
    output: JSON_OF<CvReading>('Fields read in the CV, to validate'),
    description: 'R5 « Importer un CV »: prefills the invitation form',
  }),

  'POST/api/candidate/revoke': route({
    authorize: withMember,
    fn: (ctx, { candidate }) =>
      revokeInvitation(ownedCandidate(ctx, candidate)),
    input: OBJ({ candidate: NUM('Candidate id') }),
    description: 'R5 « Révoquer le lien » of a candidate',
  }),

  /* ---------- recruiter: report (R6) ---------- */

  'GET/api/report': route({
    authorize: withMember,
    fn: (ctx, { candidate }) => getReport(ownedCandidate(ctx, candidate)),
    input: OBJ({ candidate: STR('Candidate id') }),
    output: JSON_OF<ReportView>('Report of a candidate, once generated'),
    description: 'R6 report, results, code and decision',
  }),

  'POST/api/report/retry': route({
    authorize: withMember,
    fn: (ctx, { candidate }) => retryReport(ownedCandidate(ctx, candidate)),
    input: OBJ({ candidate: NUM('Candidate id') }),
    description: 'R6 « Réessayer » after a failed report',
  }),

  'POST/api/decision': route({
    authorize: withMember,
    fn: (ctx, { candidate, choice, note }) =>
      saveDecision(ownedCandidate(ctx, candidate), { choice, note }),
    input: OBJ({
      candidate: NUM('Candidate id'),
      choice: LIST(['go', 'no', 'info'], 'Human decision'),
      note: STR('Internal note'),
    }),
    output: JSON_OF<Decision>('Saved decision and its timestamp'),
    description: 'R6 « Enregistrer la décision » (decision is human only)',
  }),

  /* ---------- candidate (C1 → C7) ---------- */

  'GET/api/invitation': route({
    fn: (_ctx, { invitation }) => getInvitation(invitation || undefined),
    input: OBJ({ invitation: optional(STR('Token of the candidate link')) }),
    output: JSON_OF<Invitation>('What C1 shows before starting'),
    description: 'C1: the assessment of a candidate link',
  }),

  'POST/api/candidate/start': route({
    fn: (_ctx, { invitation, demo }) => {
      const token = startCandidate(invitation, demo ?? false)
      const response = respond.OK(toView(findCandidate(token)))
      setCookie(response.headers, {
        name: CANDIDATE_COOKIE,
        value: token,
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
        secure: APP_ENV === 'prod',
        maxAge: 7 * 24 * 3600,
      })
      return response
    },
    input: OBJ({
      invitation: STR('Token of the candidate link'),
      demo: optional(BOOL('Guided demo: clock at 01:12:43 on the draft')),
    }),
    output: CANDIDATE,
    description: 'C1 « Commencer la phase de construction »',
  }),

  'GET/api/candidate/me': route({
    authorize: withCandidate,
    fn: (ctx) => toView(candidateOf(ctx)),
    output: CANDIDATE,
    description: 'Session of the candidate (timer, files, progress)',
  }),

  'POST/api/candidate/files': route({
    authorize: withCandidate,
    fn: (ctx, { files }) => saveFiles(candidateOf(ctx), files),
    input: OBJ({ files: FILES }),
    output: OBJ({ savedAt: NUM('Save timestamp (ms)') }),
    description: 'C2 auto-save',
  }),

  'POST/api/candidate/run': route({
    authorize: withCandidate,
    fn: (ctx, { kind, files }) => runCode(candidateOf(ctx), kind, files),
    input: OBJ({
      kind: LIST(
        ['run', 'mine', 'eval'],
        'Exécuter, Mes tests, Tests d’évaluation',
      ),
      files: FILES,
    }),
    output: JSON_OF<{
      kind: 'run' | 'mine' | 'eval'
      run?: SandboxRun
      own?: OwnTestsRun
      results?: TestResult[]
    }>('Output of the sandbox'),
    description: 'C2 runs in the Deno sandbox',
  }),

  'POST/api/candidate/check': route({
    authorize: withCandidate,
    fn: (_ctx, { files }) => checkCode(files),
    input: OBJ({ files: FILES }),
    output: JSON_OF<CodeProblem[]>('Type errors of deno check'),
    description: 'C2 type errors under the code',
  }),

  'POST/api/candidate/submit': route({
    authorize: withCandidate,
    fn: (ctx, { tools, otherTool, files }) => {
      const c = candidateOf(ctx)
      if (!tools.length) {
        throw new respond.BadRequestError({
          message: 'Déclarez au moins un outil IA (ou « Aucun »).',
        })
      }
      if (files && !c.candidateSubmittedAt) saveFiles(c, files)
      submitCode(findCandidate(c.candidateToken), {
        tools,
        otherTool: otherTool || undefined,
      })
      return toView(findCandidate(c.candidateToken))
    },
    input: OBJ({
      tools: ARR(STR('AI tool'), 'Declared AI tools'),
      otherTool: optional(STR('« Autre » tool')),
      files: optional(FILES),
    }),
    output: CANDIDATE,
    description: 'C3 submission, then the C4 preparation starts',
  }),

  'POST/api/candidate/preparation/retry': route({
    authorize: withCandidate,
    fn: (ctx) => retryPreparation(candidateOf(ctx).candidateId),
    description: 'C4 « Réessayer » after a failed preparation',
  }),

  'POST/api/candidate/questions/start': route({
    authorize: withCandidate,
    fn: (ctx) => startQuestions(candidateOf(ctx)),
    description: 'C4 « Commencer (plein écran) »',
  }),

  'GET/api/candidate/question': route({
    authorize: withCandidate,
    fn: (ctx) => openQuestion(candidateOf(ctx)),
    output: JSON_OF<ReturnType<typeof openQuestion>>(
      'Current question, its remaining time and assistant thread',
    ),
    description: 'C5/C6: one question at a time, no going back',
  }),

  'POST/api/candidate/answer': route({
    authorize: withCandidate,
    fn: (ctx, input) => sendAnswer(candidateOf(ctx), input),
    input: OBJ({
      n: NUM('Question number'),
      choice: optional(
        UNION(NUM('Index of the option'), LIST(['idk'], 'Je ne sais pas')),
      ),
      text: optional(STR('Free answer')),
      auto: optional(BOOL('Sent by the timer at 00:00')),
    }),
    output: OBJ({ finished: BOOL('Last question answered') }),
    description: 'C5/C6 « Valider »',
  }),

  'POST/api/candidate/assistant': route({
    authorize: withCandidate,
    fn: (ctx, input) => askAssistant(candidateOf(ctx), input),
    input: OBJ({
      n: NUM('Question number'),
      message: STR('Question to the documentation assistant'),
    }),
    output: OBJ({
      reply: STR('Reply of the assistant'),
      trace: TRACE,
      left: NUM('Messages left on this question'),
    }),
    description: 'C6 documentation assistant (no code, no question)',
  }),

  'POST/api/candidate/integrity': route({
    authorize: withCandidate,
    fn: (ctx, event) => logIntegrity(candidateOf(ctx), event),
    input: OBJ({
      kind: LIST(
        ['page-leave', 'paste-blocked', 'fullscreen-exit'],
        'Kind of event',
      ),
      question: NUM('Question number'),
      durationSec: optional(NUM('Time away (s)')),
    }),
    description: 'C6 facts for the recruiter, without automatic penalty',
  }),

  /* ---------- events ---------- */

  'GET/api/events': route({
    async fn(ctx, input) {
      if (!ctx.req.headers.get('accept')?.includes('text/event-stream')) {
        throw new respond.BadRequestError({
          message: 'Must accept event-stream',
        })
      }
      let companyId: number | undefined
      let assessmentId: number | undefined
      let candidateId: number | undefined
      let session: MemberSession | undefined
      if (input.candidate === 'me') {
        // Never combine the candidate scope with an arbitrary assessment.
        if (input.assessment) {
          throw new respond.BadRequestError({
            message: 'Filtres incompatibles.',
          })
        }
        candidateId = findCandidate(ctx.cookies[CANDIDATE_COOKIE]).candidateId
      } else {
        session = await withMember(ctx)
        companyId = session.companyId
        const scoped = { ...ctx, session }
        if (input.assessment) {
          assessmentId = ownedAssessment(scoped, input.assessment)
        }
        if (input.candidate) {
          candidateId = ownedCandidate(scoped, input.candidate)
        }
      }
      let listener: EntryListener
      let ackInterval: ReturnType<typeof setInterval>
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(ACK_PAYLOAD)
          ackInterval = setInterval(async () => {
            try {
              if (
                session?.entryId &&
                !await decodeSession(ctx.cookies[MEMBER_COOKIE])
              ) {
                clearInterval(ackInterval)
                entryInsertListeners.delete(listener)
                controller.close()
                return
              }
              controller.enqueue(ACK_PAYLOAD)
            } catch {
              clearInterval(ackInterval)
              entryInsertListeners.delete(listener)
              try {
                controller.close()
              } catch { /* should already be closed */ }
            }
          }, 15_000)
          listener = {
            memberSessionId: session?.entryId,
            companyId,
            assessmentId,
            candidateId,
            controller,
          }
          entryInsertListeners.add(listener)
        },
        cancel() {
          clearInterval(ackInterval)
          entryInsertListeners.delete(listener)
        },
      })

      return new Response(body, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      })
    },
    input: OBJ({
      assessment: optional(STR('Followed assessment')),
      candidate: optional(STR('Followed candidate, "me" for the candidate')),
    }),
  }),
} as const

export type RouteDefinitions = typeof defs
export type { AssistantMessage }
export const routeHandler = makeRouter(defs, { log, metrics })
