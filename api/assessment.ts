import { contentLang, tc, withContentLang } from '/api/lib/content-lang.ts'
import { demoOf } from '/fixtures/demos.ts'
import { companyOfAssessment } from '/api/schema.ts'
// Recruiter side (R1 → R5): generation of an assessment by the model, review,
// regeneration, approval. Long steps run in the background; their progress is
// stored on the row and announced with ASSESSMENT_GENERATION_STEP entries,
// which GET/api/events forwards to the page (tournament's SSE pattern).
import { APP_ENV } from '/api/lib/env.ts'
import { respond } from '@01edu/api/response'
import {
  Assessment,
  type AssessmentRow,
  Candidate,
  type CandidateRow,
  demoCompanyId,
  demoMemberId,
  Entry,
} from '/api/schema.ts'
import { AiError, aiErrorText, ask, type AskOptions } from '/api/llm.ts'
import { log } from '/api/lib/log.ts'
import { runEvaluation } from '/api/sandbox.ts'
import { checkReference } from '/api/reference.ts'
import { normalizeSteps, parseStep } from '/api/test-steps.ts'
import { arr, num, obj, oneOf, optStr, str, strItem } from '/api/lib/check.ts'
import { computeChecks } from '/web/lib/assessment-checks.ts'
import { demoTraces, skillCatalog } from '/fixtures/demo.ts'
import type {
  AiTrace,
  ApiRoute,
  AssessmentSpec,
  AssessmentState,
  CandidateFiles,
  CandidateStatus,
  CandidateSummary,
  GenerationInput,
  Level,
  Method,
  Progress,
  ReferenceCheck,
  Requirement,
  Skill,
  TestCase,
} from '/web/types.ts'

export const json = <T>(value: unknown): T | undefined =>
  value == null
    ? undefined
    : typeof value === 'string'
    ? JSON.parse(value) as T
    : value as T

const iso = (ms?: number | null) => ms ? new Date(ms).toISOString() : undefined

/* ---------- read ---------- */

const INVITATION_MS = 14 * 24 * 3600_000 // as api/candidate.ts (spec D9)

const candidateStatus = (c: CandidateRow): CandidateStatus =>
  c.candidateFinishedAt
    ? 'Terminé'
    : c.candidateRevokedAt
    ? 'Révoqué'
    : c.candidateQuestionsStartedAt
    ? 'Questions en cours'
    : c.candidateStartedAt
    ? 'Construction en cours'
    : Date.now() - (c.candidateInvitedAt ?? c.candidateCreatedAt ?? 0) >
        INVITATION_MS
    ? 'Lien expiré'
    : 'Invité'

const minutes = (from?: number | null, to?: number | null) =>
  from && to ? Math.max(1, Math.round((to - from) / 60_000)) : undefined

export const toCandidateSummary = (c: CandidateRow): CandidateSummary => ({
  id: c.candidateId,
  pseudonym: c.candidatePseudonym,
  identity: c.candidateEmail
    ? {
      firstName: c.candidateFirstName ?? '',
      lastName: c.candidateLastName ?? '',
      email: c.candidateEmail,
      profileUrl: c.candidateProfileUrl ?? undefined,
      note: c.candidateNote ?? undefined,
      source: c.candidateIdentitySource === 'cv' ? 'cv' : 'manual',
    }
    : undefined,
  invitation: c.candidateInvitation ?? undefined,
  status: candidateStatus(c),
  buildMinutes: minutes(c.candidateStartedAt, c.candidateSubmittedAt),
  questionsMinutes: minutes(
    c.candidateQuestionsStartedAt,
    c.candidateFinishedAt,
  ),
  date: iso(
    c.candidateFinishedAt ?? c.candidateStartedAt ?? c.candidateCreatedAt,
  ) ?? new Date().toISOString(),
  emailSentAt: iso(c.candidateEmailSentAt),
  emailError: c.candidateEmailError ?? undefined,
})

const candidatesOf = Candidate.sql`
  SELECT * FROM candidate
  WHERE assessmentId = :assessmentId
  ORDER BY candidateId DESC
`.all

type StoredChecks = { starterFails: boolean; reference?: ReferenceCheck }

const EMPTY_TRACE: AiTrace = {
  model: '',
  where: '',
  latencyMs: 0,
  tokensIn: 0,
  tokensOut: 0,
  at: new Date(0).toISOString(),
}

