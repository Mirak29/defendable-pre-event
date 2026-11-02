// Fairness check of a generated assessment (R3 step 4): the model writes a
// reference solution from what the candidate will see only (brief,
// requirements, routes, constraints, public tests), then the sandbox runs
// every evaluation test against it. For each failed test, the model judges
// on the brief who is wrong: a test asking for something the brief does not
// say is excluded (deleted, with its reason) before the recruiter reviews
// it; the solution is corrected once for the others, and a test it still
// fails blocks the approval until the recruiter deletes it or regenerates.
import { ask } from '/api/llm.ts'
import { runEvaluation } from '/api/sandbox.ts'
import { arr, obj, oneOf, str } from '/api/lib/check.ts'
import { log } from '/api/lib/log.ts'
import type {
  AssessmentSpec,
  CandidateFiles,
  ReferenceCheck,
  TestResult,
} from '/web/types.ts'

const SYSTEM =
  'Tu es un·e développeur·se TypeScript expérimenté·e qui passe une épreuve technique. Tu écris du code Deno correct, simple et sans dépendance.'

/** What the candidate reads in C2 (side panel), nothing more */
export const candidateBriefText = (spec: AssessmentSpec) =>
  [
    `Contexte : ${spec.candidateBrief.context}`,
    `Mission : ${spec.candidateBrief.mission}`,
    `Exigences :\n${
      spec.requirements.map((r) => `- ${r.id} ${r.title} : ${r.statement}`)
        .join('\n')
    }`,
    `Contrat d’API :\n${
      spec.routes.map((r) =>
        `- ${r.method} ${r.path} : ${r.description} (${r.codes.join(', ')})`
      ).join('\n')
    }`,
    `Contraintes :\n${spec.constraints.map((c) => `- ${c}`).join('\n')}`,
    `Tests d’évaluation publics :\n${
      spec.tests.filter((t) => t.visibility === 'public').map((t) =>
        `- ${t.id} ${t.title} : ${
          t.steps.map((s) => `${s.request} → ${s.response}`).join(' puis ')
        }`
      ).join('\n')
    }`,
  ].join('\n\n')

const CODE_RULES =
  `Écris le fichier complet src/app.ts : il exporte async function handler(req: Request): Promise<Response>, garde l’état en mémoire au niveau du module, sans import ni serveur. req.url est une URL absolue (http://localhost/chemin) : lis le chemin avec new URL(req.url).pathname. Réponds uniquement avec le code dans un bloc \`\`\`ts.`

/** the ```ts block of the answer, which must export handler */
export const parseCode = (value: unknown) => {
  const text = String(value)
  const code = (text.match(/```(?:ts|typescript)?\s*\n([\s\S]*?)```/)?.[1] ??
    text).trim()
  if (
    !/export\s+(async\s+)?function\s+handler|export\s+const\s+handler/.test(
      code,
    )
  ) {
    throw Error('le code doit exporter la fonction handler')
  }
  if (/^\s*import\s/m.test(code)) throw Error('aucun import n’est autorisé')
  return code
}

const failureText = (spec: AssessmentSpec, results: TestResult[]) =>
  results.filter((r) => !r.passed).map((r) => {
    const test = spec.tests.find((t) => t.id === r.id)!
    return `- ${r.id} ${test.title} : ${
      test.steps.map((s) => `${s.request} → ${s.response}`).join(' puis ')
    }\n  Reçu : ${r.received ?? '?'}${r.request ? ` (à « ${r.request} »)` : ''}`
  }).join('\n')

const crashed = (results: TestResult[]) =>
  results.length > 1 && results.every((r) => !r.passed) &&
  new Set(results.map((r) => r.received)).size === 1

type Verdict = { id: string; fault: 'test' | 'solution'; reason: string }

const parseVerdicts = (ids: string[]) => (v: unknown): Verdict[] => {
  const o = obj(v, 'réponse')
  const verdicts = arr(o.verdicts, 'verdicts', (x, p) => {
    const item = obj(x, p)
    return {
      id: oneOf(item.id, ids, `${p}.id`),
      fault: oneOf(item.fault, ['test', 'solution'] as const, `${p}.fault`),
      reason: str(item.reason, `${p}.reason`, 200),
    }
  }, { min: 1, max: ids.length })
  return verdicts
}

