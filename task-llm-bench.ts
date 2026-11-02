// `deno task llm:bench`: every model on every AI task of Defendable, through
// the real code (prompts, validators, sandbox checks), on an in-memory
// database. Each flow runs with a single model (withModels: no fallback), and
// its result is scored against what is known to be right:
// - prefill: level and skills of the demo job description;
// - generation: the full 4-step job; reliable = ready AND approvable (the
//   starter fails every test, a solution written from the brief passes them);
// - preparation: analysis + 10 questions on the demo code; citations kept,
//   keys confirmed;
// - double-key: the QCM keys of the brief found again;
// - contradiction-check: a real contradiction confirmed, a sound claim not;
// - evaluation: the report finds the contradiction of Q7, and no other one;
// - assistant: an answer within its limits;
// - cv-extract: the fields of the fictional CVs (fixtures/cv/).
// Latency and tokens come from each call (llmConfig.onCall); the cost is the
// paid price of Gemini (NVIDIA endpoints: free credits of build.nvidia.com).
//
//   deno task llm:bench [--models=ultra,flash] [--only=prefill,cv] [--runs=2]
//   --merge: re-run some flows, keep the others; --add: more runs of them
//
// Writes docs/bench/llm-bench.json and prints the table of the README.
import { parseArgs } from 'jsr:@std/cli/parse-args'
import {
  type CallStat,
  type Endpoint,
  llmConfig,
  MODELS,
  retryDelay,
  withModels,
} from '/api/llm.ts'
import { prefillFromDescription } from '/api/assessment.ts'
import { createAssessment, toState } from '/api/assessment.ts'
import { checkByDoubleKey, prepareQuestions } from '/api/analysis.ts'
import { buildReport, confirmContradictions } from '/api/report.ts'
import { askAssistant } from '/api/candidate.ts'
import { askCvFields, cvText } from '/api/cv.ts'
import {
  Assessment,
  Candidate,
  demoCompanyId,
  demoMemberId,
} from '/api/schema.ts'
import { computeChecks } from '/web/lib/assessment-checks.ts'
import { demoJobDescription, skillCatalog } from '/fixtures/demo.ts'
import { demoFiles } from '/fixtures/demo-files.ts'
import { demoQuestions } from '/fixtures/questions.ts'
import { demoReport } from '/fixtures/report.ts'
import { cvs } from '/fixtures/cv/cvs.ts'
import { seedDemoAssessment, seedFinishedCandidate } from '/fixtures/seed.ts'
import { randomToken } from '/api/assessment.ts'
import type { Progress, Report } from '/web/types.ts'

const args = parseArgs(Deno.args, {
  string: ['models', 'only', 'runs', 'out'],
  boolean: ['merge', 'add'],
})

/** the models under test (Lightning aside: its free endpoint times out) */
const CANDIDATES: Record<string, Endpoint> = {
  ultra: MODELS.ultra,
  super: MODELS.super,
  flash: MODELS.flash,
  'flash-lite': MODELS['flash-lite'],
  'lite-3.1': MODELS['lite-3.1'],
}

const models = (args.models?.split(',') ?? Object.keys(CANDIDATES))
  .filter((id) => CANDIDATES[id] && llmConfig.keys[CANDIDATES[id].provider])
const runs = Number(args.runs ?? 2)

// free endpoints: rate limits are part of the measure, but a 429 gets room
retryDelay.ms = 8000

/* ---------- measures ---------- */

type Run = {
  flow: string
  model: string
  ok: boolean
  score: number // 0 → 1, quality against the known answer
  ms: number // the whole flow
  note?: string
}
const results: Run[] = []
const calls: (CallStat & { id: string; group: string })[] = []
/** the flow being run (one at a time), to merge a partial run */
let group = ''

/** a JSON column, as stored (a string) or already read */
const read = <T>(value: unknown) =>
  (typeof value === 'string' ? JSON.parse(value) : value) as T

/** the model id of the current flow, for the call statistics */
let current = new Map<string, string>() // label → id
llmConfig.onCall = (stat) =>
  calls.push({ ...stat, id: current.get(stat.model) ?? stat.model, group })
