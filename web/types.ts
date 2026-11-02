// Domain types shared by the API, the fixtures and the web app.

export type Level = 'junior' | 'intermediate' | 'senior'
export type Importance = 'haute' | 'moyenne' | 'basse'
export type Method = 'Tests' | 'Analyse du code' | 'Questions'
export type Visibility = 'public' | 'caché'
export type HttpMethod = 'GET' | 'POST' | 'DELETE'

export type Skill = {
  name: string
  importance: Importance
  methods: Method[]
  justification?: string
}

export type Requirement = {
  id: string // R1…
  title: string
  statement: string
  why: string
  skills: string[]
}

export type ApiRoute = {
  method: HttpMethod
  path: string
  description: string
  codes: number[]
}

export type TestStep = { request: string; response: string }

export type TestCase = {
  id: string // T1…
  title: string // short title, e.g. "Alias déjà utilisé"
  route: string // "POST /links"
  condition: string // readable, no JSON: "deux fois avec l’alias “promo”"
  expected: string
  visibility: Visibility
  requirementIds: string[]
  steps: TestStep[]
}

export type AssessmentSpec = {
  title: string
  company: string
  format: string
  durationMin: number
  level: Level
  jobDescription: string
  context: string
  mission: string
  /** shorter wording shown to the candidate (C2 "Énoncé") */
  candidateBrief: { context: string; mission: string }
  constraints: string[]
  routes: ApiRoute[]
  requirements: Requirement[]
  skills: Skill[]
  tests: TestCase[]
}

/** A model call that failed (retried, or replaced by another model) */
export type AiFailure = {
  model: string // label: "Nemotron 3 Super"
  reason: string // readable: "service surchargé (503)"
  detail?: string // technical message, for the curious
  ms: number // time lost on this attempt
}

export type AiTrace = {
  model: string
  where: string
  latencyMs: number
  tokensIn: number
  tokensOut: number
  at: string // ISO date
  replay?: boolean // served from the replay cache
  /** attempts that failed before this answer, in order */
  failures?: AiFailure[]
}

export type TestResult = {
  id: string
  passed: boolean
  durationMs: number
  expected?: string
  received?: string
  request?: string
}

export type CandidateResults = {
  publicTests: TestResult[]
  hiddenTests: TestResult[]
  ownTests: { passed: number; total: number; runs: number }
  typeErrors: number
  buildMinutes: number
  questionsMinutes: number
}

export type CandidateFiles = Record<string, string>

/* ---------- API state (T6) ---------- */

export type AssessmentStatus = 'generating' | 'failed' | 'draft' | 'approved'

/** long operations run by the API (R3 generation, C4 preparation) */
export type ProgressState = 'wait' | 'run' | 'done' | 'error'
export type Progress = {
  kind?: 'generation' | 'regeneration'
  /** R4 "Régénérer avec une consigne" */
  instruction?: string
  steps: {
    state: ProgressState
    trace?: AiTrace
    /** main model down, the fallback model is tried (brief §2.13) */
    fallback?: boolean
    /** why the main model failed: "Nemotron 3 Super : service surchargé (503)" */
    fallbackReason?: string
  }[]
  error?: string
  /** every failed attempt of the step that failed, for « Pourquoi ? » */
  failures?: AiFailure[]
  /** C4: hidden tests passed, shown as "Terminé · 2/3 réussis" */
  hiddenPassed?: number
}

export type GenerationInput = {
  jobDescription: string
  level: Level
  durationMin: number
  skills: string[]
  domain?: string
  language: 'fr' | 'en'
}

export type CheckResult = { label: string; ok: boolean }

export type CandidateStatus =
  | 'Invité'
  | 'Construction en cours'
  | 'Questions en cours'
  | 'Terminé'
  | 'Lien expiré'
  | 'Révoqué'

/** entered by the recruiter (U4), never sent to the models */
export type CandidateIdentity = {
  firstName: string
  lastName: string
  email: string
  profileUrl?: string
  note?: string
  /** 'cv': prefilled from a CV (U5), validated by the recruiter */
  source?: 'manual' | 'cv'
}

export type CandidateSummary = {
  id: number
  pseudonym: string
  /** absent for candidates of the former shared link */
  identity?: CandidateIdentity
  /** token of the personal link */
  invitation?: string
  status: CandidateStatus
  buildMinutes?: number
  questionsMinutes?: number
  date: string // ISO
  /** the personal link was e-mailed (ISO), or why the last sending failed */
  emailSentAt?: string
  emailError?: string
}

/* ---------- candidate journey (C1 → C7) ---------- */

export type IntegrityKind = 'page-leave' | 'paste-blocked' | 'fullscreen-exit'

export type IntegrityEvent = {
  type: IntegrityKind
  question: number
  at: string // ISO
  durationSec?: number
}

export type AssistantMessage = { role: 'user' | 'bot'; text: string }

export type Answer = {
  choice?: number | 'idk' // QCM
  text?: string // free answer
  assistant?: AssistantMessage[]
  auto?: boolean // sent by the timer at 00:00
  seconds: number // time spent
}

