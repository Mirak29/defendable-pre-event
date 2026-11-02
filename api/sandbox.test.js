import { eq, test } from '/api/lib/test.ts'
import {
  checkTypes,
  findRefusedImport,
  probeRequests,
  runEvaluation,
  runOwnTests,
  runPlayground,
} from '/api/sandbox.ts'
import { demoDraftRepository, demoFiles } from '/fixtures/demo-files.ts'
import { demoAssessment } from '/fixtures/demo.ts'
import { toFileUrl } from 'jsr:@std/path'

const text = (run) => run.chunks.map((c) => c.text).join('')
const withPlayground = (code) => ({ ...demoFiles, 'playground.ts': code })

test('sandbox runs the candidate code', async (step) => {
  await step('deno run playground.ts', async () => {
    const run = await runPlayground(demoFiles)
    eq(run.exitCode, 0)
    eq(text(run).trim(), '201 { alias: "promo", url: "https://example.com" }')
  })

  await step('deno test src/', async () => {
    const run = await runOwnTests(demoFiles)
    eq([run.passed, run.failed], [6, 0])
  })

  await step('deno check finds the type error of the draft', async () => {
    const files = {
      ...demoFiles,
      'src/links_repository.ts': demoDraftRepository,
    }
    const [problem, ...rest] = await checkTypes(files)
    eq(rest.length, 0)
    eq(problem.file, 'src/links_repository.ts')
    eq([problem.line, problem.column, problem.length], [27, 44, 6])
    eq(problem.code, 'deno-ts(2322)')
    eq((await checkTypes(demoFiles)).length, 0)
  })

  await step('evaluation tests: 8 public pass, hidden T9 fails', async () => {
    const results = await runEvaluation(demoFiles, demoAssessment.tests)
    eq(
      results.filter((r) => !r.passed).map((r) => r.id),
      ['T9'],
    )
    const t9 = results.find((r) => r.id === 'T9')
    eq([t9.expected, t9.received], ['400', '201'])
  })

  await step(
    'evaluation tests: a starter that answers 501 fails all',
    async () => {
      const starter = {
        'src/app.ts':
          'export function handler(_req: Request) { return new Response(null, { status: 501 }) }',
        'deno.json': '{}',
      }
      const results = await runEvaluation(starter, demoAssessment.tests)
      eq(results.every((r) => !r.passed), true)
    },
  )
})

test('sandbox limits', async (step) => {
  await step('no network', async () => {
    const run = await runPlayground(
      withPlayground('Deno.serve(() => new Response("x"))'),
    )
    eq(run.exitCode, 1)
    eq(text(run).includes('Requires net access'), true)
  })

  await step('timeout', async () => {
    const run = await runPlayground(withPlayground('while (true) {}'), 1500)
    eq(run.timedOut, true)
  })

  await step('output truncated at 64 KB', async () => {
    const run = await runPlayground(
      withPlayground(
        'for (let i = 0; i < 20000; i++) console.log("x".repeat(40))',
      ),
    )
    eq(run.truncated, true)
    eq(text(run).length, 64 * 1024)
  })

  await step('imports outside deno.json are refused', async () => {
    const code = 'import { nanoid } from "npm:nanoid";\nconsole.log(nanoid())'
    eq(
      findRefusedImport(withPlayground('import x from "https://x.dev/a.ts"')),
      'https://x.dev/a.ts',
    )
    eq(
      findRefusedImport(withPlayground('import("../../secret.ts")')),
      '../../secret.ts',
    )
    eq(
      findRefusedImport(withPlayground('const m = "x"; import(m)')),
      'import(m)',
    )
    eq(findRefusedImport(demoFiles), undefined)
    const run = await runPlayground(withPlayground(code))
    eq(run.refusedImport, 'nanoid')
  })
})