current = new Map(Object.entries(CANDIDATES).map(([id, e]) => [e.label, id]))

const measure = async (
  flow: string,
  id: string,
  fn: () => Promise<{ score: number; note?: string }>,
) => {
  const started = performance.now()
  try {
    const { score, note } = await withModels([CANDIDATES[id]], fn)
    results.push({
      flow,
      model: id,
      ok: score > 0,
      score,
      ms: Math.round(performance.now() - started),
      note,
    })
  } catch (err) {
    results.push({
      flow,
      model: id,
      ok: false,
      score: 0,
      ms: Math.round(performance.now() - started),
      note: (err instanceof Error ? err.message : String(err)).slice(0, 160),
    })
  }
  const last = results.at(-1)!
  console.log(
    `${last.ok ? '✅' : '❌'} ${flow} · ${id} · ${
      (last.ms / 1000).toFixed(1)
    } s · score ${last.score.toFixed(2)}${last.note ? ` · ${last.note}` : ''}`,
  )
}

/* ---------- flows ---------- */

const fold = (t: string) =>
  t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
const bare = (u: string) =>
  fold(u).replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '')

const flows: Record<string, (id: string) => Promise<void>> = {
  prefill: (id) =>
    measure('prefill', id, async () => {
      const data = await prefillFromDescription(demoJobDescription)
      const known = data.skills.filter((s) =>
        (skillCatalog as readonly string[]).includes(s)
      )
      return {
        score: (data.level === 'intermediate' ? 0.5 : 0) +
          0.5 * known.length / Math.max(3, data.skills.length),
        note:
          `${data.level}, ${known.length}/${data.skills.length} du catalogue`,
      }
    }),

  cv: async (id) => {
    for (const cv of cvs) {
      const bytes = await Deno.readFile(`fixtures/cv/${cv.file}`)
      const scanned = cv.file.includes('scan')
      if (scanned && CANDIDATES[id].provider !== 'gemini') continue
      await measure(scanned ? 'cv-scan' : 'cv', id, async () => {
        const { text } = await cvText(bytes)
        const { data } = await askCvFields(
          scanned ? { document: bytes } : { text },
        )
        const e = cv.expected
        const right = [
          fold(data.firstName ?? '') === fold(e.firstName),
          fold(data.lastName ?? '') === fold(e.lastName),
          (data.email ?? '') === e.email,
          bare(data.profileUrl ?? '') === bare(e.profileUrl),
          !!data.headline &&
          (fold(data.headline).includes(fold(e.headline)) ||
            fold(e.headline).includes(fold(data.headline))),
        ]
        const wrong = ['prénom', 'nom', 'e-mail', 'profil', 'intitulé']
          .filter((_, i) => !right[i])
        return {
          score: right.filter(Boolean).length / right.length,
          note: `${cv.file}${
            wrong.length ? ` · faux : ${wrong.join(', ')}` : ''
          }`,
        }
      })
    }
  },

  'double-key': (id) =>
    measure('double-key', id, async () => {
      const questions = structuredClone(demoQuestions).map((q) =>
        q.type === 'qcm'
          ? { ...q, check: undefined, keyDisputed: undefined }
          : q
      )
      const qcm = questions.filter((q) => q.type === 'qcm')
      await checkByDoubleKey(demoFiles, questions, 'autre modèle')
      const agreed = qcm.filter((q) => !q.keyDisputed).length
      return {
        score: agreed / qcm.length,
        note: `${agreed}/${qcm.length} clés`,
      }
    }),

  'contradiction-check': (id) =>
    measure('contradiction-check', id, async () => {
      const q7 = demoReport.free.find((f) => f.n === 7)!
      const q8 = demoReport.free.find((f) => f.n === 8)!
      const text = (f: typeof q7) => f.answer.map((p) => p.text).join('')
      const { confirmed, unavailable } = await confirmContradictions(
        demoFiles,
        [{
          id: '7-0',
          answer: text(q7),
          quote:
            'Je valide déjà que l’URL est en http ou https dans isValidUrl',
          claim: 'isValidUrl vérifie que le schéma est http ou https',
          why: 'isValidUrl accepte toute URL que new URL() analyse',
        }, {
          id: '8-0',
          answer: text(q8),
          quote: 'persist() fait un await',
          claim:
            'persist() fait un await entre la vérification de l’alias et l’enregistrement',
          why: 'le premier relecteur pense que persist est synchrone',
        }],
        'autre modèle',
      )
      if (unavailable) {
        throw Error(
          unavailable.map((f) => `${f.model} : ${f.reason}`).join(' ; '),
        )
      }
      const right = [confirmed.has('7-0'), !confirmed.has('8-0')]
      return {
        score: right.filter(Boolean).length / 2,
        note: `vraie ${right[0] ? 'confirmée' : 'manquée'}, fausse ${
          right[1] ? 'écartée' : 'retenue'
        }`,
      }
    }),

  evaluation: (id) =>
    measure('evaluation', id, async () => {
      const assessmentId = seedDemoAssessment(randomToken(10))
      const candidateId = seedFinishedCandidate(assessmentId, randomToken(24))
      await buildReport(candidateId)
      const stored = read<{
        status: string
        report?: Report
        error?: string
      }>(Candidate.require(candidateId).candidateReport)
      if (stored.status !== 'ready') throw Error(stored.error ?? 'échec')
      const found = stored.report!.free.filter((f) => f.contradiction)
        .map((f) => f.n)
      const q7 = found.includes(7)
      const others = found.filter((n) => n !== 7).length
      return {
        score: (q7 ? 0.5 : 0) + 0.5 * (1 - others / 3),
        note: `contradictions : ${found.join(', ') || 'aucune'}`,
      }
    }),

  assistant: (id) =>
    measure('assistant', id, async () => {
      const assessmentId = seedDemoAssessment(randomToken(10))
      const now = Date.now()
      const candidateId = Candidate.insert({
        candidateToken: randomToken(24),
        candidatePseudonym: 'Candidat BENCH',
        assessmentId,
        candidateCreatedAt: now,
        candidateStartedAt: now - 80 * 60_000,
        candidateSubmittedAt: now - 5 * 60_000,
        candidateFiles: demoFiles,
        candidateQuestions: demoQuestions,
        candidateQuestionsStartedAt: now - 60_000,
        candidateAnswers: {
          7: { openedAt: now - 30_000, assistant: [], assistantTraces: [] },
        },
      })
      const { reply: text } = await askAssistant(
        Candidate.require(candidateId),
        {
          n: 7,
          message: 'Quels schémas d’URL sont dangereux dans une redirection ?',
        },
      )
      return {
        score: text.length > 40 ? 1 : 0,
        note: `${text.length} caractères`,
      }
    }),

  preparation: (id) =>
    measure('preparation', id, async () => {
      const assessmentId = seedDemoAssessment(randomToken(10))
      const now = Date.now()
      const candidateId = Candidate.insert({
        candidateToken: randomToken(24),
        candidatePseudonym: 'Candidat BENCH',
        assessmentId,
        candidateCreatedAt: now,
        candidateStartedAt: now - 72 * 60_000,
        candidateSubmittedAt: now,
        candidateFiles: demoFiles,
        candidateRuns: { run: 14, mine: 3, eval: 5 },
      })
      const progress: Progress = {
        steps: Array.from({ length: 4 }, () => ({ state: 'wait' as const })),
      }
      progress.steps[0] = { state: 'done' }
      await prepareQuestions(candidateId, progress)
      if (progress.error) throw Error(progress.error)
      const c = Candidate.require(candidateId)
      const analysis = read<{
        observations: unknown[]
        discarded?: unknown[]
      }>(c.candidateAnalysis)
      const questions = read<typeof demoQuestions>(c.candidateQuestions)
      const kept = analysis.observations.length
      const dropped = analysis.discarded?.length ?? 0
      const qcm = questions.filter((q) => q.type === 'qcm')
      const disputed = qcm.filter((q) => q.keyDisputed).length
      return {
        score: 0.5 + 0.25 * kept / Math.max(1, kept + dropped) +
          0.25 * (1 - disputed / Math.max(1, qcm.length)),
        note: `${questions.length} questions, observations ${kept}/${
          kept + dropped
        }, clés contestées ${disputed}/${qcm.length}`,
      }
    }),

  generation: (id) =>
    measure('generation', id, async () => {
      const { id: assessmentId } = createAssessment(
        {
          jobDescription: demoJobDescription,
          level: 'intermediate',
          durationMin: 90,
          skills: skillCatalog.slice(0, 5),
          domain: 'Liens marketing',
          language: 'fr',
        },
        undefined,
        { companyId: demoCompanyId, memberId: demoMemberId },
      )
      const deadline = Date.now() + 25 * 60_000
      while (
        Assessment.require(assessmentId).assessmentStatus === 'generating'
      ) {
        if (Date.now() > deadline) throw Error('plus de 25 min')
        await new Promise((r) => setTimeout(r, 2000))
      }
      const state = toState(Assessment.require(assessmentId))
      if (state.status === 'failed') {
        throw Error(state.generation?.error ?? 'génération échouée')
      }
      const { blocked, checks } = computeChecks(
        state.spec,
        new Set(state.deletedTests),
        state.starterFails,
        state.reference,
      )
      const excluded = state.reference?.excluded.length ?? 0
      return {
        score: blocked ? 0.5 : 1 - Math.min(0.2, excluded * 0.05),
        note: `${state.spec.tests.length} tests, ${excluded} écarté(s)${
          blocked
            ? ` · bloquée : ${
              checks.filter((c) => !c.ok).map((c) => c.label).join(' ; ')
            }`
            : ''
        }`,
      }
    }),
}

