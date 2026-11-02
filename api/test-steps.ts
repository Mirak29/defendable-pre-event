// Evaluation tests are written as readable steps (R4 "Détail du test"):
//   request  "POST /links {"url":"https://a.com"}"  or  "GET /promo (×2)"
//   response "201", "200 · {"clicks":2}", "302 · Location: https://a.com",
//            "201 · alias : chaîne non vide"
// This module turns them into checks the sandbox can run. Pure functions,
// shared with the LLM validation (generated tests must parse).
import type { TestStep } from '/web/types.ts'

export type ParsedRequest = {
  method: string
  path: string
  body?: string
  repeat: number
}

export type Expectation =
  | { kind: 'json'; subset: Record<string, unknown> | unknown[] }
  | { kind: 'header'; name: string; value: string }
  | { kind: 'non-empty'; field: string }

export type ParsedResponse = { status: number; expect?: Expectation }

export type ParsedStep = { request: ParsedRequest; response: ParsedResponse }

// the path may hold spaces ("?salle=Salle C"): it ends at the body or (×N)
const REQUEST =
  /^(GET|POST|PUT|PATCH|DELETE) (\/[^{]*?)(?: (\{.*\}))?(?: \(×(\d+)\))?$/
const RESPONSE = /^(\d{3})(?: · (.+))?$/

/** a capture written without quotes ({"id": $id}) is a quoted one */
export const quoteCaptures = (json: string) =>
  json.replace(/([:[,]\s*)\$(\w+)(?=\s*[,}\]])/g, '$1"$$$2"')

export const parseRequest = (text: string): ParsedRequest => {
  const m = text.trim().match(REQUEST)
  if (!m) throw Error(`requête illisible : ${text}`)
  const [, method, rawPath, rawBody, repeat] = m
  const body = rawBody && quoteCaptures(rawBody)
  if (body) {
    try {
      JSON.parse(body)
    } catch (err) {
      // the text of the request, so the model can correct it
      throw Error(
        `corps JSON invalide dans « ${text.slice(0, 160)} » : ${
          (err as Error).message
        }`,
      )
    }
  }
  const path = rawPath.trim().replaceAll(' ', '%20')
  return { method, path, body, repeat: Number(repeat || 1) }
}

const parseExpectation = (text: string): Expectation => {
  if (text.startsWith('{') || text.startsWith('[')) {
    const subset = JSON.parse(quoteCaptures(text))
    if (!subset || typeof subset !== 'object') {
      throw Error(`objet ou tableau JSON attendu : ${text}`)
    }
    return { kind: 'json', subset }
  }
  // « alias : chaîne non vide », or « alias: non-empty string » (English)
  const nonEmpty = text.match(
    /^(\w+) ?: (?:chaîne non vide|non-empty string)$/,
  )
  if (nonEmpty) return { kind: 'non-empty', field: nonEmpty[1] }
  const header = text.match(/^([\w-]+): (.+)$/)
  if (header) return { kind: 'header', name: header[1], value: header[2] }
  throw Error(`attendu illisible : ${text}`)
}

export const parseResponse = (text: string): ParsedResponse => {
  const m = text.trim().match(RESPONSE)
  if (!m) throw Error(`réponse illisible : ${text}`)
  return {
    status: Number(m[1]),
    expect: m[2] ? parseExpectation(m[2]) : undefined,
  }
}

export const parseStep = (step: TestStep): ParsedStep => ({
  request: parseRequest(step.request),
  response: parseResponse(step.response),
})

// captureVars and substituteVars also run inside the sandbox worker (their
// source is injected by api/sandbox.ts): they must stay self-contained. The
// verdict (judgeCase, matchesSubset) is only computed by the server (AUD-001).

/**
 * Recursive subset match: every key of `subset` is found in `value`; every
 * item of an expected array is found in the received array ([] = empty).
 * `"$id"` (or `"$"`) matches any value: ids and dates are chosen by the
 * candidate's code, not by the test.
 */
export const matchesSubset = (value: unknown, subset: unknown): boolean => {
  if (typeof subset === 'string' && /^\$\w*$/.test(subset)) {
    return value !== undefined && value !== null
  }
  if (subset === null || typeof subset !== 'object') {
    return Object.is(value, subset)
  }
  if (Array.isArray(subset)) {
    if (!Array.isArray(value)) return false
    if (!subset.length) return !value.length
    return subset.every((item) => value.some((v) => matchesSubset(v, item)))
  }
  if (!value || typeof value !== 'object') return false
  return Object.entries(subset).every(([k, v]) =>
    matchesSubset((value as Record<string, unknown>)[k], v)
  )
}

/** `{"id":"$id"}` against `{"id":7}` stores `id = 7` for the next steps */
export const captureVars = (
  value: unknown,
  subset: unknown,
  vars: Record<string, unknown>,
) => {
  if (typeof subset === 'string') {
    const name = subset.match(/^\$(\w+)$/)?.[1]
    if (name && name !== '_' && !(name in vars)) vars[name] = value
    return
  }
  if (!subset || typeof subset !== 'object' || !value) return
  if (typeof value !== 'object' || Array.isArray(subset)) return
  for (const [k, v] of Object.entries(subset)) {
    captureVars((value as Record<string, unknown>)[k], v, vars)
  }
}

/** `DELETE /reservations/$id` → `DELETE /reservations/7` */
export const substituteVars = (text: string, vars: Record<string, unknown>) =>
  text.replace(
    /\$(\w+)/g,
    (m, name) => name in vars ? encodeURIComponent(String(vars[name])) : m,
  )

