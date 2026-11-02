import { eq, test, throws } from '/api/lib/test.ts'
import {
  captureVars,
  matchesSubset,
  normalizeSteps,
  parseRequest,
  parseResponse,
  substituteVars,
} from '/api/test-steps.ts'

test('test steps written by the model', async (step) => {
  await step('requests: body, repetition, spaces in the query', () => {
    eq(
      parseRequest('POST /links {"url":"https://a.com"}').body,
      '{"url":"https://a.com"}',
    )
    eq(parseRequest('GET /promo (×2)').repeat, 2)
    eq(
      parseRequest('GET /reservations?salle=Salle C').path,
      '/reservations?salle=Salle%20C',
    )
    throws(() => parseRequest('FETCH /x'))
  })

  await step('responses: object, array, header, non-empty field', () => {
    eq(parseResponse('200 · {"clicks":2}').expect.kind, 'json')
    eq(parseResponse('200 · [{"id":"res-001"}]').expect.subset, [{
      id: 'res-001',
    }])
    eq(parseResponse('302 · Location: https://a.com').expect.name, 'Location')
    eq(parseResponse('201 · alias : chaîne non vide').expect.field, 'alias')
  })

  await step('subset match on arrays', () => {
    const list = [{ id: 'a', n: 1 }, { id: 'b', n: 2 }]
    eq(matchesSubset(list, [{ id: 'b' }]), true)
    eq(matchesSubset(list, [{ id: 'c' }]), false)
    eq(matchesSubset([], []), true)
    eq(matchesSubset(list, []), false)
    eq(matchesSubset({ items: list }, { items: [{ n: 2 }] }), true)
  })
})

test('tests normalized for fairness', async (step) => {
  await step(
    'a returned id is captured and reused, errors are free text',
    () => {
      const steps = normalizeSteps([
        {
          request: 'POST /reservations {"salle":"C"}',
          response: '201 · {"id":3}',
        },
        { request: 'DELETE /reservations/3', response: '204' },
        {
          request: 'GET /reservations',
          response: '200 · [{"id":3,"salle":"C"}]',
        },
        {
          request: 'POST /reservations {"salle":"C"}',
          response: '409 · {"error":"La salle est déjà réservée"}',
        },
      ])
      eq(steps.map((s) => [s.request, s.response]), [
        ['POST /reservations {"salle":"C"}', '201 · {"id":"$id"}'],
        ['DELETE /reservations/$id', '204'],
        ['GET /reservations', '200 · [{"id":"$_","salle":"C"}]'],
        ['POST /reservations {"salle":"C"}', '409 · {"error":"$_"}'],
      ])
    },
  )

  await step('values chosen by the test stay literal', () => {
    const [created] = normalizeSteps([{
      request: 'POST /reservations {"roomId":"room-1","id":"mine"}',
      response: '201 · {"roomId":"room-1","id":"mine"}',
    }])
    eq(created.response, '201 · {"roomId":"room-1","id":"mine"}')
  })

  await step('a type written in place of a value is any value', () => {
    const [created] = normalizeSteps([{
      request: 'POST /reserve {"articleId":"article-101","quantity":2}',
      response: '201 · {"quantity":2,"expiresAt":"string","label":"abc"}',
    }])
    eq(
      created.response,
      '201 · {"quantity":2,"expiresAt":"$_","label":"abc"}',
    )
  })

  await step('captures written without quotes, readable errors', () => {
    eq(
      parseRequest('PUT /bookings/$id {"id": $id, "tags": [$tag]}').body,
      '{"id": "$id", "tags": ["$tag"]}',
    )
    eq(parseResponse('200 · {"id": $id}').expect.subset, { id: '$id' })
    throws(
      () => parseRequest('POST /links {"url": "https://a.com"} {"b": 2}'),
      'corps JSON invalide dans « POST /links',
    )
  })

  await step('captures and substitutions', () => {
    const vars = {}
    eq(matchesSubset({ id: 'r-7' }, { id: '$id' }), true)
    captureVars({ id: 'r-7', n: 1 }, { id: '$id' }, vars)
    eq(substituteVars('/reservations/$id', vars), '/reservations/r-7')
    eq(matchesSubset({ id: null }, { id: '$id' }), false)
  })
})