const only = args.only?.split(',') ?? Object.keys(flows)

/** quick flows: every model in parallel; generation: one model at a time */
for (const flow of only.filter((f) => f !== 'generation')) {
  if (!flows[flow]) continue
  console.log(`\n— ${flow}`)
  group = flow
  await Promise.all(models.map(async (id) => {
    for (let i = 0; i < runs; i++) await flows[flow](id)
  }))
}
if (only.includes('generation')) {
  console.log('\n— generation')
  group = 'generation'
  for (let i = 0; i < runs; i++) {
    for (const id of models) await flows.generation(id)
  }
}

/* ---------- summary ---------- */

const out = args.out ?? 'docs/bench/llm-bench.json'

// --merge: the flows not run now keep their results of the last run
if (args.merge || args.add) {
  const last = JSON.parse(await Deno.readTextFile(out)) as {
    results: Run[]
    calls: typeof calls
  }
  const ran = new Set(only)
  // --add keeps the old runs of the flows run again: more samples
  const keep = (flow: string) =>
    args.add || !ran.has(flow.replace(/-scan$/, ''))
  results.unshift(...last.results.filter((r) => keep(r.flow)))
  calls.unshift(...(last.calls ?? []).filter((c) => keep(c.group)))
}

const median = (values: number[]) => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