/**
 * What the sandbox needs to capture `$id` without the expected values:
 * `{"id":"$id","url":"https://a.com"}` → `{"id":"$id"}`, arrays dropped
 * (captureVars ignores them). Undefined when there is nothing to capture.
 */
export const captureSkeleton = (subset: unknown): unknown => {
  if (typeof subset === 'string') {
    return /^\$\w+$/.test(subset) && subset !== '$_' ? subset : undefined
  }
  if (!subset || typeof subset !== 'object' || Array.isArray(subset)) return
  const kept = Object.entries(subset)
    .map(([k, v]) => [k, captureSkeleton(v)] as const)
    .filter(([, v]) => v !== undefined)
  return kept.length ? Object.fromEntries(kept) : undefined
}

/** A response as recorded by the sandbox (headers: lower-case names) */
export type RecordedResponse = {
  status: number
  headers: Record<string, string>
  body: string
}

/** What the sandbox recorded for one test, step by step */
export type CaseRecord = {
  responses: RecordedResponse[]
  error?: string // the code threw after these responses
  noHandler?: boolean
}

export type JudgedStep = ParsedStep & {
  requestText: string
  responseText: string
}

/**
 * The verdict of one test, computed by the server from the recorded
 * responses: the expectations never enter the sandbox (AUD-001).
 */
export const judgeCase = (
  steps: JudgedStep[],
  record: CaseRecord,
): {
  passed: boolean
  expected?: string
  received?: string
  request?: string
} => {
  if (record.noHandler) {
    return {
      passed: false,
      received: 'src/app.ts n’exporte pas de fonction handler(req)',
    }
  }
  const vars: Record<string, unknown> = {}
  for (const [i, { response, requestText, responseText }] of steps.entries()) {
    const res = record.responses[i]
    if (!res) {
      return {
        passed: false,
        received: record.error !== undefined
          ? `Erreur : ${record.error}`
          : 'Non exécuté',
      }
    }
    const fail = (detail?: string) => ({
      passed: false,
      expected: responseText,
      received: detail ? `${res.status} · ${detail}` : String(res.status),
      request: substituteVars(requestText, vars),
    })
    if (res.status !== response.status) return fail()
    const e = response.expect
    if (!e) continue
    if (e.kind === 'header') {
      const v = res.headers[e.name.toLowerCase()]
      if (v !== e.value) return fail(`${e.name}: ${v ?? '(absent)'}`)
      continue
    }
    let json: unknown
    try {
      json = JSON.parse(res.body)
    } catch {
      return fail(res.body.slice(0, 200) || '(corps vide)')
    }
    if (e.kind === 'json' && !matchesSubset(json, e.subset)) {
      return fail(JSON.stringify(json).slice(0, 200))
    }
    if (e.kind === 'json') captureVars(json, e.subset, vars)
    const field = e.kind === 'non-empty' &&
      (json as Record<string, unknown> | null)?.[e.field]
    if (e.kind === 'non-empty' && !(typeof field === 'string' && field)) {
      return fail(JSON.stringify(json).slice(0, 200))
    }
  }
  return { passed: true }
}

/* ---------- normalization of the tests written by the model ---------- */

const ERROR_KEYS = /^(error|erreur|message|detail|details)$/i
// a type written in place of a value: {"expiresAt":"string"}
const PLACEHOLDER =
  /^(string|number|integer|boolean|uuid|date|iso ?8601|<[^>]*>|\.\.\.|…)$/i

/**
 * Tests start from an empty state and cannot know what the candidate's code
 * generates nor how it words its errors:
 * - an `id` generated by the server becomes a capture `"$id"`, and its
 *   literal value in the following paths becomes `$id` (a `roomId` or any
 *   value sent in the request stays as is: the test chose it);
 * - an error message becomes "any value", like an id inside a list or a
 *   type written in place of a value ("expiresAt": "string").
 */
export const normalizeSteps = (steps: TestStep[]): TestStep[] => {
  const literals = new Map<string, string>() // "3" → "id"
  let sent = '' // body of the current request: its values are the test's
  const rewrite = (value: unknown, key?: string, inList = false): unknown => {
    if (Array.isArray(value)) return value.map((v) => rewrite(v, key, true))
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, rewrite(v, k, inList)]),
      )
    }
    if (key && ERROR_KEYS.test(key) && typeof value === 'string') return '$_'
    if (typeof value === 'string' && PLACEHOLDER.test(value)) return '$_'
    const isId = key && /^(id|_id|uuid)$/i.test(key) &&
      (typeof value === 'number' || typeof value === 'string') &&
      !String(value).startsWith('$') &&
      !sent.includes(JSON.stringify(value))
    if (!isId) return value
    if (inList) return '$_'
    const name = literals.get(String(value)) ??
      (literals.size ? `${key}${literals.size + 1}` : key)
    literals.set(String(value), name)
    return `$${name}`
  }
  return steps.map(({ request, response }) => {
    sent = request.slice(request.indexOf('{'))
    const [head, ...rest] = request.split(' ')
    const path = rest[0] ?? ''
    const renamed = path.split('/').map((segment) => {
      const [bare, query] = segment.split('?')
      const name = literals.get(bare)
      return name
        ? `$${name}${query !== undefined ? `?${query}` : ''}`
        : segment
    }).join('/')
    const nextRequest = [head, renamed, ...rest.slice(1)].join(' ')
    const m = response.match(/^(\d{3}) · ([[{].*)$/)
    if (!m) return { request: nextRequest, response }
    try {
      const json = rewrite(JSON.parse(quoteCaptures(m[2])))
      return {
        request: nextRequest,
        response: `${m[1]} · ${JSON.stringify(json)}`,
      }
    } catch {
      return { request: nextRequest, response }
    }
  })
}
