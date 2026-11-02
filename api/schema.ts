import { entries } from '/api/entries.ts'
import { createTable, db, type Row, sql } from '@01edu/db'
import { hashPassword } from '/api/password.ts'
import { runMigrations } from '@01edu/db/migration'
import { fromFileUrl } from 'jsr:@std/path'
import { initEntries } from '@01edu/db/entries'

// Migrations must run before createTable: createTable asserts that the
// existing table matches the declared schema, so a column added by a pending
// migration would crash the boot before the migration gets a chance to run.
const migrationsPath = fromFileUrl(import.meta.resolve('../migrations'))
await runMigrations(migrationsPath)

export const Company = createTable('company', {
  companyId: { type: 'INTEGER', primary: true },
  companyName: { type: 'TEXT' },
  companyCreatedAt: { type: 'REAL' },
})
export const Member = createTable('member', {
  memberId: { type: 'INTEGER', primary: true },
  companyId: { type: 'INTEGER', join: Company },
  memberName: { type: 'TEXT' },
  memberEmail: { type: 'TEXT' },
  memberPassword: { type: 'BLOB' },
  memberCreatedAt: { type: 'REAL' },
})
sql`CREATE UNIQUE INDEX IF NOT EXISTS member_email_unique ON member(memberEmail)`
  .run()

// Columns added by a migration go last and are optional (ALTER TABLE ADD).
export const Assessment = createTable('assessment', {
  assessmentId: { type: 'INTEGER', primary: true },
  assessmentTitle: { type: 'TEXT' },
  assessmentLevel: { type: 'TEXT' }, // junior | intermediate | senior
  assessmentDuration: { type: 'INTEGER' }, // minutes: 60 | 90 | 120
  assessmentLanguage: { type: 'TEXT' }, // fr | en
  assessmentJobDescription: { type: 'TEXT' },
  assessmentSpec: { type: 'JSON', optional: true }, // generated content
  // 002
  assessmentStatus: { type: 'TEXT', optional: true }, // AssessmentStatus
  assessmentSkills: { type: 'JSON', optional: true }, // recruiter's choice
  assessmentDomain: { type: 'TEXT', optional: true },
  assessmentCreatedAt: { type: 'REAL', optional: true }, // ms epoch
  assessmentApprovedAt: { type: 'REAL', optional: true },
  assessmentTrace: { type: 'JSON', optional: true }, // generation AiTrace
  assessmentGeneration: { type: 'JSON', optional: true }, // R3 progress
  assessmentChecks: { type: 'JSON', optional: true }, // sandbox checks
  assessmentDeletedTests: { type: 'JSON', optional: true }, // R4, pending
  assessmentStarterFiles: { type: 'JSON', optional: true }, // C2 start
  assessmentInvitation: { type: 'TEXT', optional: true }, // candidate link
  companyId: { type: 'INTEGER', join: Company, optional: true },
  assessmentCreatedBy: { type: 'INTEGER', join: Member, optional: true },
})

export const Candidate = createTable('candidate', {
  candidateId: { type: 'INTEGER', primary: true },
  candidateToken: { type: 'TEXT' },
  candidatePseudonym: { type: 'TEXT' }, // e.g. "Candidat A7F3", never a name
  assessmentId: { type: 'INTEGER', join: Assessment },
  // 002
  candidateCreatedAt: { type: 'REAL', optional: true },
  candidateStartedAt: { type: 'REAL', optional: true }, // C1 "Commencer"
  candidateSubmittedAt: { type: 'REAL', optional: true },
  candidateAutoSubmitted: { type: 'INTEGER', optional: true }, // 0 | 1
  candidateTools: { type: 'JSON', optional: true }, // declared AI tools
  candidateFiles: { type: 'JSON', optional: true }, // CandidateFiles
  candidateSavedAt: { type: 'REAL', optional: true },
  candidateRuns: { type: 'JSON', optional: true }, // counters of C2 runs
  candidateResults: { type: 'JSON', optional: true }, // tests after C3
  candidatePreparation: { type: 'JSON', optional: true }, // C4 progress
  candidateAnalysis: { type: 'JSON', optional: true }, // observations
  candidateQuestions: { type: 'JSON', optional: true }, // the 10 questions
  candidateQuestionsStartedAt: { type: 'REAL', optional: true },
  candidateAnswers: { type: 'JSON', optional: true }, // by question number
  candidateFinishedAt: { type: 'REAL', optional: true },
  candidateReport: { type: 'JSON', optional: true }, // R6
  candidateDecision: { type: 'JSON', optional: true }, // human decision
  // 005 (U4): personal link and identity, entered by the recruiter; the
  // identity is never sent to the models
  candidateInvitation: { type: 'TEXT', optional: true }, // token of the link
  candidateInvitedAt: { type: 'REAL', optional: true },
  candidateInvitedBy: { type: 'INTEGER', optional: true }, // memberId
  candidateRevokedAt: { type: 'REAL', optional: true },
  candidateFirstName: { type: 'TEXT', optional: true },
  candidateLastName: { type: 'TEXT', optional: true },
  candidateEmail: { type: 'TEXT', optional: true }, // lower-case
  candidateProfileUrl: { type: 'TEXT', optional: true }, // https://
  candidateNote: { type: 'TEXT', optional: true }, // internal, recruiter only
  candidateIdentitySource: { type: 'TEXT', optional: true }, // manual | cv
  // 006 (U5): the personal link sent by e-mail
  candidateEmailSentAt: { type: 'REAL', optional: true },
  candidateEmailError: { type: 'TEXT', optional: true }, // last failure
})
sql`CREATE UNIQUE INDEX IF NOT EXISTS candidate_invitation
  ON candidate(candidateInvitation)`.run()