const cost = (id: string, tokensIn: number, tokensOut: number) => {
  const price = CANDIDATES[id].price
  return price
    ? (tokensIn * price.input + tokensOut * price.output) / 1_000_000
    : 0
}

type Row = {
  flow: string
  model: string
  label: string
  runs: number
  success: number
  score: number
  medianMs: number
  callsFailed: number
  tokensIn: number
  tokensOut: number
  costUsd: number
}

/** the AI tasks (routes) of each flow, for tokens and cost */
const TASKS: Record<string, string[]> = {
  prefill: ['prefill'],
  cv: ['cv-extract'],
  'cv-scan': ['cv-extract'],
  'double-key': ['double-key'],
  'contradiction-check': ['contradiction-check'],
  evaluation: ['evaluation', 'contradiction-check'],
  assistant: ['assistant'],
  preparation: ['analysis', 'questions', 'double-key'],
  generation: [
    'need-analysis',
    'scenario',
    'tests',
    'reference',
    'reference-crash',
    'reference-review',
    'reference-fix',
  ],
}

const rows: Row[] = []
for (const flow of [...new Set(results.map((r) => r.flow))]) {
  for (const id of Object.keys(CANDIDATES)) {
    const mine = results.filter((r) => r.flow === flow && r.model === id)
    if (!mine.length) continue
    const own = calls.filter((c) =>
      c.id === id && c.group === flow.replace(/-scan$/, '') &&
      TASKS[flow]?.includes(c.task)
    )
    const ok = own.filter((c) => c.ok)
    const tokensIn = ok.reduce((s, c) => s + c.tokensIn, 0) / mine.length
    const tokensOut = ok.reduce((s, c) => s + c.tokensOut, 0) / mine.length
    rows.push({
      flow,
      model: id,
      label: CANDIDATES[id].label,
      runs: mine.length,
      success: mine.filter((r) => r.ok).length / mine.length,
      score: mine.reduce((s, r) => s + r.score, 0) / mine.length,
      medianMs: median(mine.filter((r) => r.ok).map((r) => r.ms)),
      callsFailed: own.filter((c) => !c.ok).length,
      tokensIn: Math.round(tokensIn),
      tokensOut: Math.round(tokensOut),
      costUsd: cost(id, tokensIn, tokensOut),
    })
  }
}