export const toState = (row: AssessmentRow): AssessmentState => {
  const spec = json<AssessmentSpec>(row.assessmentSpec) ?? {
    ...demoOf(row.assessmentLanguage).assessment,
    title: row.assessmentTitle,
    tests: [],
    requirements: [],
    routes: [],
    skills: [],
  }
  return {
    id: row.assessmentId,
    spec,
    status: (row.assessmentStatus as AssessmentState['status']) ?? 'draft',
    input: {
      jobDescription: row.assessmentJobDescription,
      level: row.assessmentLevel as Level,
      durationMin: row.assessmentDuration,
      skills: json<string[]>(row.assessmentSkills) ?? [],
      domain: row.assessmentDomain ?? undefined,
      language: row.assessmentLanguage as 'fr' | 'en',
    },
    createdAt: iso(row.assessmentCreatedAt) ?? new Date().toISOString(),
    approvedAt: iso(row.assessmentApprovedAt),
    trace: json<AiTrace>(row.assessmentTrace) ?? EMPTY_TRACE,
    generation: json<Progress>(row.assessmentGeneration),
    starterFails: json<StoredChecks>(row.assessmentChecks)?.starterFails,
    reference: json<StoredChecks>(row.assessmentChecks)?.reference,
    deletedTests: json<string[]>(row.assessmentDeletedTests) ?? [],
    invitation: row.assessmentInvitation ?? undefined,
    candidates: candidatesOf({ assessmentId: row.assessmentId }).map(
      toCandidateSummary,
    ),
  }
}

const allAssessments = Assessment.sql`
  SELECT * FROM assessment ORDER BY assessmentId DESC
`.all

export const listAssessments = () => allAssessments().map(toState)

const companyAssessments = Assessment.sql<keyof AssessmentRow, number>`
  SELECT * FROM assessment WHERE companyId = ? ORDER BY assessmentId DESC
`.all
export const listCompanyAssessments = (companyId: number) =>
  companyAssessments(companyId).map(toState)

export const getAssessment = (id: number) => toState(Assessment.require(id))

const requireDraft = (id: number) => {
  const row = Assessment.require(id)
  if (row.assessmentStatus === 'approved') {
    throw new respond.ConflictError({
      message: 'L’épreuve est approuvée : elle ne peut plus être modifiée.',
    })
  }
  if (row.assessmentStatus === 'generating') {
    throw new respond.ConflictError({
      message: 'Une génération est en cours.',
    })
  }
  return row
}

/* ---------- model answers ---------- */

const LEVELS = ['junior', 'intermediate', 'senior'] as const
const IMPORTANCE = ['haute', 'moyenne', 'basse'] as const
const METHODS = ['Tests', 'Analyse du code', 'Questions'] as const
const HTTP = ['GET', 'POST', 'DELETE'] as const

const parseSkill = (v: unknown, p: string): Skill => {
  const o = obj(v, p)
  return {
    name: str(o.name, `${p}.name`, 80),
    importance: oneOf(o.importance, IMPORTANCE, `${p}.importance`),
    methods: arr(
      o.methods,
      `${p}.methods`,
      (m, mp) => oneOf(m, METHODS, mp) as Method,
      { min: 1, max: 3 },
    ),
    justification: optStr(o.justification, `${p}.justification`, 300),
  }
}

const parseRoute = (v: unknown, p: string): ApiRoute => {
  const o = obj(v, p)
  // "/rooms/{id}" → "/rooms/:id", without query string
  const path = str(o.path, `${p}.path`, 80).split('?')[0]
    .replace(/\{(\w+)\}/g, ':$1')
  if (!path.startsWith('/')) throw Error(`${p}.path doit commencer par /`)
  return {
    method: oneOf(o.method, HTTP, `${p}.method`),
    path,
    description: str(o.description, `${p}.description`, 120),
    codes: arr(o.codes, `${p}.codes`, (c, cp) => {
      const code = num(c, cp)
      if (code < 100 || code > 599) throw Error(`${cp} n’est pas un code HTTP`)
      return code
    }, { min: 1, max: 6 }),
  }
}

