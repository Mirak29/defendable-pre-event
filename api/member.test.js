// Fast, isolated security checks; no server, browser, sandbox or AI journey.
import { eq, test } from '/api/lib/test.ts'
import { routeHandler } from '/api/routes.ts'
import { decodeSession } from '/api/member.ts'
import { Entry, entryInsertListeners } from '/api/schema.ts'
import { seedDemoAssessment, seedFinishedCandidate } from '/fixtures/seed.ts'

const call = async (method, path, input, token) => {
  const url = new URL(`http://localhost${path}`)
  if (method === 'GET') {
    for (const [k, v] of Object.entries(input ?? {})) {
      url.searchParams.set(k, String(v))
    }
  }
  try {
    return await routeHandler({
      req: new Request(url, {
        method,
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
        },
        body: method === 'POST' ? JSON.stringify(input ?? {}) : undefined,
      }),
      url,
      cookies: token ? { dfd_session: token } : {},
      trace: Date.now(),
    })
  } catch (error) {
    if (error.response instanceof Response) return error.response
    throw error
  }
}

test('U2 sessions and company boundaries', async (step) => {
  const signup = async (email) => {
    const response = await call('POST', '/api/signup', {
      companyName: email,
      name: 'Test',
      email,
      password: 'Synthetic-password-1',
    })
    eq(response.status, 200)
    const token =
      response.headers.get('set-cookie').match(/dfd_session=([^;]+)/)[1]
    return { token, view: await response.json() }
  }
  const a = await signup('a@example.invalid')
  const b = await signup('b@example.invalid')
  const assessmentId = seedDemoAssessment('u2-synthetic', a.view.company.id)
  const candidateId = seedFinishedCandidate(assessmentId)
  await step(
    'all recruiter resource routes hide another company',
    async () => {
      const cases = [
        ['GET', '/api/assessment', { id: assessmentId }],
        ...['retry', 'update', 'deleted-tests', 'regenerate', 'approve'].map((
          action,
        ) => ['POST', `/api/assessment/${action}`, {
          id: assessmentId,
          testIds: [],
          instruction: 'Test',
        }]),
        ['GET', '/api/report', { candidate: candidateId }],
        ['POST', '/api/report/retry', { candidate: candidateId }],
        ['POST', '/api/decision', {
          candidate: candidateId,
          choice: 'go',
          note: '',
        }],
        ['GET', '/api/events', { assessment: assessmentId }],
        ['GET', '/api/events', { candidate: candidateId }],
      ]
      for (const [method, path, data] of cases) {
        eq((await call(method, path, data, b.token)).status, 404, path)
      }
      eq(
        await (await call('GET', '/api/assessments', {}, b.token)).json(),
        [],
      )
      eq(
        (await call('GET', '/api/assessment', { id: assessmentId }, a.token))
          .status,
        200,
      )
      eq(
        (await call('POST', '/api/assessment/prefill', {
          jobDescription: 'Test',
        })).status,
        401,
      )
      eq(
        (await call(
          'POST',
          '/api/sql/execute',
          { query: 'SELECT * FROM member' },
          a.token,
        )).status,
        404,
      )
    },
  )
  await step('SSE company filters exclude other companies', () => {
    const payloads = []
    const listener = {
      companyId: b.view.company.id,
      controller: { enqueue: (payload) => payloads.push(payload) },
    }
    entryInsertListeners.add(listener)
    try {
      Entry.insert.ASSESSMENT_UPDATED({
        companyId: a.view.company.id,
        assessmentId,
      })
      eq(payloads.length, 0)
      const ownId = seedDemoAssessment('u2-company-b', b.view.company.id)
      Entry.insert.ASSESSMENT_UPDATED({
        companyId: b.view.company.id,
        assessmentId: ownId,
      })
      eq(payloads.length > 0, true)
    } finally {
      entryInsertListeners.delete(listener)
    }
  })
  await step(
    'session validation, logout, password redaction and rate cap',
    async () => {
      eq((await call('GET', '/api/me', {}, a.token)).status, 200)
      eq(await decodeSession(a.token.split(':')[0] + ':AA'), undefined)
      eq((await call('POST', '/api/logout', {}, a.token)).status, 204)
      eq(await decodeSession(a.token), undefined)
      eq((await call('GET', '/api/me', {}, a.token)).status, 401)
      const malformed = await call('POST', '/api/login', {
        email: 'a@example.invalid',
        password: { secret: 'synthetic-sensitive-value' },
      })
      eq(malformed.status, 400)
      eq(
        (await malformed.text()).includes('synthetic-sensitive-value'),
        false,
      )
      for (let n = 0; n < 10; n++) {
        eq(
          (await call('POST', '/api/login', {
            email: 'missing@example.invalid',
            password: 'wrong',
          })).status,
          401,
        )
      }
      eq(
        (await call('POST', '/api/login', {
          email: 'missing@example.invalid',
          password: 'wrong',
        })).status,
        429,
      )
    },
  )
})

test('origin check: same host, whatever the scheme', async () => {
  const logout = async (origin) => {
    const url = new URL('http://localhost/api/logout')
    try {
      return await routeHandler({
        req: new Request(url, { method: 'POST', headers: { origin } }),
        url,
        cookies: {},
        trace: Date.now(),
      })
    } catch (error) {
      if (error.response instanceof Response) return error.response
      throw error
    }
  }
  // behind a TLS proxy the browser sends https:// for the same host
  eq((await logout('https://localhost')).status, 204)
  eq((await logout('https://evil.example')).status, 403)
  eq((await logout('not a url')).status, 403)
})
