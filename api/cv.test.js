// U5: the invitation form prefilled from a CV. Fictional CVs of
// fixtures/cv/; the model is a mock (api/lib/llm-mock.ts).
import { eq, test } from '/api/lib/test.ts'
import { mockLlm } from '/api/lib/llm-mock.ts'
import { llmConfig, retryDelay } from '/api/llm.ts'
import { replayForDemo, withAiScope } from '/api/lib/ai-context.ts'
import { cvText, inCv, readCv, readLocally } from '/api/cv.ts'
import { cvs } from '/fixtures/cv/cvs.ts'

retryDelay.ms = 0

const file = (name) =>
  Deno.readFileSync(new URL(`../fixtures/cv/${name}`, import.meta.url))
const cv = (name) => cvs.find((c) => c.file === name)
const answer = (fields) => [200, JSON.stringify(fields)]

/** a 400 of the API, with its message for the recruiter */
const refused = async (fn, text) => {
  const err = await fn().then(() => undefined, (e) => e)
  const body = await err?.response?.clone().json()
  eq(body?.message?.includes(text), true, body?.message ?? String(err))
}

test('cv text', async (step) => {
  await step('PDF and DOCX give their text', async () => {
    const pdf = await cvText(file('cv-lea-moreau.pdf'))
    eq(pdf.kind, 'pdf')
    eq(pdf.text.includes('lea.moreau@example.com'), true)
    const docx = await cvText(file('cv-karim-benali.docx'))
    eq(docx.kind, 'docx')
    eq(docx.text.split('\n').slice(0, 2), ['Karim BENALI', 'Ingénieur DevOps'])
  })

  await step('a scan has no text layer', async () => {
    eq(
      (await cvText(file('cv-sophie-lambert-scan.pdf'))).text.length < 40,
      true,
    )
  })

  await step('another format is refused', async () => {
    await refused(
      () => cvText(new TextEncoder().encode('Nom : Léa')),
      'PDF ou un DOCX',
    )
    // a zip that is not a Word document
    await refused(
      () => cvText(new Uint8Array([80, 75, 3, 4, 0, 0])),
      'DOCX',
    )
  })
})

test('cv local reading', async (step) => {
  await step('name, headline, e-mail and link of each text CV', async () => {
    for (
      const name of cvs.map((c) => c.file).filter((f) => !f.includes('scan'))
    ) {
      const { text } = await cvText(file(name))
      eq(readLocally(text), cv(name).expected, name)
    }
  })

  await step('a title line and a referee do not fool it', () => {
    const fields = readLocally(
      'CURRICULUM VITAE\nThomas Garcia\nRéférente : marie.petit@acme-example.com\nthomas.garcia@example.org',
    )
    eq([fields.firstName, fields.email], [
      'Thomas',
      'thomas.garcia@example.org',
    ])
  })

  await step('a value is looked up accents, case and scheme aside', () => {
    const text = 'LÉA MOREAU\nlinkedin.com/in/lea-moreau-dev'
    eq(inCv(text, 'lastName', 'Moreau'), true)
    eq(inCv(text, 'firstName', 'Lea'), true)
    eq(
      inCv(text, 'profileUrl', 'https://www.linkedin.com/in/lea-moreau-dev/'),
      true,
    )
    eq(inCv(text, 'email', 'lea@example.com'), false)
  })
})

test('cv reading by a model', async (step) => {
  await step('the fields the model read, each found in the CV', async () => {
    const { expected } = cv('cv-thomas-garcia.pdf')
    await using m = mockLlm(() => answer(expected))
    const reading = await readCv(file('cv-thomas-garcia.pdf'))
    eq(reading.by, 'model')
    eq(reading.fields, expected)
    eq(reading.discarded, [])
    // the CV text went to the model, once
    eq(m.calls.length, 1)
    eq(
      m.calls[0].messages[1].content.includes('marie.petit@acme-example.com'),
      true,
    )
  })

  await step(
    'an invented value is discarded, the local one stays',
    async () => {
      await using _m = mockLlm(() =>
        answer({
          ...cv('cv-lea-moreau.pdf').expected,
          email: 'lea@autre-example.com',
          headline: 'Architecte cloud senior',
        })
      )
      const reading = await readCv(file('cv-lea-moreau.pdf'))
      eq(reading.discarded, ['email', 'headline'])
      eq(reading.fields.email, 'lea.moreau@example.com')
      eq(reading.fields.headline, 'Développeuse backend TypeScript')
    },
  )

  await step('models down: the local reading, said so', async () => {
    await using _m = mockLlm(() => [503])
    const reading = await readCv(file('cv-karim-benali.docx'))
    eq(reading.by, 'local')
    eq(reading.fields.email, 'karim.benali@example.net')
    eq(reading.note?.startsWith('Modèle indisponible'), true)
  })

  await step('never recorded in the replay cache (personal data)', async () => {
    await using _m = mockLlm(() => answer(cv('cv-lea-moreau.pdf').expected))
    llmConfig.record = true
    await readCv(file('cv-lea-moreau.pdf'))
    eq([...Deno.readDirSync(llmConfig.cacheDir)].length, 0)
  })

  await step('the demo space reads locally, without any call', async () => {
    await using m = mockLlm(() => answer({}))
    const reading = await withAiScope(() => {
      replayForDemo(true)
      return readCv(file('cv-lea-moreau.pdf'))
    })
    eq([reading.by, m.calls.length], ['local', 0])
    eq(reading.fields.lastName, 'Moreau')
  })

  await step('a scan needs a Gemini model', async () => {
    await using _m = mockLlm(() => answer({}))
    llmConfig.keys = { nvidia: 'test-key', gemini: '' }
    await refused(
      () => readCv(file('cv-sophie-lambert-scan.pdf')),
      'GEMINI_API_KEY',
    )
  })

  await step('too heavy or empty: refused before any reading', async () => {
    await refused(() => readCv(new Uint8Array()), 'vide')
    await refused(
      () => readCv(new Uint8Array(5 * 1024 * 1024 + 1)),
      '5 Mo',
    )
  })
})
