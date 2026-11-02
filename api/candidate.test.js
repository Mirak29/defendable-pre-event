import { eq, test } from '/api/lib/test.ts'
import { Candidate } from '/api/schema.ts'
import { seedDemoAssessment, seedFinishedCandidate } from '/fixtures/seed.ts'
import { randomToken } from '/api/assessment.ts'
import {
  answersOf,
  askAssistant,
  ASSISTANT_LIMIT,
  sendAnswer,
} from '/api/candidate.ts'

// a candidate of the demo assessment, at question `n`, opened `ago` ms ago
const atQuestion = (ago, n = 1) => {
  const assessmentId = seedDemoAssessment(randomToken(10))
  const candidateId = seedFinishedCandidate(assessmentId, randomToken(24))
  Candidate.update({
    candidateId,
    candidateFinishedAt: null,
    candidateReport: null,
    candidateAnswers: {
      [n]: { openedAt: Date.now() - ago, assistant: [], assistantTraces: [] },
    },
  })
  return () => Candidate.require(candidateId)
}

test('answers after the time are not recorded (AUD-005)', async (step) => {
  await step('within the time: the choice is kept', () => {
    const row = atQuestion(10_000)
    sendAnswer(row(), { n: 1, choice: 2 })
    const [answer] = Object.values(answersOf(row()))
    eq([answer.choice, answer.expired], [2, undefined])
  })

  await step('an hour later: unanswered, « temps écoulé »', () => {
    const row = atQuestion(3_600_000)
    sendAnswer(row(), { n: 1, choice: 2 })
    const [answer] = Object.values(answersOf(row()))
    eq([answer.choice, answer.expired, !!answer.sentAt], [
      undefined,
      true,
      true,
    ])
  })
})

test('assistant limit under parallel calls (AUD-007)', async (step) => {
  await step('4 calls at once: 3 replies, 1 refused', async () => {
    const row = atQuestion(1_000, 7) // Q7 is a free answer
    const calls = await Promise.allSettled(
      [1, 2, 3, 4].map((i) =>
        askAssistant(row(), { n: 7, message: `Question ${i}` })
      ),
    )
    eq(calls.filter((c) => c.status === 'fulfilled').length, ASSISTANT_LIMIT)
    eq(calls.filter((c) => c.status === 'rejected').length, 1)
    const stored = answersOf(row())[7].assistant
    eq(stored.filter((m) => m.role === 'user').length, ASSISTANT_LIMIT)
  })
})