/** what C1 shows before the candidate starts */
/** what the personal link allows: start, resume, or nothing any more */
export type InvitationState =
  | 'invited'
  | 'started'
  | 'finished'
  | 'expired'
  | 'revoked'

export type Invitation = {
  invitation: string
  title: string
  company: string
  format: string
  durationMin: number
  firstName?: string
  state: InvitationState
}

/** the candidate's own session: never the hidden tests nor answer keys */
export type CandidateView = {
  id: number
  pseudonym: string
  demo: boolean
  /** server clock, to align the timers */
  now: number
  assessment: {
    title: string
    company: string
    format: string
    durationMin: number
    candidateBrief: { context: string; mission: string }
    requirements: { id: string; title: string; statement: string }[]
    routes: ApiRoute[]
    constraints: string[]
    publicTests: TestCase[]
    hiddenCount: number
  }
  startedAt?: number
  submittedAt?: number
  autoSubmitted?: boolean
  declaredTools: string[]
  otherTool?: string
  files: CandidateFiles
  savedAt?: number
  preparation?: Progress
  questionsStartedAt?: number
  finishedAt?: number
  answeredCount: number
}

export type ReferenceCheck = {
  code: string // src/app.ts
  results: {
    id: string
    passed: boolean
    received?: string
    reason?: string // of the fairness judge, when failed
    /** judge's verdict: "solution" = the test is fair, the solution wrong */
    fault?: 'test' | 'solution'
  }[]
  /** tests the brief does not justify: deleted before the review */
  excluded: { id: string; reason: string }[]
  traces: AiTrace[]
}

export type AssessmentState = {
  id: number
  spec: AssessmentSpec
  status: AssessmentStatus
  input: GenerationInput
  createdAt: string // ISO
  approvedAt?: string
  trace: AiTrace
  generation?: Progress
  /** sandbox check "Le code de départ échoue à tous les tests" */
  starterFails?: boolean
  /** fairness check: a solution written from the candidate brief only */
  reference?: ReferenceCheck
  deletedTests: string[]
  invitation?: string // token of the candidate link, once approved
  candidates: CandidateSummary[]
}

/* ---------- report (R6) ---------- */

export type Confidence = 'faible' | 'moyenne' | 'élevée'
export type DimensionStatusValue =
  | 'Démontré'
  | 'Partiel'
  | 'Non démontré'
  | 'Non évalué'

export type ReportDimension = {
  name: string
  status: DimensionStatusValue
  confidence: Confidence
  proofs: number
  methods: Method[]
  note?: string
  section: string // anchor of the proofs, e.g. "s2"
}

export type Citation = {
  file: string
  lines: [number, number]
  verified: boolean
  reason?: string // why a citation could not be verified
}

export type CodeObservation = {
  kind: 'Décision' | 'Risque' | 'Point positif'
  title: string
  confidence: Confidence
  citation: Citation
  explanation: string
  link?: { label: string; section: string }
}

export type QcmReview = {
  n: number
  kind: string
  prompt: string
  chosen: string
  correct: string
  isCorrect: boolean
  /**
   * how the expected answer was checked; "disputed": the second model found
   * another key, the question is not counted (shown « clé contestée »)
   */
  check: 'execution' | 'double-key' | 'disputed'
  aiNote?: string
  /** requests of a prediction question, shown on the card */
  requests?: [HttpMethod, string, string][]
  /** answered after the time: recorded unanswered */
  expired?: boolean
}

export type SignalState = 'present' | 'partial' | 'absent'

export type FreeReview = {
  n: number
  kind: string
  prompt: string
  // answer split in passages; `fromAssistant` ones are highlighted in violet
  answer: { text: string; fromAssistant?: boolean }[]
  /** sent after the time: the answer was not recorded */
  expired?: boolean
  overlapPercent: number
  assistant: { role: 'user' | 'bot'; text: string }[]
  ownContribution: string[]
  signals: { label: string; state: SignalState }[]
  contradiction?: {
    text: string
    citation: Citation
    test?: { id: string; expected: string; received: string }
    /**
     * the second model could not check it (why): shown as unconfirmed,
     * never counted as a contradiction
     */
    unconfirmed?: string
  }
}

export type TraceRow = {
  step: string
  model: string
  where: string
  latency: string
  tokens: string
  /** failed attempts before the answer: "Super : service surchargé (503)" */
  failures?: string[]
}

export type Report = {
  candidate: string
  date: string
  buildMinutes: number
  buildLimitMinutes: number
  questionsMinutes: number
  declaredTools: string[]
  synthesisTrace: AiTrace
  dimensions: ReportDimension[]
  interviewPoints: string[]
  observations: CodeObservation[]
  discarded: { text: string; citation: Citation }[]
  qcm: QcmReview[]
  free: FreeReview[]
  integrity: {
    icon: 'page-leave' | 'paste' | 'fullscreen' | 'assistant'
    text: string
  }[]
  debrief: { question: string; goodAnswer: string }[]
  limits: string[]
  trace: TraceRow[]
}