export const checkReference = async (
  spec: AssessmentSpec,
  starter: CandidateFiles,
): Promise<ReferenceCheck | undefined> => {
  const brief = candidateBriefText(spec)
  const write = await ask({
    task: 'reference',
    tier: 'precise',
    patient: true,
    system: SYSTEM,
    prompt: `Énoncé de l’épreuve :\n${brief}\n\n${CODE_RULES}`,
    json: false,
    parse: parseCode,
    maxTokens: 6000,
    timeoutMs: 150_000,
  })
  const run = (code: string) =>
    runEvaluation({ ...starter, 'src/app.ts': code }, spec.tests)
  let code = write.data
  let results = await run(code)
  const trace = [write.trace]
  const excluded: ReferenceCheck['excluded'] = []

  // the module does not even load (syntax error): every test fails the same
  // way, the solution is fixed from the error before judging any test
  for (let i = 0; i < 2 && crashed(results); i++) {
    const fix = await ask({
      task: 'reference-crash',
      tier: 'precise',
      patient: true,
      system: SYSTEM,
      prompt:
        `Énoncé de l’épreuve :\n${brief}\n\nTa solution :\n\`\`\`ts\n${code}\n\`\`\`\n\nElle ne se charge pas : ${
          results[0].received
        }\n\nCorrige-la (attention aux apostrophes dans les chaînes). ${CODE_RULES}`,
      json: false,
      parse: parseCode,
      maxTokens: 6000,
      timeoutMs: 150_000,
    })
    trace.push(fix.trace)
    code = fix.data
    results = await run(code)
  }
  // still not loading: nothing can be said about the tests
  if (crashed(results)) {
    log.warn('reference-crashed', { received: results[0].received })
    return undefined
  }

  const failing = results.filter((r) => !r.passed).map((r) => r.id)
  let verdicts: Verdict[] = []
  if (failing.length) {
    // who is wrong, the test or the solution? Judged on the brief only
    const review = await ask({
      task: 'reference-review',
      patient: true,
      // decides which tests are unfair: the most accurate model
      tier: 'precise',
      system:
        'Tu vérifies l’équité d’une épreuve technique. Réponds uniquement avec un objet JSON valide, en français.',
      prompt:
        `Énoncé vu par le candidat :\n${brief}\n\nSolution :\n\`\`\`ts\n${code}\n\`\`\`\n\nTests échoués par cette solution :\n${
          failureText(spec, results)
        }\n\nPour chaque test échoué : "solution" si l’énoncé permet de déduire le comportement attendu par le test (la solution se trompe), "test" si le test exige un comportement que l’énoncé ne dit pas ou contredit (code de statut, format, règle non écrite), ou si l’énoncé se contredit lui-même (une règle et un exemple incompatibles). "reason" : une phrase qui nomme la règle en cause.\nJSON attendu : {"verdicts":[{"id":"T3","fault":"test|solution","reason":"…"}]}`,
      parse: parseVerdicts(failing),
      timeoutMs: 150_000,
    })
    trace.push(review.trace)
    verdicts = review.data
    const toFix = review.data.filter((v) => v.fault === 'solution')
    for (const v of review.data.filter((v) => v.fault === 'test')) {
      excluded.push({ id: v.id, reason: v.reason })
    }
    // the solution is wrong: fixed with the judge's diagnosis, twice at most
    for (let round = 0; round < 2; round++) {
      const stillFailing = results.filter((r) =>
        !r.passed && toFix.some((v) => v.id === r.id)
      )
      if (!stillFailing.length) break
      const diagnosis = [
        ...new Set(
          toFix.filter((v) => stillFailing.some((r) => r.id === v.id))
            .map((v) => `- ${v.reason}`),
        ),
      ].join('\n')
      const fix = await ask({
        task: 'reference-fix',
        tier: 'precise',
        patient: true,
        system: SYSTEM,
        prompt:
          `Énoncé de l’épreuve :\n${brief}\n\nTa solution :\n\`\`\`ts\n${code}\n\`\`\`\n\nElle échoue à ces tests, que l’énoncé justifie :\n${
            failureText(spec, stillFailing)
          }\n\nDiagnostic d’un relecteur :\n${diagnosis}\n\nCorrige-la sans casser les autres tests. ${CODE_RULES}`,
        json: false,
        parse: parseCode,
        maxTokens: 6000,
        timeoutMs: 150_000,
      })
      trace.push(fix.trace)
      const fixed = await run(fix.data)
      // keep the correction only if it passes more tests
      if (
        fixed.filter((r) => r.passed).length <=
          results.filter((r) => r.passed).length
      ) break
      code = fix.data
      results = fixed
    }
    // a test the solution still fails is left to the recruiter and blocks
    // the approval, even judged fair: the judge can be wrong (LIVE-001)
  }
  log.info('reference-check', {
    passed: results.filter((r) => r.passed).length,
    total: results.length,
    excluded: excluded.map((e) => e.id),
  })
  return {
    code,
    results: results.map(({ id, passed, received }) => ({
      id,
      passed,
      received: passed ? undefined : received,
      reason: passed ? undefined : verdicts.find((v) => v.id === id)?.reason,
      fault: passed ? undefined : verdicts.find((v) => v.id === id)?.fault,
    })),
    excluded,
    traces: trace,
  }
}
