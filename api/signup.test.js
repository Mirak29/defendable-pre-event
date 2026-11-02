// Sign-up of a company space: every refused field is named, so the page
// shows the message on that field. The DNS of
// the e-mail check is faked.
import { eq, test } from '/api/lib/test.ts'
import { routeHandler } from '/api/routes.ts'
import { mailDomainConfig } from '/api/lib/mail-domain.ts'
import { passwordProblem } from '/web/lib/password-rules.ts'

const signup = async (input) => {
  const url = new URL('http://localhost/api/signup')
  try {
    const res = await routeHandler({
      req: new Request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
      url,
      cookies: {},
      trace: Date.now(),
    })
    return { status: res.status, body: await res.json() }
  } catch (error) {
    if (!(error.response instanceof Response)) throw error
    return { status: error.response.status, body: await error.response.json() }
  }
}

const valid = () => ({
  companyName: 'Acme',
  name: 'Awa Diop',
  email: `rh-${crypto.randomUUID().slice(0, 8)}@example.com`,
  password: 'Mot-de-passe-solide-1',
  confirmPassword: 'Mot-de-passe-solide-1',
})

/** the status and the field a refusal names */
const refused = async (input) => {
  const { status, body } = await signup(input)
  return [status, body.input]
}

test('sign-up validation', async (step) => {
  await step('a strong password, confirmed: the space is created', async () => {
    const { status, body } = await signup(valid())
    eq([status, body.company.name], [200, 'Acme'])
  })

  await step(
    'each missing rule refuses the password, and says which',
    async () => {
      for (
        const password of [
          'Court-1',
          'sans-majuscule-1',
          'SANS-MINUSCULE-1',
          'Sans-chiffre-ici',
          'Sanscaractere1',
        ]
      ) {
        eq(await refused({ ...valid(), password, confirmPassword: password }), [
          400,
          'password',
        ], password)
      }
      eq(
        passwordProblem('Sans-chiffre-ici'),
        'Le mot de passe doit contenir un chiffre.',
      )
      eq(
        passwordProblem('court'),
        'Le mot de passe doit contenir 10 caractères minimum, une majuscule, un chiffre, un caractère spécial (! ? - _ …).',
      )
      eq(passwordProblem('Été-2026-solide'), undefined)
    },
  )

  await step('the confirmation must match', async () => {
    eq(
      await refused({ ...valid(), confirmPassword: 'Autre-mot-de-passe-2' }),
      [400, 'confirmPassword'],
    )
  })

  await step('empty or malformed fields are named', async () => {
    eq(await refused({ ...valid(), companyName: '  ' }), [400, 'companyName'])
    eq(await refused({ ...valid(), name: '' }), [400, 'name'])
    eq(await refused({ ...valid(), email: 'awa@exemple' }), [400, 'email'])
  })

  await step('an e-mail already used is named too', async () => {
    const input = valid()
    await signup(input)
    eq(await refused({ ...input, companyName: 'Autre' }), [409, 'email'])
  })

  await step('a domain without mail server is refused (MX)', async () => {
    const saved = { ...mailDomainConfig }
    const asked = []
    mailDomainConfig.enabled = true
    mailDomainConfig.resolveMx = (domain) => {
      asked.push(domain)
      if (domain === 'gmial.com') throw new Deno.errors.NotFound('no MX')
      if (domain === 'panne-dns.fr') throw new Error('timeout')
      if (domain === 'null-mx.fr') {
        return Promise.resolve([{ preference: 0, exchange: '.' }])
      }
      return Promise.resolve([{ preference: 10, exchange: `mx.${domain}` }])
    }
    try {
      const { status, body } = await signup({
        ...valid(),
        email: 'awa@gmial.com',
      })
      eq([status, body.input], [400, 'email'])
      eq(body.message.includes('gmial.com'), true)
      // a null MX (RFC 7505): no mail either
      eq((await signup({ ...valid(), email: 'awa@null-mx.fr' })).status, 400)
      // the DNS down never blocks a sign-up
      eq((await signup({ ...valid(), email: 'awa@panne-dns.fr' })).status, 200)
      // answers are cached: one question per domain
      await signup({ ...valid(), email: 'rh-1@acme-mx.fr' })
      await signup({ ...valid(), email: 'rh-2@acme-mx.fr' })
      eq(asked.filter((d) => d === 'acme-mx.fr').length, 1)
    } finally {
      Object.assign(mailDomainConfig, saved)
    }
  })
})