const parseRequirement = (v: unknown, p: string): Requirement => {
  const o = obj(v, p)
  const id = str(o.id, `${p}.id`, 5)
  if (!/^R\d+$/.test(id)) throw Error(`${p}.id doit être de la forme R1`)
  return {
    id,
    title: str(o.title, `${p}.title`, 100),
    statement: str(o.statement, `${p}.statement`, 400),
    why: str(o.why, `${p}.why`, 300),
    skills: arr(o.skills, `${p}.skills`, strItem, { max: 4, clip: true }),
  }
}

const parseTest = (v: unknown, p: string): TestCase => {
  const o = obj(v, p)
  const id = str(o.id, `${p}.id`, 5)
  if (!/^T\d+$/.test(id)) throw Error(`${p}.id doit être de la forme T1`)
  const steps = arr(o.steps, `${p}.steps`, (s, sp) => {
    const step = obj(s, sp)
    const parsed = {
      request: str(step.request, `${sp}.request`, 300),
      response: str(step.response, `${sp}.response`, 300),
    }
    try {
      parseStep(parsed)
    } catch (err) {
      throw Error(`${sp} : ${(err as Error).message}`)
    }
    return parsed
  }, { min: 1, max: 6 })
  return {
    id,
    title: str(o.title, `${p}.title`, 80),
    route: str(o.route, `${p}.route`, 80),
    condition: str(o.condition, `${p}.condition`, 120),
    expected: str(o.expected, `${p}.expected`, 60),
    visibility: oneOf(
      o.visibility,
      ['public', 'caché'] as const,
      `${p}.visibility`,
    ),
    requirementIds: arr(o.requirementIds, `${p}.requirementIds`, strItem, {
      min: 1,
      max: 4,
    }),
    // generated ids and error wordings belong to the candidate's code
    steps: normalizeSteps(steps),
  }
}

type NeedAnalysis = { level: Level; skills: Skill[]; domain?: string }

const parseNeedAnalysis = (v: unknown): NeedAnalysis => {
  const o = obj(v, 'réponse')
  return {
    level: oneOf(o.level, LEVELS, 'level'),
    skills: arr(o.skills, 'skills', parseSkill, { min: 1, max: 5 }),
    domain: optStr(o.domain, 'domain', 60),
  }
}

type Scenario = Pick<
  AssessmentSpec,
  | 'title'
  | 'company'
  | 'context'
  | 'mission'
  | 'candidateBrief'
  | 'constraints'
  | 'routes'
  | 'requirements'
>

const parseScenario = (v: unknown): Scenario => {
  const o = obj(v, 'réponse')
  const brief = obj(o.candidateBrief, 'candidateBrief')
  return {
    title: str(o.title, 'title', 80),
    company: str(o.company, 'company', 40),
    context: str(o.context, 'context', 600),
    mission: str(o.mission, 'mission', 600),
    candidateBrief: {
      context: str(brief.context, 'candidateBrief.context', 600),
      mission: str(brief.mission, 'candidateBrief.mission', 600),
    },
    constraints: arr(o.constraints, 'constraints', strItem, {
      min: 1,
      max: 12,
      clip: true,
    }),
    routes: arr(o.routes, 'routes', parseRoute, { min: 1, max: 8, clip: true }),
    requirements: arr(o.requirements, 'requirements', parseRequirement, {
      min: 2,
      max: 10,
      clip: true,
    }),
  }
}

const parseTests = (v: unknown): TestCase[] => {
  const o = obj(v, 'réponse')
  const tests = arr(o.tests, 'tests', parseTest, {
    min: 4,
    max: 16,
    clip: true,
  })
  if (!tests.some((t) => t.visibility === 'caché')) {
    throw Error('au moins un test doit être caché')
  }
  return tests
}

/* ---------- prompts ---------- */

const SYSTEM =
  'Tu conçois des épreuves techniques pour recruter des développeurs à l’ère de l’IA : le candidat code librement avec une IA, puis doit défendre son code. Réponds uniquement avec un objet JSON valide, sans texte autour, en français (vouvoiement), sans nom de personne réel.'

const inputText = (input: GenerationInput) =>
  [
    `Description du poste :\n${input.jobDescription}`,
    `Niveau : ${input.level}`,
    `Durée : ${input.durationMin} min`,
    `Compétences choisies par le recruteur : ${input.skills.join(', ')}`,
    input.domain && `Domaine métier : ${input.domain}`,
    'Format imposé : API HTTP en TypeScript (Deno), stockage en mémoire, pas de base de données ni de réseau.',
  ].filter(Boolean).join('\n')