const relations = {
  assessmentId: Assessment,
  candidateId: Candidate,
  companyId: Company,
  memberId: Member,
}

// `undefined === undefined` must not match: a listener only follows the
// assessment or the candidate it subscribed to (GET/api/events).
type Scope = {
  memberSessionId?: number
  assessmentId?: number | null
  candidateId?: number | null
  companyId?: number | null
}
const activeListener = (sub: Scope) =>
  !sub.memberSessionId || !!sql<{ id: number }, number>`
  SELECT id FROM entryInternal WHERE id = ? AND type = ${entries.MEMBER_LOGIN}
  AND archivedAt IS NULL AND createdAt > unixepoch('now','subsec') - 1209600
`.get(sub.memberSessionId)

const sameAssessment = (entry: Scope, sub: Scope) =>
  activeListener(sub) &&
  (sub.companyId != null
    ? entry.companyId === sub.companyId &&
      (sub.assessmentId == null || entry.assessmentId === sub.assessmentId) &&
      (sub.candidateId == null || entry.candidateId === sub.candidateId)
    : sub.candidateId == null && sub.assessmentId != null &&
      entry.assessmentId === sub.assessmentId)

const sameCandidate = (
  entry: Scope,
  sub: Scope,
) =>
  sub.companyId != null
    ? sameAssessment(entry, sub)
    : sub.candidateId != null
    ? entry.candidateId === sub.candidateId
    : sameAssessment(entry, sub)