test('sandbox output without colors', async (step) => {
  await step('forced colors are removed', async () => {
    const saved = Deno.env.get('FORCE_COLOR')
    Deno.env.set('FORCE_COLOR', '1')
    const files = {
      ...demoFiles,
      'src/links_repository.ts': demoDraftRepository,
    }
    const problems = await checkTypes(files)
    saved === undefined
      ? Deno.env.delete('FORCE_COLOR')
      : Deno.env.set('FORCE_COLOR', saved)
    eq(problems.length, 1)
  })
})

test('evaluation tests with a captured id', async (step) => {
  await step(
    'the id chosen by the code is reused in the next request',
    async () => {
      const files = {
        'deno.json': '{}',
        'src/app.ts': `const store = new Map<string, string>();
export async function handler(req: Request) {
  const url = new URL(req.url);
  if (req.method === "POST") {
    const id = crypto.randomUUID();
    store.set(id, "x");
    return Response.json({ id }, { status: 201 });
  }
  const id = url.pathname.split("/").pop()!;
  return new Response(null, { status: store.delete(id) ? 204 : 404 });
}`,
      }
      const [result] = await runEvaluation(files, [{
        id: 'T1',
        title: 'Supprime une réservation',
        route: 'DELETE /reservations/:id',
        condition: 'après création',
        expected: '204',
        visibility: 'public',
        requirementIds: ['R1'],
        steps: [
          {
            request: 'POST /reservations {"salle":"C"}',
            response: '201 · {"id":"$id"}',
          },
          { request: 'DELETE /reservations/$id', response: '204' },
        ],
      }])
      eq(result.passed, true)
    },
  )
})

test('prediction questions reuse the created ids', async (step) => {
  await step('$id1 is the id of the first created resource', async () => {
    const files = {
      'deno.json': '{}',
      'src/app.ts': `const store = new Map<string, string>();
export async function handler(req: Request) {
  const url = new URL(req.url);
  if (req.method === "POST") {
    const id = crypto.randomUUID();
    store.set(id, "x");
    return Response.json({ id }, { status: 201 });
  }
  const id = url.pathname.split("/").pop()!;
  return new Response(null, { status: store.delete(id) ? 204 : 404 });
}`,
    }
    const { q3 } = await probeRequests(files, [{
      id: 'q3',
      requests: [
        { method: 'POST', path: '/bookings', body: '{"roomId":"room-1"}' },
        { method: 'DELETE', path: '/bookings/$id1' },
        { method: 'DELETE', path: '/bookings/$id1' },
      ],
    }])
    eq(q3.map((r) => r.status), [201, 204, 404])
  })
})

test('verdicts are computed by the server (AUD-001)', async (step) => {
  const answers501 = (extra) => ({
    'deno.json': '{}',
    'src/app.ts': `${extra}
export function handler(_req: Request) {
  return new Response(null, { status: 501 })
}`,
  })
  const probe = [{ id: 'q', requests: [{ method: 'GET', path: '/x' }] }]

  await step('a message posted by the code is not a result', async () => {
    const files = answers501(
      'self.postMessage({ passed: true, responses: [{ status: 200, body: "" }] })',
    )
    const results = await runEvaluation(files, demoAssessment.tests)
    eq(results.some((r) => r.passed), false)
    const { q } = await probeRequests(files, probe)
    eq(q.map((r) => r.status), [501])
  })

  await step('lines printed by the code are ignored', async () => {
    const files = answers501(
      'console.log("__DFD__not-json");\nconsole.log("__DFD__" + JSON.stringify({ id: "T1", passed: true }))',
    )
    const results = await runEvaluation(files, demoAssessment.tests)
    eq(results.some((r) => r.passed), false)
    eq(results.find((r) => r.id === 'T1').received, '501')
  })

  await step('no expectation is readable in the workspace', async () => {
    const files = {
      'deno.json': '{}',
      'src/app.ts': `export function handler(_req: Request) {
  const seen = [...Deno.readDirSync('__dfd__')]
    .map((f) => Deno.readTextFileSync('__dfd__/' + f.name)).join('')
  throw Error(seen)
}`,
    }
    const [result] = await runEvaluation(files, [{
      id: 'T1',
      title: 'Marqueur',
      route: 'GET /x',
      condition: 'toujours',
      expected: '200',
      visibility: 'hidden',
      requirementIds: ['R1'],
      steps: [{
        request: 'GET /x',
        response: '200 · {"secret":"expected-marker"}',
      }],
    }])
    eq(result.received.includes('onmessage'), true) // the harness was read
    eq(result.received.includes('expected-marker'), false)
  })
})

