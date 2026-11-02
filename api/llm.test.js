import { eq, rejects, test } from '/api/lib/test.ts'
import { mockLlm } from '/api/lib/llm-mock.ts'
import {
  AiError,
  aiErrorText,
  ask,
  extractJson,
  llmConfig,
  MODELS,
  retryDelay,
  routeChain,
} from '/api/llm.ts'

retryDelay.ms = 0

const parse = (v) => {
  if (typeof v?.answer !== 'number') throw Error('answer doit être un nombre')
  return v
}

const mock = mockLlm

const task = (extra = {}) => ({
  task: 'unit',
  tier: 'super',
  system: 'Réponds en JSON',
  prompt: 'Combien ?',
  parse,
  ...extra,
})

test('extractJson', async (step) => {
  await step('fences, think blocks and prose around', () => {
    eq(extractJson('```json\n{"a":1}\n```'), { a: 1 })
    eq(extractJson('<think>hmm {"no":1}</think>Voici : {"a":[1,2]} merci'), {
      a: [1, 2],
    })
  })

  await step(
    'a code block inside a value is not the envelope (LIVE-005)',
    () => {
      const value = {
        questions: [{
          prompt: 'Que renvoie ?\n```typescript\nconst a = { b: 1 }\n```',
        }],
      }
      eq(extractJson(JSON.stringify(value)), value)
      eq(extractJson(`\`\`\`json\n${JSON.stringify(value)}\n\`\`\``), value)
      eq(
        extractJson(
          `Voici :\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\` fin`,
        ),
        value,
      )
    },
  )

  await step('a trailing comma is forgiven', () => {
    eq(extractJson('{"a": [1, 2,], "b": {"c": 3,},}'), {
      a: [1, 2],
      b: { c: 3 },
    })
  })
})