const needAnalysisPrompt = (input: GenerationInput) =>
  `${inputText(input)}

Analyse le besoin. Pour chaque compétence choisie (5 au plus), indique son importance et comment l’évaluer dans une API Deno sans base de données (une ou plusieurs méthodes) :
- "Tests" si des tests HTTP d’évaluation peuvent la vérifier (comportement de l’API) ; ces tests sont séquentiels et instantanés : la concurrence, les délais et l’expiration relèvent de l’analyse du code et des questions ;
- "Analyse du code" si elle se voit dans le code rendu (structure, lisibilité, tests écrits par le candidat : « Tests automatisés » relève de l’analyse du code, pas des tests HTTP) ;
- "Questions" si la vérifier demande d’interroger le candidat sur son code (choix, compréhension), ou si l’environnement ne permet pas de l’observer (ex. une base de données absente).
JSON attendu :
{"level":"junior|intermediate|senior","domain":"…","skills":[{"name":"…","importance":"haute|moyenne|basse","methods":["Tests"],"justification":"une phrase"}]}`

const scenarioPrompt = (
  input: GenerationInput,
  analysis: NeedAnalysis,
  instruction?: string,
) =>
  `${inputText(input)}
Compétences analysées : ${JSON.stringify(analysis.skills)}
${instruction ? `Consigne du recruteur : ${instruction}\n` : ''}
Rédige le scénario d’une petite API HTTP réaliste (entreprise fictive), faisable en ${input.durationMin} min avec l’aide d’une IA : 3 à 5 routes, 4 à 7 exigences.
- routes : méthodes GET, POST ou DELETE ; chemins avec paramètres ":nom" (jamais "{nom}") ; codes de statut attendus.
- Format imposé : src/app.ts exporte handler(req: Request): Promise<Response>, appelé directement par les tests d’évaluation ; pas de serveur ni de réseau (les tests du candidat appellent aussi handler, jamais fetch).
- Toute donnée de référence que les tests supposent (salles, produits, utilisateurs…) est donnée dans les contraintes avec ses identifiants exacts, ex. « Salles existantes : room-1, room-2 ».
- Les messages d’erreur ne sont pas imposés mot pour mot : seul le code de statut et un champ "error" le sont.
- requirements : chacune décrit un comportement de l’API vérifiable par un test HTTP (jamais la qualité du code ni les tests écrits par le candidat : ils relèvent de l’analyse du code) ; id "R1"…, un énoncé vérifiable qui donne le code de statut de chaque cas (succès et erreurs, ex. « 409 si l’alias existe déjà »), "why" explique ce que l’exigence évalue, "skills" les compétences concernées.
- Formats sans ambiguïté : si une valeur a un format (date, URL, identifiant), la contrainte le précise et dit ce qui est refusé.
- Fidélité à l’offre : le métier du scénario est celui de l’offre et chaque tâche qu’elle cite (ex. « vérifie les créneaux qui se chevauchent ») devient au moins une exigence testable.
- candidateBrief : version courte du contexte et de la mission pour le candidat ; la mission dit concrètement ce que le code doit faire (routes, règles métier), jamais « implémentez les routes manquantes ».
JSON attendu :
{"title":"…","company":"…","context":"…","mission":"Votre mission : …","candidateBrief":{"context":"…","mission":"…"},"constraints":["…"],"routes":[{"method":"POST","path":"/links","description":"…","codes":[201,400]}],"requirements":[{"id":"R1","title":"…","statement":"…","why":"…","skills":["…"]}]}`