test('nothing outside the workspace is loaded (AUD-002)', async (step) => {
  const MARK = 'dfd-outside-marker'
  const outside = await Deno.makeTempDir({ prefix: 'dfd-outside-' })
  await Deno.writeTextFile(`${outside}/mod.ts`, `export const m = '${MARK}'`)
  await Deno.writeTextFile(`${outside}/data.json`, `{"m":"${MARK}"}`)
  await Deno.writeTextFile(`${outside}/note.txt`, MARK)
  const url = (name) => toFileUrl(`${outside}/${name}`).href
  // forms the first filter (findRefusedImport) does not see: the module
  // graph is the barrier
  const attempts = {
    'static import': `import { m } from/**/'${url('mod.ts')}'; console.log(m)`,
    'json import': `import d from/**/'${
      url('data.json')
    }' with { type: 'json' }; console.log(d.m)`,
    'text import': `import t from/**/'${
      url('note.txt')
    }' with { type: 'text' }; console.log(t)`,
    'dynamic import': `const { m } = await import/**/('${
      url('mod.ts')
    }'); console.log(m)`,
  }

  await step('refused for run, tests, evaluation and check', async () => {
    for (const [name, code] of Object.entries(attempts)) {
      eq(findRefusedImport(withPlayground(code)), undefined)
      const run = await runPlayground(withPlayground(code))
      eq([name, text(run).includes(MARK)], [name, false])
      const files = {
        ...demoFiles,
        'src/app.ts': `${code}\n${demoFiles['src/app.ts']}`,
      }
      const results = await runEvaluation(files, demoAssessment.tests)
      eq([name, results.some((r) => r.passed)], [name, false])
      eq(JSON.stringify(results).includes(MARK), false)
      const own = await runOwnTests(files)
      eq(text(own).includes(MARK), false)
      eq(JSON.stringify(await checkTypes(files)).includes(MARK), false)
    }
  })

  await step('the candidate configuration is not used', async () => {
    // inside the workspace, so only the configuration can decide
    const config = JSON.stringify({
      imports: { '@std/assert': 'jsr:@std/assert@1' },
      scopes: { './': { cfg: './src/app.ts' } },
    })
    const run = await runPlayground({
      ...withPlayground(
        `import { handler } from/**/'cfg'\nconsole.log('LOADED', typeof handler)`,
      ),
      'deno.json': config,
    })
    eq(text(run).includes('LOADED'), false)
  })

  await step('workspace imports and jsr dependencies still work', async () => {
    const run = await runOwnTests(demoFiles) // relative imports + @std/assert
    eq([run.passed, run.failed], [6, 0])
  })
  await Deno.remove(outside, { recursive: true })
})

test('the English demo behaves like the French one', async (step) => {
  const { demos } = await import('/fixtures/demos.ts')
  const { files, assessment, draftRepository } = demos.en

  await step('own tests pass, playground answers 201', async () => {
    const own = await runOwnTests(files)
    eq([own.passed, own.failed], [6, 0])
    eq(
      text(await runPlayground(files)).trim(),
      '201 { alias: "promo", url: "https://example.com" }',
    )
  })

  await step('evaluation tests: 8 public pass, hidden T9 fails', async () => {
    const results = await runEvaluation(files, assessment.tests)
    eq(results.filter((r) => !r.passed).map((r) => r.id), ['T9'])
  })

  await step('the draft has the same type error', async () => {
    const [problem] = await checkTypes({
      ...files,
      'src/links_repository.ts': draftRepository,
    })
    eq([problem.line, problem.code], [27, 'deno-ts(2322)'])
  })
})
