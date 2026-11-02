import { contentLang, tc, withContentLang } from '/api/lib/content-lang.ts'
import { demoOf } from '/fixtures/demos.ts'
import { companyOfAssessment } from '/api/schema.ts'
// R6 report, built when the candidate sends the last answer. Facts are
// computed here (QCM keys, overlap with the assistant, integrity events,
// traces); the model evaluates the free answers and writes the synthesis.
// Its citations are checked like the analysis ones; a skill evaluated only by
// questions cannot go above a medium confidence (brief R6). No global score.
import { APP_ENV } from '/api/lib/env.ts'
import { respond } from '@01edu/api/response'
import { Assessment, Candidate, type CandidateRow, Entry } from '/api/schema.ts'
import { json, toCandidateSummary } from '/api/assessment.ts'
import { questionsOf, type StoredAnswer } from '/api/candidate.ts'
import {
  type Analysis,
  parseProof,
  type Proof,
  PROOF_RULE,
  refuteProofs,
  verifyCitation,
} from '/api/analysis.ts'
import { AiError, aiErrorText, ask } from '/api/llm.ts'
import { log } from '/api/lib/log.ts'
import {
  arr,
  bool,
  num,
  obj,
  oneOf,
  oneOfLoose,
  optStr,
  str,
  strItem,
  validItems,
} from '/api/lib/check.ts'
import { formatInt, formatLatency } from '/web/lib/format.ts'
import { demoTraces } from '/fixtures/demo.ts'
import type {
  FreeQuestion,
  QcmQuestion,
  Question,
} from '/fixtures/questions.ts'
import type {
  AiFailure,
  AiTrace,
  AssessmentSpec,
  CandidateFiles,
  CandidateIdentity,
  CandidateResults,
  Confidence,
  DimensionStatusValue,
  FreeReview,
  IntegrityEvent,
  QcmReview,
  Report,
  ReportDimension,
  TestCase,
  TraceRow,
} from '/web/types.ts'

export type DecisionChoice = 'go' | 'no' | 'info'
export type Decision = { choice: DecisionChoice; note: string; at: string }

export type ReportView = {
  candidateId: number
  assessmentId: number
  assessmentTitle: string
  pseudonym: string
  /** shown to the company that invited the candidate (U4, D7: visible) */
  identity?: CandidateIdentity
  status: 'pending' | 'ready' | 'failed'
  error?: string
  /** why the report failed, attempt by attempt */
  failures?: AiFailure[]
  report?: Report
  results?: CandidateResults
  tests: TestCase[]
  files: CandidateFiles
  decision?: Decision
}

/* ---------- overlap with the assistant (facts) ---------- */

type Token = { word: string; start: number; end: number }

const tokens = (text: string): Token[] =>
  [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({
    word: m[0].toLowerCase().normalize('NFD').replace(/\p{M}/gu, ''),
    start: m.index!,
    end: m.index! + m[0].length,
  }))

const N = 4 // a passage copied from the assistant is 4 words or more

/**
 * Splits an answer into passages; those found word for word in the
 * assistant's replies are highlighted in violet in the report.
 */
export const splitByAssistant = (answer: string, replies: string[]) => {
  const words = tokens(answer)
  const grams = new Set<string>()
  for (const reply of replies) {
    const t = tokens(reply).map((x) => x.word)
    for (let i = 0; i + N <= t.length; i++) {
      grams.add(t.slice(i, i + N).join(' '))
    }
  }
  const copied = new Array(words.length).fill(false)
  for (let i = 0; i + N <= words.length; i++) {
    const gram = words.slice(i, i + N).map((x) => x.word).join(' ')
    if (grams.has(gram)) copied.fill(true, i, i + N)
  }
  const passages: FreeReview['answer'] = []
  let cursor = 0
  for (let i = 0; i < words.length;) {
    if (!copied[i]) {
      i++
      continue
    }
    let j = i
    while (j + 1 < words.length && copied[j + 1]) j++
    const start = words[i].start
    const end = words[j].end
    if (start > cursor) passages.push({ text: answer.slice(cursor, start) })
    passages.push({ text: answer.slice(start, end), fromAssistant: true })
    cursor = end
    i = j + 1
  }
  if (cursor < answer.length) passages.push({ text: answer.slice(cursor) })
  const percent = words.length
    ? Math.round(copied.filter(Boolean).length * 100 / words.length)
    : 0
  return { passages: passages.length ? passages : [{ text: answer }], percent }
}

/* ---------- integrity (facts) ---------- */