test('ask', async (step) => {
  await step('valid answer, trace with tokens', async () => {
    await using m = mock(() => [200, '{"answer":42}'])
    const { data, trace } = await ask(task())
    eq(data.answer, 42)
    eq([trace.model, trace.tokensIn, trace.tokensOut, !!trace.replay], [
      'Nemotron 3 Super',
      10,
      5,
      false,
    ])
    eq(m.calls[0].model, 'model-super')
  })

  await step('invalid answer is retried with the error', async () => {
    await using m = mock((
      _,
      n,
    ) => [200, n === 1 ? '{"answer":"x"}' : '{"answer":1}'])
    const { data, trace } = await ask(task())
    eq(data.answer, 1)
    eq(m.calls.length, 2)
    eq(
      m.calls[1].messages.at(-1).content.includes('answer doit être un nombre'),
      true,
    )
    eq(trace.tokensIn, 20)
  })

  await step('main model down: fallback model, amber banner', async () => {
    await using m = mock((body) =>
      body.model === 'model-super' ? [500] : [200, '{"answer":7}']
    )
    const fallbacks = []
    const { data, trace } = await ask(
      task({ onFallback: (e) => fallbacks.push(e) }),
    )
    eq([data.answer, trace.model, fallbacks.length], [7, 'Nemotron 3 Ultra', 1])
    eq(m.calls.length, 2)
  })

  await step('overloaded endpoint: one retry on the same model', async () => {
    await using m = mock((_, n) => n === 1 ? [503] : [200, '{"answer":2}'])
    const { data, trace } = await ask(task())
    eq([data.answer, trace.model, m.calls.length], [2, 'Nemotron 3 Super', 2])
  })

  await step('patient job: spaced retries before the fallback', async () => {
    await using m = mock((_, n) => n <= 3 ? [503] : [200, '{"answer":4}'])
    const { data, trace } = await ask(task({ patient: true }))
    eq([data.answer, trace.model, m.calls.length], [4, 'Nemotron 3 Super', 4])
  })

  await step('fallback chosen by the step', async () => {
    await using m = mock((body) =>
      body.model === 'model-precise' ? [200, '{"answer":6}'] : [500]
    )
    const { data } = await ask(task({ fallback: 'precise' }))
    eq([data.answer, m.calls.at(-1).model], [6, 'model-precise'])
  })

  await step('every failed attempt is kept, with its reason', async () => {
    await using _m = mock((body) =>
      body.model === 'model-super' ? [503] : [200, '{"answer":1}']
    )
    const { trace } = await ask(task())
    eq(
      trace.failures.map((f) => `${f.model} : ${f.reason}`),
      [
        'Nemotron 3 Super : service surchargé (503)', // then one retry
        'Nemotron 3 Super : service surchargé (503)',
      ],
    )
  })

  await step(
    'invalid answer, then total failure: AiError says why',
    async () => {
      await using _m = mock((body) =>
        body.model === 'model-super' ? [200, '{"answer":"deux"}'] : [404]
      )
      const err = await ask(task()).catch((e) => e)
      eq(err instanceof AiError, true)
      eq(err.failures.map((f) => f.reason), [
        'réponse inexploitable : answer doit être un nombre',
        'réponse inexploitable : answer doit être un nombre',
        'modèle introuvable (404)',
      ])
    },
  )

  await step('readable error for the pages', () => {
    eq(
      aiErrorText(
        Error('super: 503 {"error":"Service temporarily overloaded"}'),
      ),
      'Les modèles sont surchargés en ce moment (points d’accès gratuits). Réessayez dans quelques minutes.',
    )
    eq(
      aiErrorText(Error('nano: The operation was aborted due to timeout')),
      'Le modèle n’a pas répondu à temps. Réessayez dans quelques minutes.',
    )
    // a number that merely contains 503 is not an overload
    eq(
      aiErrorText(new AiError('15030 tokens', 'unit')).startsWith(
        'Le modèle n’a pas',
      ),
      true,
    )
    // not a model failure: said as it is (AUD-006)
    eq(
      aiErrorText(Error('Chemin refusé : ../x.ts')),
      'Erreur de traitement : Chemin refusé : ../x.ts',
    )
  })

  await step(
    'with a key, the brief answer never replaces a failure',
    async () => {
      await using _m = mock(() => [500])
      await rejects(() => ask(task({ demo: () => ({ answer: 0 }) })), AiError)
    },
  )

  await step('both models down, no demo answer: AiError', async () => {
    await using _m = mock(() => [503])
    await rejects(() => ask(task()), AiError)
  })

  await step('recorded answers are replayed without key', async () => {
    {
      await using _m = mock(() => [200, '{"answer":5}'])
      llmConfig.record = true
      await ask(task())
      const dir = llmConfig.cacheDir
      llmConfig.keys = { nvidia: '', gemini: '' }
      const { data, trace } = await ask(task())
      eq([data.answer, trace.replay, trace.tokensIn], [5, true, 10])
      eq([...Deno.readDirSync(dir)].length, 1)
    }
  })

  await step('no key and nothing cached: demo answer', async () => {
    const saved = llmConfig.keys
    llmConfig.keys = { nvidia: '', gemini: '' }
    const { data, trace } = await ask(
      task({ prompt: 'autre', demo: () => ({ answer: 3 }) }),
    )
    llmConfig.keys = saved
    eq([data.answer, trace.replay], [3, true])
  })
})

test('routes of the tasks', async (step) => {
  const saved = llmConfig.keys
  const labels = (o) => routeChain({ tier: 'super', ...o }).map((e) => e.label)
  try {
    await step('the measured route, fallback on the other provider', () => {
      llmConfig.keys = { nvidia: 'k', gemini: 'k' }
      eq(labels({ task: 'evaluation' }), [
        MODELS.ultra.label,
        MODELS['lite-3.1'].label,
      ])
      eq(labels({ task: 'assistant' }), [
        MODELS['lite-3.1'].label,
        MODELS.super.label,
      ])
    })

    await step('a second key never asks the model to check', () => {
      eq(
        labels({
          task: 'contradiction-check',
          avoid: MODELS['lite-3.1'].label,
        }),
        [MODELS.super.label, MODELS.ultra.label],
      )
    })

    await step('a model without its key is skipped', () => {
      llmConfig.keys = { nvidia: 'k', gemini: '' }
      eq(labels({ task: 'assistant' }), [
        MODELS.super.label,
        MODELS.ultra.label,
      ])
      llmConfig.keys = { nvidia: '', gemini: 'k' }
      eq(labels({ task: 'evaluation' }), [MODELS['lite-3.1'].label])
    })

    await step('a scanned document goes to Gemini only', () => {
      llmConfig.keys = { nvidia: 'k', gemini: 'k' }
      eq(
        labels({
          task: 'cv-extract',
          document: { mime: 'x', data: new Uint8Array() },
        }),
        [MODELS['flash-lite'].label, MODELS['lite-3.1'].label],
      )
    })
  } finally {
    llmConfig.keys = saved
  }
})
