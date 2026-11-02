import { eq, test } from '/api/lib/test.ts'
import { mockLlm } from '/api/lib/llm-mock.ts'
import { retryDelay } from '/api/llm.ts'
import {
  anchoredInAnswer,
  buildReport,
  confirmContradictions,
  qcmForEvaluator,
  qcmScore,
} from '/api/report.ts'
import { Candidate } from '/api/schema.ts'
import { randomToken } from '/api/assessment.ts'
import { seedDemoAssessment, seedFinishedCandidate } from '/fixtures/seed.ts'

retryDelay.ms = 0

const files = { 'src/app.ts': 'export const handler = () => new Response()\n' }
const claims = [
  {
    id: '8-0',
    answer: 'a',
    quote: 'le code renvoie 400',
    claim: 'le code renvoie 400',
    why: 'il renvoie 201',
  },
  {
    id: '9-0',
    answer: 'b',
    quote: 'une Map',
    claim: 'une Map',
    why: 'un tableau',
  },
]

test('contradictions need a second key (AUD-004)', async (step) => {
  await step('confirmed and refused by the second model', async () => {
    await using _m = mockLlm(() => [
      200,
      '{"verdicts":[{"id":"8-0","confirmed":true},{"id":"9-0","confirmed":false}]}',
    ])
    const { confirmed, unavailable } = await confirmContradictions(
      files,
      claims,
    )
    eq([[...confirmed], unavailable], [['8-0'], undefined])
  })

  await step('second model down: nothing confirmed, reasons kept', async () => {
    await using m = mockLlm(() => [503])
    const { confirmed, unavailable } = await confirmContradictions(
      files,
      claims,
    )
    eq(confirmed.size, 0)
    eq(unavailable.at(-1).reason, 'service surchargé (503)')
    // AUD-010: the second key never falls back on Ultra, the first key's model
    eq(m.calls.some((c) => c.model === 'model-precise'), false)
  })
})

test('QCM with a disputed key are not counted (AUD-003)', () => {
  const qcm = [
    { isCorrect: true, check: 'execution' },
    { isCorrect: false, check: 'double-key' },
    { isCorrect: false, check: 'disputed' },
  ]
  eq(qcmScore(qcm), '1/2 (1 clé contestée, non comptée)')
  eq(qcmScore(qcm.slice(0, 2)), '1/2')
})

test('a contradiction is anchored in the answer (LIVE-004)', async (step) => {
  const answer =
    'Je conteste la prémisse : la chaîne fait 31 caractères, pas 33. Une chaîne de 33 caractères retourne bien 400.'

  await step('words the candidate wrote', () => {
    eq(anchoredInAnswer(answer, 'la chaîne fait 31 caractères, pas 33'), true)
    // apostrophes, spaces and case of the copy do not matter
    eq(
      anchoredInAnswer(
        'Je valide déjà que l’URL est en http',
        "je valide  déjà que l'URL",
      ),
      true,
    )
  })

  await step('words the model made up are refused', () => {
    eq(
      anchoredInAnswer(
        answer,
        'Le test T6 envoie un alias de 33 caractères et reçoit 201',
      ),
      false,
    )
    eq(anchoredInAnswer(answer, undefined), false)
    eq(anchoredInAnswer(answer, '33'), false) // too short to carry a claim
  })

  await step('the second key reads the quote', async () => {
    await using m = mockLlm(() => [
      200,
      '{"verdicts":[{"id":"8-0","confirmed":false},{"id":"9-0","confirmed":false}]}',
    ])
    await confirmContradictions(files, claims)
    const prompt = m.calls[0].messages.at(-1).content
    eq(prompt.includes('"quote":"le code renvoie 400"'), true)
    eq(prompt.includes('vérifie d’abord l’attribution'), true)
  })
})

test('a disputed QCM is neither right nor wrong for the evaluator (LIVE-007)', async (step) => {
  await step('no verdict nor key in what the evaluator reads', () => {
    const [disputed, counted] = qcmForEvaluator([
      {
        n: 3,
        prompt: 'p',
        chosen: 'a',
        correct: 'b',
        isCorrect: false,
        check: 'disputed',
      },
      {
        n: 4,
        prompt: 'p',
        chosen: 'a',
        correct: 'a',
        isCorrect: true,
        check: 'double-key',
      },
    ])
    eq(disputed, { n: 3, prompt: 'p', chosen: 'a', cleContestee: true })
    eq(counted, {
      n: 4,
      prompt: 'p',
      chosen: 'a',
      correct: 'a',
      isCorrect: true,
    })
  })

  await step('no note of fault on a disputed key', async () => {
    const assessmentId = seedDemoAssessment(randomToken(10))
    const candidateId = seedFinishedCandidate(assessmentId, randomToken(24))
    const row = Candidate.require(candidateId)
    const questions = JSON.parse(row.candidateQuestions)
    const list = Array.isArray(questions) ? questions : questions.questions
    list.find((q) => q.n === 1).keyDisputed = true
    Candidate.update({
      candidateId,
      candidateQuestions: questions,
      candidateReport: null,
    })
    await buildReport(candidateId)
    const { status, report } = JSON.parse(
      Candidate.require(candidateId).candidateReport,
    )
    eq(status, 'ready')
    const q1 = report.qcm.find((q) => q.n === 1)
    eq([q1.check, q1.isCorrect, q1.aiNote], ['disputed', false, undefined])
  })
})