/**
 * The pick of a flow: the best score (within 0.05); among those, the ones
 * about as fast as the fastest (+20 %, or 1 s) are equal, and the cheapest of
 * them wins. A model that failed a run is never picked when another one
 * succeeded every time.
 */
const pick = (flow: string) => {
  const mine = rows.filter((r) => r.flow === flow)
  const reliable = mine.filter((r) => r.success === 1)
  const pool = reliable.length ? reliable : mine
  const best = Math.max(...pool.map((r) => r.score))
  const good = pool.filter((r) => r.score >= best - 0.05)
    .sort((a, b) => a.medianMs - b.medianMs)
  const fastest = good[0]?.medianMs ?? 0
  const quick = (r: Row) =>
    r.medianMs <= Math.max(fastest * 1.2, fastest + 1000)
  return [
    ...good.filter(quick).sort((a, b) =>
      a.costUsd - b.costUsd || a.medianMs - b.medianMs
    ),
    ...good.filter((r) => !quick(r)),
  ]
}

await Deno.mkdir(out.replace(/\/[^/]+$/, ''), { recursive: true })
await Deno.writeTextFile(
  out,
  JSON.stringify(
    {
      at: new Date().toISOString(),
      runs,
      models: Object.fromEntries(
        Object.keys(CANDIDATES).map((id) => [id, {
          model: CANDIDATES[id].model,
          label: CANDIDATES[id].label,
          price: CANDIDATES[id].price ?? null,
        }]),
      ),
      rows,
      results,
      calls,
      picks: Object.fromEntries(
        [...new Set(rows.map((r) => r.flow))].map((f) => [
          f,
          pick(f).map((r) => r.model),
        ]),
      ),
    },
    null,
    2,
  ),
)

const usd = (n: number) =>
  n === 0
    ? '0'
    : n < 0.001
    ? '< 0,001 $'
    : `${n.toFixed(3).replace('.', ',')} $`
console.log(
  '\n| Tâche | Modèle | Réussite | Qualité | Durée médiane | Coût payant / exécution |',
)
console.log('| --- | --- | --- | --- | --- | --- |')
for (const r of rows) {
  const top = pick(r.flow)[0]?.model === r.model
  console.log(
    `| ${r.flow} | ${top ? '**' : ''}${r.label}${top ? '**' : ''} | ${
      Math.round(r.success * r.runs)
    }/${r.runs} | ${r.score.toFixed(2).replace('.', ',')} | ${
      (r.medianMs / 1000).toFixed(1).replace('.', ',')
    } s | ${usd(r.costUsd)} |`,
  )
}
console.log(`\n→ ${out}`)
Deno.exit(0)