const testsPrompt = (scenario: Scenario, instruction?: string) =>
  `Scénario : ${
    JSON.stringify({
      routes: scenario.routes,
      requirements: scenario.requirements,
      constraints: scenario.constraints,
    })
  }
${instruction ? `Consigne du recruteur : ${instruction}\n` : ''}
Écris 8 à 12 tests d’évaluation HTTP. Chaque exigence est couverte par au moins un test ; 2 ou 3 tests sont cachés ("caché") et portent sur des exigences visibles. Chaque test part d’un état vide (seules les données de référence des contraintes existent).
Le candidat ne lit que les exigences, les routes et les contraintes : un test n’attend que ce qu’elles disent explicitement (code de statut écrit dans l’exigence, format écrit dans les contraintes). Pas de cas limite ambigu (ex. une date sans fuseau, que le format ISO 8601 accepte). Les requêtes d’un test s’enchaînent en quelques millisecondes : aucun test ne dépend du temps qui passe (expiration, délai) ni de requêtes simultanées ; ces règles relèvent de l’analyse du code et des questions.
Règles d’équité : chemins et identifiants en ASCII, sans accents ni espaces (ex. "salle-a"). Ne fige jamais une valeur choisie par le code du candidat. Un identifiant renvoyé s’écrit "$id" dans la réponse (il est capturé) et se réutilise dans les requêtes suivantes (ex. "DELETE /reservations/$id"). Ne vérifie pas le texte exact d’un message d’erreur : le code de statut suffit, ou "error : chaîne non vide".
Format strict des étapes :
- request : "MÉTHODE /chemin" suivi éventuellement d’un corps JSON sur une ligne, et de " (×2)" pour répéter. Ex. : "POST /links {\\"url\\":\\"https://a.com\\"}"
- response : le code attendu, suivi éventuellement de " · " et d’un sous-ensemble JSON du corps (objet, ou tableau dont chaque élément doit être présent), d’un en-tête "Nom: valeur", ou de "champ : chaîne non vide". Ex. : "200 · {\\"clicks\\":2}", "302 · Location: https://a.com".
"condition" décrit le cas en quelques mots lisibles, sans JSON (ex. « deux fois le même alias ») ; "expected" résume l’attendu en quelques caractères (ex. « 409 », « 200 + liste vide »).
JSON attendu :
{"tests":[{"id":"T1","title":"titre court","route":"POST /links","condition":"avec une URL valide","expected":"201 + id","visibility":"public","requirementIds":["R1"],"steps":[{"request":"…","response":"…"}]}]}`

/* ---------- starter code (C2) ---------- */

/** Code given to the candidate: every route answers 501, so every test fails */
export const starterFiles = (spec: AssessmentSpec): CandidateFiles => {
  const [first] = spec.routes
  const routes = spec.routes
    .map((r) => `//   ${r.method} ${r.path} : ${r.description}`)
    .join('\n')
  return {
    'src/app.ts':
      `// Point d’entrée : les tests d’évaluation appellent handler() directement.
// Routes attendues :
${routes}

export async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  return Response.json(
    { error: \`\${req.method} \${url.pathname} n’est pas encore implémenté\` },
    { status: 501 },
  );
}
`,
    'src/app_test.ts': `import { assertEquals } from "@std/assert";
import { handler } from "./app.ts";

Deno.test("exemple : l’API répond", async () => {
  const res = await handler(new Request("http://localhost/"));
  assertEquals(typeof res.status, "number");
});
`,
    'playground.ts': `import { handler } from "./src/app.ts";

const res = await handler(new Request("http://localhost${
      first?.path.replace(/:\w+/g, 'exemple') ?? '/'
    }", {
  method: "${first?.method ?? 'GET'}",
}));

console.log(res.status, await res.text());
`,
    'deno.json': `{
  "tasks": {
    "test": "deno test src/"
  },
  "imports": {
    "@std/assert": "jsr:@std/assert@1"
  }
}`,
    'README.md': `# ${spec.company} — ${spec.title}

## Tests
deno task test

## Choix
- `,
  }
}

/* ---------- generation job ---------- */

const GENERATION_STEPS = 4

const saveProgress = (id: number, progress: Progress) => {
  Assessment.update({ assessmentId: id, assessmentGeneration: progress })
  Entry.insert.ASSESSMENT_GENERATION_STEP({
    companyId: companyOfAssessment(id),
    assessmentId: id,
    data: { steps: progress.steps.map((s) => s.state) },
  })
}

// replayed answers come back in 0.1 s: keep the stepper readable (R3)
const pace = (trace: AiTrace) =>
  trace.replay && APP_ENV !== 'test'
    ? new Promise((r) => setTimeout(r, 900))
    : Promise.resolve()

type Simulation = 'repli' | 'echec' | undefined