const integrityEvents = Entry.sql<'data', { candidateId: number }>`
  SELECT data FROM ${Entry.view.CANDIDATE_INTEGRITY_EVENT}
  WHERE candidateId = :candidateId
  ORDER BY createdAt
`.all

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`

// the texts of a report follow the language of its assessment (tc)

export const integrityLines = (
  events: Pick<IntegrityEvent, 'type' | 'question' | 'durationSec'>[],
  assistantUsed: number,
  freeCount: number,
): Report['integrity'] => {
  const of = (type: IntegrityEvent['type']) =>
    events.filter((e) => e.type === type)
  const questions = (list: typeof events) => {
    const numbers = [...new Set(list.map((e) => e.question))]
    return `${numbers.length > 1 ? 'questions' : 'question'} ${
      numbers.join(', ')
    }`
  }
  const leaves = of('page-leave')
  const pastes = of('paste-blocked')
  const exits = of('fullscreen-exit')
  const seconds = leaves.reduce((s, e) => s + (e.durationSec ?? 0), 0)
  return [
    {
      icon: 'page-leave',
      text: leaves.length
        ? tc(
          `${plural(leaves.length, 'sortie')} de page (${
            Math.round(seconds)
          } s, ${questions(leaves)})`,
          `${plural(leaves.length, 'page leave')} (${Math.round(seconds)} s, ${
            questions(leaves)
          })`,
        )
        : tc('Aucune sortie de page', 'No page leave'),
    },
    {
      icon: 'paste',
      text: pastes.length
        ? tc(
          `${plural(pastes.length, 'tentative')} de collage ${
            pastes.length > 1 ? 'bloquées' : 'bloquée'
          } (${questions(pastes)})`,
          `${plural(pastes.length, 'paste attempt')} blocked (${
            questions(pastes)
          })`,
        )
        : tc('Aucune tentative de collage', 'No paste attempt'),
    },
    {
      icon: 'fullscreen',
      text: exits.length
        ? tc(
          `${plural(exits.length, 'sortie')} du plein écran (${
            questions(exits)
          })`,
          `${plural(exits.length, 'full-screen exit')} (${questions(exits)})`,
        )
        : tc('Plein écran maintenu', 'Full screen kept'),
    },
    {
      icon: 'assistant',
      text: tc(
        `Assistant utilisé sur ${assistantUsed} ${
          assistantUsed > 1 ? 'questions libres' : 'question libre'
        } sur ${freeCount}`,
        `Assistant used on ${assistantUsed} of ${freeCount} open ${
          freeCount > 1 ? 'questions' : 'question'
        }`,
      ),
    },
  ]
}

/* ---------- traces (facts) ---------- */

const traceRow = (step: string, traces: AiTrace[]): TraceRow | undefined => {
  if (!traces.length) return undefined
  const [first] = traces
  return {
    step,
    // a step may have fallen back to the other model
    model: [...new Set(traces.map((t) => t.model))].join(' + '),
    where: first.replay ? tc('Cache de rejeu', 'Replay cache') : first.where,
    latency: traces.filter((t) => t.latencyMs).map((t) =>
      formatLatency(t.latencyMs)
    ).join(' · '),
    tokens: `${formatInt(traces.reduce((s, t) => s + t.tokensIn, 0))} / ${
      formatInt(traces.reduce((s, t) => s + t.tokensOut, 0))
    }`,
    failures: failureLines(traces),
  }
}

/** "Nemotron 3 Super : service surchargé (503) · 0,4 s", in order */
const failureLines = (traces: AiTrace[]) => {
  const lines = traces.flatMap((t) => t.failures ?? []).map((f) =>
    `${f.model} : ${f.reason} · ${formatLatency(f.ms)}`
  )
  return lines.length ? lines : undefined
}

const sumTraces = (traces: AiTrace[]): AiTrace[] =>
  traces.length
    ? [{
      ...traces[0],
      model: [...new Set(traces.map((t) => t.model))].join(' + '),
      latencyMs: traces.reduce((s, t) => s + t.latencyMs, 0),
      tokensIn: traces.reduce((s, t) => s + t.tokensIn, 0),
      tokensOut: traces.reduce((s, t) => s + t.tokensOut, 0),
      failures: traces.flatMap((t) => t.failures ?? []),
    }]
    : []

/* ---------- evaluation by the model ---------- */

const STATUS = ['Démontré', 'Partiel', 'Non démontré', 'Non évalué'] as const
const CONFIDENCE = ['faible', 'moyenne', 'élevée'] as const
const SIGNAL = ['present', 'partial', 'absent'] as const
export const UNDERSTANDING = 'Compréhension de son propre code'

type Claim = {
  claim: string
  verdict: 'exact' | 'faux'
  why: string
  file: string
  from: number
  to: number
  quote?: string
  /** the words of the answer that carry the claim, copied verbatim */
  answerQuote?: string
  testId?: string
  proof?: Proof
}

type Evaluation = {
  free: {
    n: number
    ownContribution: string[]
    signals: FreeReview['signals']
    /** what the answer states about the code, checked against it */
    claims: Claim[]
  }[]
  qcmNotes: { n: number; note: string }[]
  dimensions: {
    name: string
    status: DimensionStatusValue
    confidence: Confidence
    proofs: number
    note?: string
  }[]
  interviewPoints: string[]
  debrief: Report['debrief']
}

const parseEvaluation = (v: unknown): Evaluation => {
  const o = obj(v, 'réponse')
  return {
    free: arr(o.free, 'free', (x, p) => {
      const f = obj(x, p)
      return {
        n: num(f.n, `${p}.n`),
        ownContribution: validItems(
          f.ownContribution,
          `${p}.ownContribution`,
          strItem,
          4,
        ),
        signals: validItems(f.signals, `${p}.signals`, (s, sp) => {
          const so = obj(s, sp)
          return {
            label: str(so.label, `${sp}.label`, 120),
            state: oneOfLoose(so.state, SIGNAL, `${sp}.state`),
          }
        }, 4),
        claims: validItems(f.claims, `${p}.claims`, (x, cp): Claim => {
          const c = obj(x, cp)
          return {
            claim: str(c.claim, `${cp}.claim`, 200),
            verdict: oneOf(
              c.verdict,
              ['exact', 'faux'] as const,
              `${cp}.verdict`,
            ),
            why: str(c.why, `${cp}.why`, 200),
            file: str(c.file, `${cp}.file`, 80),
            from: num(c.from, `${cp}.from`),
            to: num(c.to, `${cp}.to`),
            quote: optStr(c.quote, `${cp}.quote`, 300),
            answerQuote: optStr(c.answerQuote, `${cp}.answerQuote`, 300),
            testId: optStr(c.testId, `${cp}.testId`, 5),
            proof: parseProof(c.proof, `${cp}.proof`),
          }
        }, 6),
      }
    }, { max: 4 }),
    qcmNotes: arr(o.qcmNotes ?? [], 'qcmNotes', (x, p) => {
      const q = obj(x, p)
      return { n: num(q.n, `${p}.n`), note: str(q.note, `${p}.note`, 300) }
    }, { max: 6 }),
    dimensions: arr(o.dimensions, 'dimensions', (x, p) => {
      const d = obj(x, p)
      return {
        name: str(d.name, `${p}.name`, 80),
        status: oneOfLoose(d.status, STATUS, `${p}.status`),
        confidence: oneOfLoose(
          d.confidence,
          CONFIDENCE,
          `${p}.confidence`,
          {
            haute: 'élevée',
            fort: 'élevée',
            forte: 'élevée',
            basse: 'faible',
            bas: 'faible',
          },
        ),
        proofs: num(d.proofs, `${p}.proofs`),
        note: optStr(d.note, `${p}.note`, 120),
      }
    }, { min: 1, max: 8 }),
    interviewPoints: arr(o.interviewPoints, 'interviewPoints', strItem, {
      min: 1,
      max: 4,
    }),
    debrief: arr(o.debrief, 'debrief', (x, p) => {
      const d = obj(x, p)
      return {
        question: str(d.question, `${p}.question`, 300),
        goodAnswer: str(d.goodAnswer, `${p}.goodAnswer`, 400),
      }
    }, { min: 1, max: 4 }),
  }
}

// the words of the brief's answers that carry its contradictions
const demoAnswerQuotes: Record<'fr' | 'en', Record<number, string>> = {
  fr: { 7: 'Je valide déjà que l’URL est en http ou https dans isValidUrl' },
  en: { 7: 'I already check that the URL is http or https in isValidUrl' },
}

/** the evaluation of the demo, in the language of the assessment */
const demoEvaluation = (): Evaluation => {
  const demoReport = demoOf(contentLang()).report
  return {
    free: demoReport.free.map((f) => ({
      n: f.n,
      ownContribution: f.ownContribution,
      signals: f.signals,
      claims: f.contradiction
        ? [{
          claim: f.contradiction.text,
          verdict: 'faux' as const,
          why: f.contradiction.text.replace(/^Contradiction ?: /, ''),
          answerQuote: demoAnswerQuotes[contentLang()][f.n],
          file: f.contradiction.citation.file,
          from: f.contradiction.citation.lines[0],
          to: f.contradiction.citation.lines[1],
          testId: f.contradiction.test?.id,
        }]
        : [],
    })),
    qcmNotes: demoReport.qcm.filter((q) => q.aiNote).map((q) => ({
      n: q.n,
      note: q.aiNote!,
    })),
    dimensions: demoReport.dimensions,
    interviewPoints: demoReport.interviewPoints,
    debrief: demoReport.debrief,
  }
}

const numbered = (files: CandidateFiles) =>
  Object.entries(files).filter(([p]) => p.endsWith('.ts')).map(([p, code]) =>
    `=== ${p}\n${
      code.split('\n').map((l, i) => `${String(i + 1).padStart(3)} | ${l}`)
        .join('\n')
    }`
  ).join('\n\n')

const EVALUATION_SYSTEM =
  'Tu aides un recruteur à lire les réponses d’un candidat sur son propre code. Tu sépares les faits de tes interprétations, tu ne donnes aucune note globale, tu ne recommandes aucune décision et tu ne devines pas si une réponse a été écrite par une IA. Tu parles du candidat à la troisième personne et tu le vouvoies dans les questions de débrief. Réponds uniquement en JSON, en français.'

const choiceLabel = (q: QcmQuestion, choice?: number | 'idk') =>
  choice === 'idk'
    ? 'Je ne sais pas'
    : choice === undefined
    ? 'Pas de réponse'
    : q.options[choice]?.label ?? 'Pas de réponse'

/** "Conception d'API REST" is "Conception d’API REST" */
const nameKey = (name: string) =>
  name.normalize('NFD').replace(/\p{M}/gu, '').replace(/[’'`]/g, "'")
    .replace(/\s+/g, ' ').trim().toLowerCase()