export const Entry = initEntries(entries, relations, {
  UNKNOWN: {},
  COMPANY_CREATED: { companyId: 'company' },
  MEMBER_CREATED: { companyId: 'company', memberId: 'member' },
  MEMBER_LOGIN: { companyId: 'company', memberId: 'member' },
  MEMBER_LOGIN_FAILED: { data: 'normalized email only, never a password' },

  /*
   * Assessment entries
   */
  ASSESSMENT_CREATED: {
    companyId: 'owning company',
    assessmentId: 'newly created assessment',
  },
  ASSESSMENT_UPDATED: {
    companyId: 'owning company',
    assessmentId: 'updated assessment',
    data: 'previous values',
    trigger: sameAssessment,
  },
  ASSESSMENT_APPROVED: {
    companyId: 'owning company',
    assessmentId: 'assessment frozen by the recruiter',
    trigger: sameAssessment,
  },
  ASSESSMENT_GENERATION_STEP: {
    companyId: 'owning company',
    assessmentId: 'assessment being generated',
    data: 'step index, state and AI trace',
    trigger: sameAssessment,
  },

  /*
   * Candidate entries
   */
  CANDIDATE_INVITED: {
    companyId: 'owning company',
    assessmentId: 'assessment the candidate is invited to',
    candidateId: 'invited candidate',
    trigger: sameAssessment,
  },
  CANDIDATE_LINK_SENT: {
    companyId: 'owning company',
    assessmentId: 'assessment the candidate is invited to',
    candidateId: 'candidate whose personal link was e-mailed',
    data: 'sent or failure reason',
    trigger: sameAssessment,
  },
  CANDIDATE_BUILD_STARTED: {
    companyId: 'owning company',
    assessmentId: 'assessment',
    candidateId: 'candidate who accepted the rules (C1)',
    trigger: sameCandidate,
  },
  CANDIDATE_CODE_SUBMITTED: {
    companyId: 'owning company',
    assessmentId: 'assessment',
    candidateId: 'candidate whose code is frozen (C3)',
    data: 'declared AI tools, automatic submission',
    trigger: sameCandidate,
  },
  CANDIDATE_PREPARATION_STEP: {
    companyId: 'owning company',
    assessmentId: 'assessment',
    candidateId: 'candidate whose questions are being prepared (C4)',
    data: 'step index, state and AI trace',
    trigger: sameCandidate,
  },
  CANDIDATE_QUESTIONS_STARTED: {
    companyId: 'owning company',
    assessmentId: 'assessment',
    candidateId: 'candidate',
    trigger: sameCandidate,
  },
  CANDIDATE_ANSWER_SENT: {
    companyId: 'owning company',
    assessmentId: 'assessment',
    candidateId: 'candidate',
    data: 'question number, automatic sending',
  },
  CANDIDATE_INTEGRITY_EVENT: {
    companyId: 'owning company',
    assessmentId: 'assessment',
    candidateId: 'candidate',
    data:
      'kind (page-leave, paste-blocked, fullscreen-exit), question, duration',
  },
  CANDIDATE_FINISHED: {
    companyId: 'owning company',
    assessmentId: 'assessment',
    candidateId: 'candidate who answered the 10 questions (C7)',
    trigger: sameCandidate,
  },
  CANDIDATE_REPORT_READY: {
    companyId: 'owning company',
    assessmentId: 'assessment',
    candidateId: 'candidate whose report is generated (R6)',
    trigger: sameCandidate,
  },
  DECISION_SAVED: {
    companyId: 'owning company',
    assessmentId: 'assessment',
    candidateId: 'candidate',
    data: 'human decision and note',
    trigger: sameCandidate,
  },
})

export type AssessmentRow = Row<typeof Assessment.properties>
export type CandidateRow = Row<typeof Candidate.properties>

export type EntryListener = {
  memberSessionId?: number
  companyId?: number
  assessmentId?: number
  candidateId?: number
  controller: ReadableStreamDefaultController
}

export const entryInsertListeners = Entry.insertListeners
export const archiveEntry = Entry.archive

// Idempotent U2 backfill runs after createTable, including on fresh databases.
const demoEmail = 'demo@defendable.invalid'
const existingDemo = Member.sql<'memberId' | 'companyId', string>`
  SELECT memberId, companyId FROM member WHERE memberEmail = ?
`.get(demoEmail)
const demoPassword = Deno.env.get('DEMO_PASSWORD')
if (
  !existingDemo && demoPassword &&
  (demoPassword.length < 10 || demoPassword.length > 1024)
) {
  throw Error('DEMO_PASSWORD must contain 10 to 1024 characters')
}
const demoHash = !existingDemo
  ? demoPassword
    ? await hashPassword(demoPassword)
    : crypto.getRandomValues(new Uint8Array(16))
  : undefined
const demo = existingDemo ?? db.transaction(() => {
  const companyId = Company.insert({
    companyName: 'Espace démo',
    companyCreatedAt: Date.now(),
  })
  const memberId = Member.insert({
    companyId,
    memberName: 'Démo',
    memberEmail: demoEmail,
    memberPassword: demoHash!,
    memberCreatedAt: Date.now(),
  })
  Entry.insert.COMPANY_CREATED({ companyId })
  Entry.insert.MEMBER_CREATED({ companyId, memberId })
  return { companyId, memberId }
})()
export const demoCompanyId = demo.companyId
export const demoMemberId = demo.memberId
sql`UPDATE assessment SET companyId = :companyId, assessmentCreatedBy = :memberId WHERE companyId IS NULL`
  .run(demo)
sql`UPDATE entryInternal SET companyId = (SELECT companyId FROM assessment WHERE assessment.assessmentId = entryInternal.assessmentId) WHERE companyId IS NULL AND assessmentId IS NOT NULL`
  .run()
sql`CREATE INDEX IF NOT EXISTS assessment_company ON assessment(companyId, assessmentId)`
  .run()
export const companyOfAssessment = (assessmentId: number) =>
  Assessment.require(assessmentId).companyId ?? demoCompanyId