const runStep = async <T>(
  id: number,
  progress: Progress,
  index: number,
  options: AskOptions<T>,
  simulate?: Simulation,
) => {
  progress.steps[index] = { state: 'run' }
  saveProgress(id, progress)
  // ?etat=repli|echec of the prototype replay the error states for real
  if (index === 1 && simulate) {
    await new Promise((r) => setTimeout(r, 1200))
    if (simulate === 'echec') throw Error('Le modèle n’a pas répondu.')
    progress.steps[index] = { state: 'run', fallback: true }
    saveProgress(id, progress)
    await new Promise((r) => setTimeout(r, 1500))
  }
  const result = await ask({
    ...options,
    onFallback: (reason) => {
      progress.steps[index] = {
        state: 'run',
        fallback: true,
        fallbackReason: reason,
      }
      saveProgress(id, progress)
    },
  })
  await pace(result.trace)
  progress.steps[index] = { state: 'done', trace: result.trace }
  saveProgress(id, progress)
  return result
}

type Draft = { spec: AssessmentSpec; reference?: ReferenceCheck }

/** requirements no (kept) test checks: the approval would be blocked */
const uncoveredOf = (d: Draft) =>
  computeChecks(
    d.spec,
    new Set(d.reference?.excluded.map((e) => e.id)),
    true,
  ).uncovered

/**
 * What blocks a draft: tests excluded by, or still failed by, the reference
 * solution, and requirements no test covers
 */
const problemsOf = (d: Draft) => {
  const reference = d.reference
  const unfair = reference
    ? reference.excluded.length +
      reference.results.filter((r) =>
        !r.passed && !reference.excluded.some((e) => e.id === r.id)
      ).length
    : 0
  return unfair + uncoveredOf(d).length
}

const repairInstruction = (d: Draft) => {
  const { spec, reference } = d
  const failing = (reference?.results ?? []).filter((r) => !r.passed).map(
    (r) => {
      const test = spec.tests.find((t) => t.id === r.id)
      const why = reference!.excluded.find((e) => e.id === r.id)?.reason ??
        r.reason ?? ''
      return `- ${r.id} « ${test?.title} » (reçu ${r.received ?? '?'}) ${why}`
    },
  )
  const uncovered = uncoveredOf(d).map((id) => {
    const r = spec.requirements.find((x) => x.id === id)
    return `- ${id} « ${r?.title} » : aucun test HTTP ne la vérifie`
  })
  return [
    failing.length &&
    `Une solution écrite depuis le seul énoncé du candidat échoue à ces tests :\n${
      failing.join('\n')
    }\nRends l’énoncé (exigences, contraintes, exemples) et les tests cohérents entre eux et sans ambiguïté.`,
    uncovered.length &&
    `Ces exigences ne sont couvertes par aucun test :\n${
      uncovered.join('\n')
    }\nChaque exigence décrit un comportement de l’API vérifiable par un test HTTP : remplace-la par un tel comportement ou retire-la (la qualité du code et des tests du candidat relève de l’analyse du code, pas d’une exigence).`,
  ].filter(Boolean).join('\n')
}

/** the generation job, in the language chosen for the assessment */
const generate = (
  id: number,
  input: GenerationInput,
  options: { instruction?: string; simulate?: Simulation },
) => withContentLang(input.language, () => runGeneration(id, input, options))