const sameName = (a: string, b: string) => nameKey(a) === nameKey(b)

const normalized = (text: string) =>
  text.toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[«»“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * A contradiction is only attributed to words the candidate wrote: the
 * quote must be found in the answer, long enough to carry a claim (LIVE-004).
 */
export const anchoredInAnswer = (answer: string, quote?: string) => {
  const q = normalized(quote ?? '').replace(/^["'\s]+|["'\s.,;:!?…]+$/g, '')
  return q.length >= 12 && normalized(answer).includes(q)
}

const contradictions = (free: FreeReview[]) => {
  // an unconfirmed contradiction is shown, never counted
  const n = free.filter((f) => f.contradiction && !f.contradiction.unconfirmed)
    .length
  return n > 1
    ? `${n} contradictions`
    : n
    ? tc('une contradiction', 'one contradiction')
    : ''
}

/** "5/6", or "4/5 (1 clé contestée, non comptée)" */
/**
 * The QCMs as the evaluator reads them: a disputed key decides nothing, for
 * the evaluator too (LIVE-007); a prediction checked by running its
 * requests is a fact
 */
export const qcmForEvaluator = (qcm: QcmReview[]) =>
  qcm.map(({ n, prompt, chosen, correct, isCorrect, check, requests }) => ({
    n,
    prompt,
    chosen,
    ...(check === 'disputed' ? { cleContestee: true } : { correct, isCorrect }),
    ...(check === 'execution' && {
      faitVerifieParExecution: `pour ${
        requests?.map((r) => r.slice(0, 2).join(' ')).join(' puis ')
      }, le code renvoie réellement « ${correct} »`,
    }),
  }))

export const qcmScore = (qcm: QcmReview[]) => {
  const counted = qcm.filter((q) => q.check !== 'disputed')
  const disputed = qcm.length - counted.length
  return `${counted.filter((q) => q.isCorrect).length}/${counted.length}${
    disputed
      ? ` (${disputed} ${
        disputed > 1
          ? tc('clés contestées, non comptées', 'disputed keys, not counted')
          : tc('clé contestée, non comptée', 'disputed key, not counted')
      })`
      : ''
  }`
}

/** measured facts, so the model never counts nor invents a number */
const factsText = (
  spec: AssessmentSpec,
  results: CandidateResults | undefined,
  qcm: QcmReview[],
) => {
  if (!results) return 'Aucun résultat de test.'
  const count = (list: { passed: boolean }[]) =>
    `${list.filter((r) => r.passed).length}/${list.length}`
  const failed = [...results.publicTests, ...results.hiddenTests]
    .filter((r) => !r.passed)
    .map((r) => {
      const t = spec.tests.find((x) => x.id === r.id)
      return `${r.id} « ${t?.title} » (attendu ${
        r.expected ?? t?.expected
      }, reçu ${r.received ?? '?'})`
    })
  return [
    `- Tests d’évaluation publics réussis : ${
      count(results.publicTests)
    } ; cachés : ${count(results.hiddenTests)}`,
    failed.length
      ? `- Tests échoués : ${failed.join(' ; ')}`
      : '- Aucun test d’évaluation échoué',
    `- Tests écrits par le candidat : ${results.ownTests.passed}/${results.ownTests.total} réussis, ${results.ownTests.runs} exécutions pendant l’épreuve`,
    `- Erreurs de type à la soumission : ${results.typeErrors}`,
    `- QCM justes : ${qcmScore(qcm)}`,
  ].join('\n')
}

/**
 * Double key of the contradictions (like the QCMs): another model reads the
 * code and the claim; a contradiction it does not confirm is not shown. If
 * that check fails, the first reading stands.
 */
export const confirmContradictions = async (
  files: CandidateFiles,
  claims: {
    id: string
    answer: string
    quote: string
    claim: string
    why: string
  }[],
  /** label of the model that found them: the second key is another one */
  evaluator?: string,
) => {
  if (!claims.length) {
    return { confirmed: new Set<string>(), unavailable: undefined }
  }
  try {
    const { data, trace } = await ask({
      task: 'contradiction-check',
      // a second key: another model than the evaluator, even as fallback
      tier: 'super',
      fallback: 'nano',
      avoid: evaluator,
      patient: true,
      timeoutMs: 120_000,
      // demo and replay without key: the contradictions of the brief stand
      demo: () => claims.map((c) => ({ id: c.id, confirmed: true })),
      system:
        'Tu vérifies, en relisant le code, si une affirmation d’un candidat sur son propre code est fausse. Réponds uniquement en JSON, en français.',
      prompt: `Code du candidat (numéros de ligne à gauche) :
${numbered(files)}

Affirmations jugées fausses par un premier relecteur : ${JSON.stringify(claims)}

Pour chacune, vérifie d’abord l’attribution : "quote" est l’extrait de la réponse ("answer") qui porterait l’affirmation ; si l’extrait, lu dans la réponse avec sa portée et ses négations, ne dit pas ce que l’affirmation lui prête (ou dit l’inverse), "confirmed": false. Sinon, "confirmed": true seulement si le fond de l’affirmation est faux (ce que fait ou renvoie le code) ; false si elle est exacte sur le fond, même mal formulée ou imprécise. "reason" : une phrase.
JSON attendu : {"verdicts":[{"id":"8-0","confirmed":true,"reason":"…"}]}`,
      parse: (v) =>
        arr(obj(v, 'réponse').verdicts, 'verdicts', (x, p) => {
          const o = obj(x, p)
          return {
            id: str(o.id, `${p}.id`, 20),
            confirmed: bool(o.confirmed, `${p}.confirmed`),
          }
        }),
    })
    for (const v of data.filter((v) => !v.confirmed)) {
      log.info('contradiction-not-confirmed', { id: v.id })
    }
    return {
      confirmed: new Set(data.filter((v) => v.confirmed).map((v) => v.id)),
      trace,
    }
  } catch (err) {
    // unavailable is not confirmed: the claims are shown as unconfirmed,
    // with the reasons, and never counted (AUD-004)
    log.warn('contradiction-check-failed', { message: String(err) })
    return {
      confirmed: new Set<string>(),
      unavailable: err instanceof AiError && err.failures.length
        ? err.failures
        : [{ model: 'Contre-vérification', reason: aiErrorText(err), ms: 0 }],
    }
  }
}

/* ---------- job ---------- */

const pace = (trace: AiTrace) =>
  trace.replay && APP_ENV !== 'test'
    ? new Promise((r) => setTimeout(r, 800))
    : Promise.resolve()

const LIMITS = () => [
  tc(
    'Les réponses sont écrites sans surveillance vidéo.',
    'The answers are written without video monitoring.',
  ),
  tc(
    'Une IA utilisée sur un autre appareil n’est pas détectable.',
    'An AI used on another device cannot be detected.',
  ),
  tc(
    'L’analyse porte sur un seul exercice.',
    'The analysis covers a single exercise.',
  ),
  tc(
    'Une compétence évaluée uniquement par des questions ne dépasse pas une confiance moyenne.',
    'A skill assessed by questions only does not go beyond medium confidence.',
  ),
]

const sectionOf = (methods: string[]) =>
  methods[0] === 'Tests' ? 's2' : methods[0] === 'Analyse du code' ? 's3' : 's4'

/** R6 job, in the language of the assessment */
export const buildReport = (candidateId: number) =>
  withContentLang(
    Assessment.require(Candidate.require(candidateId).assessmentId)
      .assessmentLanguage,
    () => writeReport(candidateId),
  )

const writeReport = async (candidateId: number) => {
  const c = Candidate.require(candidateId)
  const a = Assessment.require(c.assessmentId)
  const spec = json<AssessmentSpec>(a.assessmentSpec)!
  const files = json<CandidateFiles>(c.candidateFiles) ?? {}
  const results = json<CandidateResults>(c.candidateResults)
  const analysis = json<Analysis>(c.candidateAnalysis)
  const questions = questionsOf(c)
  const answers = json<Record<number, StoredAnswer>>(c.candidateAnswers) ?? {}
  try {
    const qcmQuestions = questions.filter((q): q is QcmQuestion =>
      q.type === 'qcm'
    )
    const freeQuestions = questions.filter((q): q is FreeQuestion =>
      q.type === 'free'
    )
    const qcm: QcmReview[] = qcmQuestions.map((q) => {
      const choice = answers[q.n]?.choice
      return {
        n: q.n,
        kind: `QCM · ${q.kind}`,
        prompt: q.prompt,
        chosen: answers[q.n]?.expired
          ? tc('Temps écoulé : pas de réponse', 'Time up: no answer')
          : choiceLabel(q, choice),
        ...(answers[q.n]?.expired && { expired: true }),
        correct: q.options[q.correct ?? 0].label,
        // a disputed key decides nothing: never counted right or wrong
        isCorrect: !q.keyDisputed && choice === q.correct,
        check: q.keyDisputed ? 'disputed' : q.check ?? 'double-key',
        requests: q.requests,
      }
    })
    const skillNames = [...spec.skills.map((sk) => sk.name), UNDERSTANDING]
    const { data: evaluation, trace } = await ask({
      task: 'evaluation',
      // a background job: a long answer (claims and proofs) is fine
      timeoutMs: 240_000,
      // the step that weighs the evidence: the most accurate model
      tier: 'precise',
      patient: true,
      system: EVALUATION_SYSTEM,
      prompt: `Compétences de l’épreuve (nom, méthodes) : ${
        JSON.stringify(spec.skills.map((sk) => [sk.name, sk.methods]))
      }
Exigences : ${JSON.stringify(spec.requirements.map((r) => [r.id, r.statement]))}
Contraintes de l’énoncé : ${JSON.stringify(spec.constraints)}
Faits mesurés (ne recompte rien, ne cite pas d’autres chiffres) :
${factsText(spec, results, qcm)}
Observations vérifiées sur le code : ${
        JSON.stringify(
          analysis?.observations.map((o) => [o.kind, o.title, o.citation]),
        )
      }
QCM : ${JSON.stringify(qcmForEvaluator(qcm))}
Réponses libres : ${
        JSON.stringify(
          freeQuestions.map((q) => ({
            n: q.n,
            question: q.prompt,
            extrait: q.code,
            attendu: q.example,
            reponse: answers[q.n]?.text ?? '',
            assistant: answers[q.n]?.assistant ?? [],
          })),
        )
      }

Code du candidat (numéros de ligne à gauche) :
${numbered(files)}

Pour chaque réponse libre ("free") :
- "ownContribution" : 1 à 3 idées que le candidat apporte lui-même, reformulées à la troisième personne (« Relie le rejet de 24:00 à… ») ; une idée présente dans les réponses de l’assistant n’est pas un apport ;
- "signals" : les 3 éléments qu’une bonne réponse contient (d’après "attendu" et le code), chacun "present" si la réponse le dit explicitement, "partial" si elle l’évoque sans l’établir, "absent" sinon ; une idée proposée à la place d’un élément attendu ne le rend pas présent ;
- "claims" : chaque affirmation factuelle de la réponse sur SON code (ce que fait une ligne, une fonction, une expression régulière, un test), vérifiée en relisant les lignes : "verdict" "exact" ou "faux", "why" en une phrase, les lignes exactes et un court extrait du code recopié tel quel ("quote"), et la phrase de la réponse qui porte l’affirmation, recopiée mot pour mot avec ses négations ("answerQuote"). N’attribue au candidat que ce qu’il écrit : une affirmation sans "answerQuote" exact est écartée. Une hypothèse posée par la question (« si on écrivait <= ») n’est pas une affirmation sur le code ; une réponse juste n’a aucune affirmation fausse ; « faux » seulement si le fond est faux (ce que fait ou renvoie le code), jamais pour une imprécision de formulation. ${PROOF_RULE} Pour une affirmation « faux » sur le comportement, "proof" donne ce que le code renvoie réellement selon toi ("status") et le code de statut qu’implique l’affirmation du candidat ("claimedStatus") : si l’exécution donne raison au candidat, la contradiction est écartée.
Les QCM marqués "faitVerifieParExecution" disent ce que le code renvoie réellement : ce fait l’emporte sur une observation ou un "attendu" contraires (une réponse conforme à ce fait n’est jamais fausse).
Pour chaque QCM faux ("qcmNotes") : une note courte sur l’écart entre la réponse et le code. Un QCM marqué "cleContestee" n’est ni juste ni faux (deux modèles ne s’accordent pas sur sa clé) : aucune note, et il ne compte pour aucune dimension.
"dimensions" : une par nom de cette liste, recopié à l’identique : ${
        JSON.stringify(skillNames)
      }. Statut d’après les preuves (faits, observations dont les risques, réponses) : « Démontré » seulement sans risque sérieux ni affirmation fausse sur cette compétence ; "note" en une phrase.
"interviewPoints" : 2 ou 3 points que le recruteur vérifiera en entretien (« Lui demander… »), en priorité les affirmations fausses et les risques du code que les tests ne couvrent pas.
"debrief" : 3 questions de débrief sur son code, avec ce qu’une bonne réponse contient, conforme aux exigences et aux contraintes.
JSON attendu : {"free":[{"n":7,"ownContribution":["…"],"signals":[{"label":"…","state":"present"}],"claims":[{"claim":"…","verdict":"exact|faux","why":"…","file":"src/…","from":8,"to":14,"quote":"…","answerQuote":"…","testId":"T9","proof":{"requests":["POST /links {…}"],"status":400,"claimedStatus":201}}]}],"qcmNotes":[{"n":1,"note":"…"}],"dimensions":[{"name":"…","status":"Démontré|Partiel|Non démontré|Non évalué","confidence":"faible|moyenne|élevée","proofs":3,"note":"…"}],"interviewPoints":["…"],"debrief":[{"question":"…","goodAnswer":"…"}]}`,
      parse: parseEvaluation,
      maxTokens: 8000,
      demo: demoEvaluation,
      demoTrace: demoTraces.analysis,
    })
    await pace(trace)

    const allResults = [
      ...(results?.publicTests ?? []),
      ...(results?.hiddenTests ?? []),
    ]
    // a contradiction the execution disproves (the candidate was right) is
    // not shown: the facts of the code win over the reading of the model
    const refuted = await refuteProofs(
      files,
      evaluation.free.flatMap((f) =>
        f.claims.flatMap((k, i) =>
          k.verdict === 'faux' && k.proof
            ? [{ id: `${f.n}-${i}`, proof: k.proof }]
            : []
        )
      ),
    )
    const { confirmed, trace: checkTrace, unavailable } =
      await confirmContradictions(
        files,
        evaluation.free.flatMap((f) =>
          f.claims.flatMap((k, i) =>
            k.verdict === 'faux' && !refuted.has(`${f.n}-${i}`) &&
              anchoredInAnswer(answers[f.n]?.text ?? '', k.answerQuote)
              ? [{
                id: `${f.n}-${i}`,
                answer: answers[f.n]?.text ?? '',
                quote: k.answerQuote!,
                claim: k.claim,
                why: k.why,
              }]
              : []
          )
        ),
        trace.model,
      )
    const free: FreeReview[] = freeQuestions.map((q) => {
      const answer = answers[q.n]
      const e = evaluation.free.find((f) => f.n === q.n)
      const replies = (answer?.assistant ?? []).filter((m) => m.role === 'bot')
        .map((m) => m.text)
      const { passages, percent } = splitByAssistant(
        answer?.text ?? '',
        replies,
      )
      let contradiction: FreeReview['contradiction']
      for (const [i, k] of (e?.claims ?? []).entries()) {
        if (k.verdict !== 'faux' || contradiction) continue
        if (refuted.has(`${q.n}-${i}`)) {
          log.info('contradiction-refuted', {
            n: q.n,
            claim: k.claim,
            status: refuted.get(`${q.n}-${i}`),
          })
          continue
        }
        // words the candidate did not write are never attributed (LIVE-004)
        if (!anchoredInAnswer(answer?.text ?? '', k.answerQuote)) {
          log.info('contradiction-unanchored', { n: q.n, claim: k.claim })
          continue
        }
        if (!confirmed.has(`${q.n}-${i}`) && !unavailable) continue
        const citation = verifyCitation(files, k.file, [k.from, k.to], k.quote)
        const failed = allResults.find((r) => r.id === k.testId && !r.passed)
        // an unverifiable contradiction is not shown to the recruiter
        if (citation.verified) {
          contradiction = {
            // the candidate's own words, not the model's paraphrase
            text: `Contradiction : « ${k.answerQuote} »${
              k.why ? ` — ${k.why}` : ''
            }`,
            citation,
            ...(unavailable && {
              unconfirmed: tc(
                `contre-vérification indisponible (${
                  unavailable.at(-1)!.reason
                })`,
                `second check unavailable (${unavailable.at(-1)!.reason})`,
              ),
            }),
            test: failed && {
              id: failed.id,
              expected: failed.expected ?? '',
              received: failed.received ?? '',
            },
          }
        }
      }
      return {
        n: q.n,
        kind: `Réponse libre · ${q.kind}`,
        prompt: q.prompt,
        answer: passages,
        ...(answer?.expired && { expired: true }),
        overlapPercent: percent,
        assistant: answer?.assistant ?? [],
        ownContribution: e?.ownContribution ?? [],
        signals: e?.signals ?? [],
        contradiction,
      }
    })
    for (const note of evaluation.qcmNotes) {
      const q = qcm.find((x) => x.n === note.n)
      // no note of fault on a disputed key (LIVE-007)
      if (q && !q.isCorrect && q.check !== 'disputed') q.aiNote = note.note
    }

    // skills of the assessment, in their order; methods are facts
    const dimensions: ReportDimension[] = [
      ...spec.skills.map((s) => ({ name: s.name, methods: s.methods })),
      { name: UNDERSTANDING, methods: ['Questions' as const] },
    ].map(({ name, methods }) => {
      const d = evaluation.dimensions.find((x) => sameName(x.name, name))
      const questionsOnly = methods.length === 1 && methods[0] === 'Questions'
      const confidence = !d
        ? 'faible'
        : questionsOnly && d.confidence === 'élevée'
        ? 'moyenne'
        : d.confidence

      return {
        name,
        status: d?.status ?? 'Non évalué',
        confidence,
        proofs: d?.proofs ?? 0,
        methods,
        note: name === UNDERSTANDING
          ? [
            `QCM ${qcmScore(qcm)}`,
            contradictions(free),
          ]
            .filter(Boolean).join(', ')
          : questionsOnly
          ? tc(
            'Évalué uniquement par des questions',
            'Assessed by questions only',
          )
          : d?.note,
        section: sectionOf(methods),
      }
    })

    const events = integrityEvents({ candidateId }).map((row) =>
      json<
        { kind: IntegrityEvent['type']; question: number; durationSec?: number }
      >(row.data)!
    ).map((e) => ({
      type: e.kind,
      question: e.question,
      durationSec: e.durationSec,
    }))
    const assistantTraces = freeQuestions.flatMap((q) =>
      answers[q.n]?.assistantTraces ?? []
    )
    const assistantUsed = freeQuestions.filter((q) =>
      answers[q.n]?.assistant.length
    ).length
    const generationTrace = json<AiTrace>(a.assessmentTrace)

    const report: Report = {
      candidate: c.candidatePseudonym,
      date: new Date(c.candidateFinishedAt ?? Date.now()).toISOString(),
      buildMinutes: Math.round(
        ((c.candidateSubmittedAt ?? 0) - (c.candidateStartedAt ?? 0)) / 60_000,
      ),
      buildLimitMinutes: a.assessmentDuration,
      questionsMinutes: Math.max(
        1,
        Math.round(
          ((c.candidateFinishedAt ?? 0) -
            (c.candidateQuestionsStartedAt ?? 0)) / 60_000,
        ),
      ),
      declaredTools: json<string[]>(c.candidateTools) ?? [],
      synthesisTrace: trace,
      dimensions,
      interviewPoints: evaluation.interviewPoints,
      observations: analysis?.observations ?? [],
      discarded: analysis?.discarded ?? [],
      qcm,
      free,
      integrity: integrityLines(events, assistantUsed, freeQuestions.length),
      debrief: evaluation.debrief,
      limits: LIMITS(),
      trace: [
        generationTrace &&
        traceRow(
          tc('Génération de l’épreuve', 'Generation of the assessment'),
          [generationTrace],
        ),
        analysis &&
        traceRow(
          tc('Analyse du code et questions', 'Code analysis and questions'),
          sumTraces(
            [analysis.trace, analysis.questionsTrace].filter(
              Boolean,
            ) as AiTrace[],
          ),
        ),
        traceRow(
          `Assistant (${assistantTraces.length} ${
            assistantTraces.length > 1
              ? tc('échanges', 'exchanges')
              : tc('échange', 'exchange')
          })`,
          assistantTraces,
        ),
        traceRow(
          tc('Évaluation des réponses', 'Evaluation of the answers'),
          [
            trace,
            checkTrace,
            // the failed double key of the contradictions, kept visible
            unavailable &&
            {
              ...trace,
              tokensIn: 0,
              tokensOut: 0,
              latencyMs: 0,
              failures: unavailable,
            },
          ].filter((t): t is AiTrace => !!t),
        ),
      ].filter((r): r is TraceRow => !!r),
    }
    Candidate.update({
      candidateId,
      candidateReport: { status: 'ready', report },
    })
  } catch (err) {
    Candidate.update({
      candidateId,
      candidateReport: {
        status: 'failed',
        error: aiErrorText(err),
        failures: err instanceof AiError ? err.failures : undefined,
      },
    })
  }
  Entry.insert.CANDIDATE_REPORT_READY({
    companyId: companyOfAssessment(c.assessmentId),
    assessmentId: c.assessmentId,
    candidateId,
  })
}

/* ---------- read, decision ---------- */

type StoredReport = {
  status: 'ready' | 'failed'
  report?: Report
  error?: string
  failures?: AiFailure[]
}

export const getReport = (candidateId: number): ReportView => {
  const c = Candidate.require(candidateId)
  const spec = json<AssessmentSpec>(
    Assessment.require(c.assessmentId).assessmentSpec,
  )!
  const stored = json<StoredReport>(c.candidateReport)
  return {
    candidateId,
    assessmentId: c.assessmentId,
    assessmentTitle: spec.title,
    pseudonym: c.candidatePseudonym,
    identity: toCandidateSummary(c).identity,
    status: stored?.status ?? 'pending',
    error: stored?.error,
    failures: stored?.failures,
    report: stored?.report,
    results: json<CandidateResults>(c.candidateResults),
    tests: spec.tests,
    files: json<CandidateFiles>(c.candidateFiles) ?? {},
    decision: json<Decision>(c.candidateDecision),
  }
}

export const retryReport = (candidateId: number) => {
  const c = Candidate.require(candidateId)
  if (!c.candidateFinishedAt) {
    throw new respond.ConflictError({ message: 'Évaluation non terminée.' })
  }
  Candidate.update({ candidateId, candidateReport: { status: 'pending' } })
  buildReport(candidateId)
}

/** Human decision only: the system never recommends one (brief R6) */
export const saveDecision = (
  candidateId: number,
  { choice, note }: { choice: DecisionChoice; note: string },
): Decision => {
  const c: CandidateRow = Candidate.require(candidateId)
  const decision = {
    choice,
    note: note.slice(0, 2000),
    at: new Date().toISOString(),
  }
  Candidate.update({ candidateId, candidateDecision: decision })
  Entry.insert.DECISION_SAVED({
    companyId: companyOfAssessment(c.assessmentId),
    assessmentId: c.assessmentId,
    candidateId,
    data: { choice },
  })
  return decision
}

export type { Question }
