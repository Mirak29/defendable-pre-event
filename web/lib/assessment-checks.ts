// Coverage and automatic checks of a generated assessment (R4).
// Pure functions: the review page recomputes them after each test deletion.
import type { AssessmentSpec, CheckResult, ReferenceCheck } from '/web/types.ts'
import { t } from '/web/lib/i18n.ts'

export type { CheckResult }

/** requirement id → ids of the (non deleted) tests linked to it */
export const computeCoverage = (
  spec: AssessmentSpec,
  deleted: ReadonlySet<string> = new Set(),
) => {
  const cover: Record<string, string[]> = Object.fromEntries(
    spec.requirements.map((r) => [r.id, [] as string[]]),
  )
  for (const test of spec.tests) {
    if (deleted.has(test.id)) continue
    for (const id of test.requirementIds) cover[id]?.push(test.id)
  }
  return cover
}

export const computeChecks = (
  spec: AssessmentSpec,
  deleted: ReadonlySet<string> = new Set(),
  /** run by the API in the sandbox (api/assessment.ts) */
  starterFails = true,
  /** fairness check, absent without model (demo replay) */
  reference?: ReferenceCheck,
) => {
  const cover = computeCoverage(spec, deleted)
  const uncovered = spec.requirements
    .map((r) => r.id)
    .filter((id) => cover[id].length === 0)
  const tests = spec.tests.filter((t) => !deleted.has(t.id))
  const requirementIds = new Set(spec.requirements.map((r) => r.id))
  // "GET /links/:alias/stats" → matches "GET /links/promo/stats"
  const routes = spec.routes.map(({ method, path }) => ({
    method,
    pattern: new RegExp(
      `^${path.replace(/:\w+|\{\w+\}/g, '[^/]+')}$`,
    ),
  }))
  const matchesRoute = (route: string) => {
    const [method, raw = ''] = route.split(' ')
    const path = raw.split('?')[0]
    return routes.some((r) => r.method === method && r.pattern.test(path))
  }

  const checks: CheckResult[] = [
    { label: t('Schéma valide', 'Valid schema'), ok: true },
    {
      label: t(
        'Chaque exigence est couverte par au moins un test',
        'Every requirement is covered by at least one test',
      ),
      ok: uncovered.length === 0,
    },
    {
      label: t(
        'Chaque test est rattaché à une exigence et à une route',
        'Every test is linked to a requirement and a route',
      ),
      ok: tests.every((t) =>
        t.requirementIds.some((id) => requirementIds.has(id)) &&
        matchesRoute(t.route)
      ),
    },
    {
      label: t(
        'Le code de départ échoue à tous les tests',
        'The starter code fails every test',
      ),
      ok: starterFails,
    },
    {
      label: t(
        'Les tests cachés portent sur des exigences visibles',
        'Hidden tests are about visible requirements',
      ),
      ok: tests
        .filter((t) => t.visibility === 'caché')
        .every((t) => t.requirementIds.every((id) => requirementIds.has(id))),
    },
  ]
  if (reference) {
    // a test the reference still fails blocks, even judged fair: the judge
    // can be wrong about the test (LIVE-001), and a disputed test must not
    // count against a candidate; the recruiter deletes it or regenerates
    const failed = new Set(
      reference.results.filter((r) => !r.passed).map((r) => r.id),
    )
    const failing = tests.filter((t) => failed.has(t.id)).map((t) => t.id)
    checks.push({
      label: t(
        'Une solution écrite depuis l’énoncé passe tous les tests',
        'A solution written from the brief passes every test',
      ) +
        (failing.length
          ? ` (${failing.join(', ')} ${
            failing.length > 1 ? t('échouent', 'fail') : t('échoue', 'fails')
          })`
          : ''),
      ok: !failing.length,
    })
  }
  return { cover, uncovered, checks, blocked: checks.some((c) => !c.ok) }
}