const runGeneration = async (
  id: number,
  input: GenerationInput,
  { instruction, simulate }: { instruction?: string; simulate?: Simulation },
) => {
  const progress: Progress = {
    kind: instruction ? 'regeneration' : 'generation',
    instruction,
    steps: Array.from({ length: GENERATION_STEPS }, () => ({ state: 'wait' })),
  }
  const previous = json<AssessmentSpec>(Assessment.require(id).assessmentSpec)
  try {
    // 1. need analysis (kept from the first generation on a regeneration)
    const analysis = await runStep(id, progress, 0, {
      task: instruction ? 'instruction' : 'need-analysis',
      tier: 'precise',
      patient: true,
      system: SYSTEM,
      prompt: instruction
        ? `Consigne : ${instruction}\n${needAnalysisPrompt(input)}`
        : needAnalysisPrompt(input),
      parse: parseNeedAnalysis,
      demo: () => ({
        level: input.level,
        skills: demoOf(contentLang()).assessment.skills,
        domain: input.domain,
      }),
      demoTrace: demoTraces.needAnalysis,
    })
    const draft = async (consigne?: string) => {
      // 2. scenario and requirements
      const scenario = await runStep(id, progress, 1, {
        task: 'scenario',
        timeoutMs: 150_000,
        tier: 'precise',
        // background job: wait for an overloaded endpoint, then Super
        patient: true,
        system: SYSTEM,
        prompt: scenarioPrompt(input, analysis.data, consigne),
        parse: parseScenario,
        maxTokens: 6000,
        // the demo of the language of the assessment (fixtures/demos.ts)
        demo: () => demoOf(contentLang()).assessment,
        demoTrace: demoTraces.generation,
      }, simulate)
      // 3. tests
      const tests = await runStep(id, progress, 2, {
        task: 'tests',
        timeoutMs: 150_000,
        tier: 'precise',
        patient: true,
        system: SYSTEM,
        prompt: testsPrompt(scenario.data, consigne),
        parse: parseTests,
        maxTokens: 8000,
        demo: () => demoOf(contentLang()).assessment.tests,
        demoTrace: demoTraces.testsGeneration,
      })
      // 4. automatic checks: the starter code must fail every test, a
      // solution written from the candidate brief only must pass them
      progress.steps[3] = { state: 'run' }
      saveProgress(id, progress)
      const spec: AssessmentSpec = {
        ...(previous ?? demoOf(contentLang()).assessment),
        ...scenario.data,
        format: tc(
          'API HTTP en TypeScript (Deno)',
          'HTTP API in TypeScript (Deno)',
        ),
        durationMin: input.durationMin,
        level: analysis.data.level,
        jobDescription: input.jobDescription,
        skills: analysis.data.skills,
        tests: tests.data,
      }
      const starter = starterFiles(spec)
      const results = await runEvaluation(starter, spec.tests)
      const starterFails = results.every((r) => !r.passed)
      // without an answer (no key, no recording), the review shows it
      const reference = await checkReference(spec, starter).catch((err) => {
        log.warn('reference-check-failed', { message: String(err) })
        return undefined
      })
      return { spec, trace: scenario.trace, starter, starterFails, reference }
    }
    let best = await draft(instruction)
    // a draft the checks would block (unfair or failed tests, uncovered
    // requirements) is rewritten once from its problems; the better one wins
    if (problemsOf(best)) {
      const repaired = await draft(
        [instruction, repairInstruction(best)].filter(Boolean).join('\n'),
      ).catch((err) => {
        log.warn('generation-repair-failed', { message: String(err) })
        return undefined
      })
      if (repaired && problemsOf(repaired) < problemsOf(best)) best = repaired
    }
    const { spec, starter, starterFails, reference } = best
    const scenario = { trace: best.trace }
    progress.steps[3] = {
      state: 'done',
      ...(reference && { trace: reference.traces.at(-1) }),
    }
    Assessment.update({
      assessmentId: id,
      assessmentStatus: 'draft',
      assessmentTitle: spec.title,
      assessmentLevel: spec.level,
      assessmentSpec: spec,
      assessmentTrace: scenario.trace,
      assessmentChecks: { starterFails, reference },
      assessmentStarterFiles: starter,
      assessmentDeletedTests: reference?.excluded.map((e) => e.id) ?? [],
    })
    saveProgress(id, progress)
  } catch (err) {
    const running = progress.steps.findIndex((s) => s.state === 'run')
    if (running >= 0) progress.steps[running] = { state: 'error' }
    log.warn('generation-failed', { id, message: String(err) })
    progress.error = aiErrorText(err)
    progress.failures = err instanceof AiError ? err.failures : undefined
    // a failed regeneration keeps the previous draft
    Assessment.update({
      assessmentId: id,
      assessmentStatus: previous ? 'draft' : 'failed',
    })
    saveProgress(id, progress)
  }
}

/** R2 "Générer l’épreuve" → R3: returns at once, the job runs in background */
export const createAssessment = (
  input: GenerationInput,
  simulate?: Simulation,
  owner?: { companyId: number; memberId: number },
) => {
  const assessmentId = Assessment.insert({
    companyId: owner?.companyId ?? demoCompanyId,
    assessmentCreatedBy: owner?.memberId ?? demoMemberId,
    assessmentTitle: 'Nouvelle épreuve',
    assessmentLevel: input.level,
    assessmentDuration: input.durationMin,
    assessmentLanguage: input.language,
    assessmentJobDescription: input.jobDescription,
    assessmentStatus: 'generating',
    assessmentSkills: input.skills,
    assessmentDomain: input.domain,
    assessmentCreatedAt: Date.now(),
  })
  Entry.insert.ASSESSMENT_CREATED({
    companyId: companyOfAssessment(assessmentId),
    assessmentId,
  })
  generate(assessmentId, input, { simulate })
  return { id: assessmentId }
}

