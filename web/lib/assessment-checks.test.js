import { eq, test } from '/api/lib/test.ts'
import { computeChecks } from '/web/lib/assessment-checks.ts'
import { demoAssessment } from '/fixtures/demo.ts'

test('assessment checks', async (step) => {
  await step('demo assessment passes the 5 checks', () => {
    const { checks, blocked, cover } = computeChecks(demoAssessment)
    eq(checks.length, 5)
    eq(blocked, false)
    eq(cover.R6, ['T7'])
    eq(cover.R1, ['T1', 'T2', 'T6', 'T8', 'T10'])
  })

  await step('deleting T7 leaves R6 uncovered and blocks approval', () => {
    const { uncovered, blocked, checks } = computeChecks(
      demoAssessment,
      new Set(['T7']),
    )
    eq(uncovered, ['R6'])
    eq(blocked, true)
    eq(checks.filter((c) => !c.ok).map((c) => c.label), [
      'Chaque exigence est couverte par au moins un test',
    ])
  })

  await step('a test on an unknown route fails the route check', () => {
    const spec = {
      ...demoAssessment,
      tests: demoAssessment.tests.map((t) =>
        t.id === 'T4' ? { ...t, route: 'PUT /links/promo' } : t
      ),
    }
    eq(
      computeChecks(spec).checks[2],
      {
        label: 'Chaque test est rattaché à une exigence et à une route',
        ok: false,
      },
    )
  })

  await step(
    'a test the reference fails blocks, even judged fair (LIVE-001)',
    () => {
      const reference = {
        code: '',
        results: demoAssessment.tests.map((t) =>
          t.id === 'T6'
            ? { id: 'T6', passed: false, received: '201', fault: 'solution' }
            : { id: t.id, passed: true }
        ),
        excluded: [],
        traces: [],
      }
      const judgedFair = computeChecks(
        demoAssessment,
        new Set(),
        true,
        reference,
      )
      eq(judgedFair.blocked, true)
      eq(
        judgedFair.checks.at(-1).label,
        'Une solution écrite depuis l’énoncé passe tous les tests (T6 échoue)',
      )
      // resolved by the recruiter: the test is deleted (R1 keeps other tests)
      eq(
        computeChecks(demoAssessment, new Set(['T6']), true, reference).blocked,
        false,
      )
    },
  )

  await step('deleting a test of a covered requirement keeps it ok', () => {
    eq(computeChecks(demoAssessment, new Set(['T1'])).blocked, false)
  })
})

test('routes written by the model', async (step) => {
  await step('"{id}" and query strings still match the tests', () => {
    const spec = {
      ...demoAssessment,
      routes: [{
        method: 'GET',
        path: '/rooms/{id}/availability',
        description: '',
        codes: [200],
      }],
      requirements: [demoAssessment.requirements[0]],
      tests: [{
        ...demoAssessment.tests[0],
        route: 'GET /rooms/room-1/availability?date=2025-04-05',
        requirementIds: ['R1'],
      }],
    }
    const { checks } = computeChecks(spec)
    eq(checks[2].ok, true)
  })
})