/** R3 "Réessayer" after a failure */
export const retryGeneration = (id: number) => {
  const row = Assessment.require(id)
  if (row.assessmentStatus !== 'failed') {
    throw new respond.ConflictError({ message: 'Rien à réessayer.' })
  }
  Assessment.update({ assessmentId: id, assessmentStatus: 'generating' })
  generate(id, toState(row).input, {})
}

/** R4 "Régénérer avec une consigne" */
export const regenerateAssessment = (id: number, instruction: string) => {
  const row = requireDraft(id)
  Assessment.update({ assessmentId: id, assessmentStatus: 'generating' })
  generate(id, toState(row).input, {
    instruction: instruction.trim() || 'Rendre l’épreuve un peu plus difficile',
  })
}

/* ---------- R2 prefill (T6.4) ---------- */

export const prefillFromDescription = async (jobDescription: string) => {
  const { data, trace } = await ask({
    task: 'prefill',
    tier: 'super',
    system: SYSTEM,
    prompt:
      `Description du poste :\n${jobDescription}\n\nDéduis le niveau et 5 compétences au plus, en priorité parmi : ${
        skillCatalog.join(', ')
      }.\nJSON attendu : {"level":"junior|intermediate|senior","skills":["…"]}`,
    parse: (v) => {
      const o = obj(v, 'réponse')
      return {
        level: oneOf(o.level, LEVELS, 'level'),
        skills: arr(o.skills, 'skills', (s, p) => str(s, p, 60), {
          min: 1,
          max: 5,
        }),
      }
    },
    demo: () => ({
      level: 'intermediate' as const,
      skills: skillCatalog.slice(0, 5),
    }),
    demoTrace: demoTraces.prefill,
  })
  return { ...data, trace }
}

/* ---------- R4 edits ---------- */

/** R4 inline edits: the title, and the brief as the candidate reads it (C2) */
export const updateAssessment = (
  id: number,
  { title, context, mission }: {
    title?: string | null
    context?: string | null
    mission?: string | null
  },
) => {
  const row = requireDraft(id)
  const spec = json<AssessmentSpec>(row.assessmentSpec)!
  const next: AssessmentSpec = {
    ...spec,
    ...(title?.trim() && { title: title.trim() }),
    candidateBrief: {
      context: context?.trim() || spec.candidateBrief.context,
      mission: mission?.trim() || spec.candidateBrief.mission,
    },
  }
  Assessment.update({
    assessmentId: id,
    assessmentTitle: next.title,
    assessmentSpec: next,
  })
  Entry.insert.ASSESSMENT_UPDATED({
    companyId: companyOfAssessment(id),
    assessmentId: id,
    data: { title: spec.title, brief: spec.candidateBrief },
  })
}

export const setDeletedTests = (id: number, testIds: string[]) => {
  const row = requireDraft(id)
  const known = new Set(
    json<AssessmentSpec>(row.assessmentSpec)!.tests.map((t) => t.id),
  )
  Assessment.update({
    assessmentId: id,
    assessmentDeletedTests: testIds.filter((t) => known.has(t)),
  })
}

const INVITATION_CHARS =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
export const randomToken = (length: number) =>
  Array.from(
    crypto.getRandomValues(new Uint8Array(length)),
    (n) => INVITATION_CHARS[n % INVITATION_CHARS.length],
  ).join('')

/** R4 → R5: the assessment is frozen, deleted tests are dropped */
export const approveAssessment = (id: number) => {
  const row = requireDraft(id)
  const state = toState(row)
  const deleted = new Set(state.deletedTests)
  const { blocked } = computeChecks(
    state.spec,
    deleted,
    state.starterFails,
    state.reference,
  )
  if (blocked) {
    throw new respond.BadRequestError({
      message: 'Approbation impossible : un contrôle est en échec.',
    })
  }
  Assessment.update({
    assessmentId: id,
    assessmentStatus: 'approved',
    assessmentApprovedAt: Date.now(),
    assessmentSpec: {
      ...state.spec,
      tests: state.spec.tests.filter((t) => !deleted.has(t.id)),
    },
    assessmentDeletedTests: [],
    assessmentInvitation: randomToken(10),
  })
  Entry.insert.ASSESSMENT_APPROVED({
    companyId: companyOfAssessment(id),
    assessmentId: id,
  })
  return getAssessment(id)
}
