// AI client (OpenAI-compatible chat completions) for every AI step, over two
// providers: NVIDIA (build.nvidia.com, or a Brev NIM) and Google Gemini.
// Each task is routed to the models that did best on it, for the lowest cost
// (ROUTES, measured by `deno task llm:bench`, see README). Order of attempts:
// main model → fallback model → replay cache. The replay cache holds recorded
// answers (LLM_RECORD=1) and, for the demo, the answers of the brief: without
// any key the whole journey still works, with grey "Cache de rejeu" badges.
import { ENV } from '@01edu/api/env'
import { AsyncLocalStorage } from 'node:async_hooks'
import { encodeHex } from 'jsr:@std/encoding/hex'
import { encodeBase64 } from 'jsr:@std/encoding/base64'
import { fromFileUrl } from 'jsr:@std/path'
import { log } from '/api/lib/log.ts'
import type { AiFailure, AiTrace } from '/web/types.ts'
import { replayOnly } from '/api/lib/ai-context.ts'
import { inContentLang } from '/api/lib/content-lang.ts'

/**
 * Size class of a step, kept in the cache key and used when a task has no
 * route: precise = the heavy steps, super = the quick ones, nano = the small
 * model (a Brev NIM).
 */
export type Tier = 'precise' | 'super' | 'nano'

export type Provider = 'nvidia' | 'gemini'

export type Endpoint = {
  provider: Provider
  model: string
  label: string
  where: string
  baseUrl: string
  /** Gemini thinking level: fewer hidden tokens, a faster JSON answer */
  reasoning?: 'none' | 'minimal' | 'low' | 'medium'
  /** USD per million tokens (paid tier), for the cost of a trace */
  price?: { input: number; output: number }
}

const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1'
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai'

const nvidia = (
  model: string,
  label: string,
  baseUrl = ENV('NVIDIA_BASE_URL', NVIDIA_URL),
): Endpoint => ({
  provider: 'nvidia',
  model,
  label,
  // a Brev GPU instance when the model has its own base URL
  where: baseUrl === ENV('NVIDIA_BASE_URL', NVIDIA_URL)
    ? 'build.nvidia.com'
    : 'NVIDIA Brev (GPU)',
  baseUrl,
})

const gemini = (
  model: string,
  label: string,
  price: Endpoint['price'],
  reasoning?: Endpoint['reasoning'],
): Endpoint => ({
  provider: 'gemini',
  model,
  label,
  where: 'Google AI Studio',
  baseUrl: ENV('GEMINI_BASE_URL', GEMINI_URL),
  price,
  ...(reasoning && { reasoning }),
})

/** The models a route can name; each one is overridable by environment */
export const MODELS = {
  ultra: ENV('NVIDIA_PRECISE_MODEL', 'x')
    ? nvidia(
      ENV('NVIDIA_PRECISE_MODEL', 'nvidia/nemotron-3-ultra-550b-a55b'),
      ENV('NVIDIA_PRECISE_LABEL', 'Nemotron 3 Ultra'),
    )
    // NVIDIA_PRECISE_MODEL= (empty): Super does it
    : nvidia(
      ENV('NVIDIA_SUPER_MODEL', 'nvidia/nemotron-3-super-120b-a12b'),
      'Nemotron 3 Super',
    ),
  super: nvidia(
    ENV('NVIDIA_SUPER_MODEL', 'nvidia/nemotron-3-super-120b-a12b'),
    'Nemotron 3 Super',
  ),
  // the free endpoint of Nemotron 3 Nano is deprecated on build.nvidia.com:
  // Nemotron 3.5 Lightning is the same 30B A3B size, free endpoint and NIM
  lightning: nvidia(
    ENV('NVIDIA_NANO_MODEL', 'nvidia/nemotron-3.5-lightning-30b-a3b'),
    ENV('NVIDIA_NANO_LABEL', 'Nemotron 3.5 Lightning'),
    ENV('NVIDIA_NANO_BASE_URL', '') || ENV('NVIDIA_BASE_URL', NVIDIA_URL),
  ),
  flash: gemini(
    ENV('GEMINI_FLASH_MODEL', 'gemini-3.8-flash'),
    ENV('GEMINI_FLASH_LABEL', 'Gemini 3.8 Flash'),
    { input: 0.75, output: 3.75 },
    'low',
  ),
  'flash-lite': gemini(
    ENV('GEMINI_LITE_MODEL', 'gemini-3.5-flash-lite'),
    ENV('GEMINI_LITE_LABEL', 'Gemini 3.5 Flash-Lite'),
    { input: 0.30, output: 2.50 },
  ),
  'lite-3.1': gemini(
    ENV('GEMINI_LITE31_MODEL', 'gemini-3.1-flash-lite'),
    ENV('GEMINI_LITE31_LABEL', 'Gemini 3.1 Flash-Lite'),
    { input: 0.25, output: 1.50 },
  ),
} satisfies Record<string, Endpoint>

export type ModelId = keyof typeof MODELS

/**
 * Task → models, best first (main, then fallback), measured by `deno task
 * llm:bench` on the real tasks (README « Choix des modèles »): the best
 * quality, then the fastest, then the cheapest. The fallback is on the other
 * provider when it can be: one provider down never stops a task. A model
 * without its key is skipped; a task without a route follows its tier.
 */
export const ROUTES: Record<string, ModelId[]> = {
  // R2, R3: 5/5 assessments approvable in 16 s (Ultra: 1/5 in 4 min)
  'need-analysis': ['flash-lite', 'ultra'],
  instruction: ['flash-lite', 'ultra'],
  scenario: ['flash-lite', 'ultra'],
  tests: ['flash-lite', 'ultra'],
  reference: ['flash-lite', 'ultra'],
  'reference-crash': ['flash-lite', 'ultra'],
  'reference-review': ['flash-lite', 'ultra'],
  'reference-fix': ['flash-lite', 'ultra'],
  prefill: ['super', 'flash-lite'],
  // C4: as good as Ultra, 2× faster
  analysis: ['lite-3.1', 'ultra'],
  questions: ['lite-3.1', 'ultra'],
  // never the model of the questions (avoid): Super found every key
  'double-key': ['super', 'flash-lite', 'ultra'],
  // C6: the candidate waits, on a 3 min question
  assistant: ['lite-3.1', 'super'],
  // R6: Ultra, free and right; the second key is another model
  evaluation: ['ultra', 'lite-3.1'],
  'contradiction-check': ['lite-3.1', 'super', 'ultra'],
  // U5: a scan goes to the Gemini models only
  'cv-extract': ['ultra', 'flash-lite', 'lite-3.1'],
}

/** the model of a tier (tasks without a route, tests) */
const endpoint = (tier: Tier): Endpoint =>
  tier === 'precise'
    ? MODELS.ultra
    : tier === 'super'
    ? MODELS.super
    : MODELS.lightning

/** main then fallback model of a tier, without the routes */
export const tierChain = (o: AskOptions<unknown>): Endpoint[] => {
  // default: super → precise, precise → super, nano → super; nano is never a
  // default fallback: its free endpoint takes 30 s and more (AUD-010)
  const fallback: Tier = o.fallback ??
    (o.tier === 'super' ? 'precise' : 'super')
  return [llmConfig.endpoint(o.tier), llmConfig.endpoint(fallback)]
}

/** `deno task llm:bench`: every call of a run goes to the model under test */
const forced = new AsyncLocalStorage<Endpoint[]>()
export const withModels = <T>(models: Endpoint[], fn: () => T) =>
  forced.run(models, fn)

const usable = (e: Endpoint) => !!llmConfig.keys[e.provider]

/** the models tried for a task, at most two: the route, then the tier */
export const routeChain = (o: AskOptions<unknown>): Endpoint[] => {
  const models = forced.getStore()
  if (models) return models
  const routed = (ROUTES[o.task] ?? []).map((id) => MODELS[id])
  const chain: Endpoint[] = []
  for (const e of [...routed, ...tierChain(o)]) {
    if (!usable(e) || e.label === o.avoid) continue
    // a document (a scanned CV) is read by Gemini only
    if (o.document && e.provider !== 'gemini') continue
    if (!chain.some((c) => c.model === e.model)) chain.push(e)
  }
  return chain.slice(0, 2)
}

/** one attempt of a model, for `deno task llm:bench` */
export type CallStat = {
  task: string
  model: string
  ok: boolean
  ms: number
  tokensIn: number
  tokensOut: number
  reason?: string
}

/** mutable so tests can point the client at a local mock */
export const llmConfig = {
  keys: {
    nvidia: ENV('NVIDIA_API_KEY', ''),
    gemini: ENV('GEMINI_API_KEY', ''),
  } as Record<Provider, string>,
  record: ENV('LLM_RECORD', '') === '1',
  timeoutMs: 60_000,
  endpoint,
  chain: routeChain,
  cacheDir: fromFileUrl(import.meta.resolve('../fixtures/replay-cache/')),
  onCall: undefined as ((stat: CallStat) => void) | undefined,
}

/** at least one provider key: the models are called */
export const hasAiKey = () => Object.values(llmConfig.keys).some(Boolean)

export class AiError extends Error {
  constructor(
    message: string,
    public readonly task: string,
    /** every failed attempt, shown under « Pourquoi ? » */
    public readonly failures: AiFailure[] = [],
  ) {
    super(message)
    this.name = 'AiError'
  }
}

export type Message = { role: 'system' | 'user' | 'assistant'; content: string }

export type AskOptions<T> = {
  /** short name of the step, also the cache file prefix: "generation" */
  task: string
  tier: Tier
  system: string
  prompt: string
  /** validates the model answer, throws a readable error otherwise */
  parse: (value: unknown) => T
  /** answer of the brief, served as a replay when nothing else works */
  demo?: () => T
  /** trace of the demo answer (model, tokens of the brief) */
  demoTrace?: AiTrace
  json?: boolean // default true: the answer must be a JSON value
  maxTokens?: number
  temperature?: number
  /** long answers (tests, questions) need more than the default 60 s */
  timeoutMs?: number
  /** called before trying the fallback model (amber banner, brief §2.13) */
  onFallback?: (error: string) => void
  /** model tried when the main one fails (default: the other of super/nano) */
  fallback?: Tier
  /**
   * background jobs nobody waits for second by second (generation): an
   * overloaded endpoint gets several spaced retries instead of one
   */
  patient?: boolean
  /** label of a model to skip: a second key never asks the first model */
  avoid?: string
  /** personal data (a CV): never written to the replay cache */
  personal?: boolean
  /** a file the model reads itself (a scanned CV): Gemini models only */
  document?: { mime: string; data: Uint8Array }
}

export type AiResult<T> = { data: T; trace: AiTrace }

type Cached = { data: unknown; trace: AiTrace }

const cacheKey = async (o: AskOptions<unknown>) => {
  const text = JSON.stringify([o.tier, o.system, o.prompt])
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  )
  return `${o.task}-${encodeHex(hash).slice(0, 16)}`
}

const readCache = async (key: string): Promise<Cached | undefined> => {
  try {
    return JSON.parse(
      await Deno.readTextFile(`${llmConfig.cacheDir}${key}.json`),
    )
  } catch {
    return undefined
  }
}

const writeCache = async (key: string, value: Cached) => {
  await Deno.mkdir(llmConfig.cacheDir, { recursive: true })
  await Deno.writeTextFile(
    `${llmConfig.cacheDir}${key}.json`,
    JSON.stringify(value, null, 2),
  )
}

/** from the first [ or { to the last ] or }, undefined when there is none */
const jsonSlice = (body: string) => {
  const start = body.search(/[[{]/)
  if (start < 0) return
  const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'))
  return body.slice(start, end + 1)
}

const parseRelaxed = (json: string) => {
  try {
    return JSON.parse(json)
  } catch (err) {
    // a trailing comma, a frequent slip of the models: {"a": 1,} [1, 2,]
    const relaxed = json.replace(/,(\s*[}\]])/g, '$1')
    if (relaxed === json) throw err
    return JSON.parse(relaxed)
  }
}

/** JSON of a model answer: without <think> blocks nor ```json fences */
export const extractJson = (content: string) => {
  const text = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  // the whole answer first: a question may quote a ```typescript block, whose
  // fence is not the envelope of the answer (LIVE-005)
  try {
    return JSON.parse(text)
  } catch { /* prose or fences around */ }
  const outer = text.match(/```(?:json)?\s*([\s\S]*)```/)?.[1] // widest
  const inner = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] // first block
  const main = jsonSlice((inner ?? text).trim())
  if (main === undefined) throw Error('Aucun JSON dans la réponse')
  let error: unknown
  try {
    return parseRelaxed(main)
  } catch (err) {
    error = err
  }
  for (const body of [outer, text]) {
    const json = body === undefined ? undefined : jsonSlice(body.trim())
    if (json === undefined || json === main) continue
    try {
      return parseRelaxed(json)
    } catch { /* the error of the main reading is reported */ }
  }
  throw error
}

const REASONING_TIMEOUT_MS = 480_000

class HttpError extends Error {
  constructor(public readonly status: number, body: string) {
    super(`${status} ${body}`)
  }
}

/** an answer that does not pass the validator of the step */
class InvalidAnswer extends Error {}

/** a model that always reasons (Kimi K3): minutes, and tokens to think */
const reasons = (e: Endpoint) =>
  e.provider === 'nvidia' && !e.model.startsWith('nvidia/')

const timeoutOf = (e: Endpoint, o: AskOptions<unknown>) =>
  reasons(e)
    ? Math.max(o.timeoutMs ?? 0, REASONING_TIMEOUT_MS)
    : o.timeoutMs ?? llmConfig.timeoutMs

/** Why a call failed, in words a recruiter reads: "service surchargé (503)" */
export const failureReason = (err: unknown, timeoutMs?: number): string => {
  if (err instanceof HttpError) {
    const s = err.status
    return s === 429
      ? 'trop de requêtes (429)'
      : OVERLOADED.has(s)
      ? `service surchargé (${s})`
      : s === 401 || s === 403
      ? `clé refusée (${s})`
      : s === 404
      ? 'modèle introuvable (404)'
      : s < 500
      ? `requête refusée (${s})`
      : `erreur du service (${s})`
  }
  const message = err instanceof Error ? err.message : String(err)
  if (err instanceof InvalidAnswer) {
    return `réponse inexploitable : ${message.slice(0, 100)}`
  }
  if (
    err instanceof Error &&
    (err.name === 'TimeoutError' || /timeout|timed out/i.test(message))
  ) {
    return timeoutMs
      ? `délai dépassé (${Math.round(timeoutMs / 1000)} s)`
      : 'délai dépassé'
  }
  if (err instanceof TypeError) return 'réseau indisponible'
  return message.slice(0, 120)
}

type Note = (e: Endpoint, err: unknown, since: number) => void

// free endpoints get overloaded: a short retry before the fallback model,
// or spaced ones (×1, ×4, ×10 the delay) for a patient background job
const OVERLOADED = new Set([429, 502, 503, 504])
export const retryDelay = { ms: 2000 }

const completeWithRetry = async (
  e: Endpoint,
  messages: Message[],
  o: AskOptions<unknown>,
  note: Note,
) => {
  const waits = o.patient ? [1, 4, 10] : [1]
  for (let i = 0;; i++) {
    const since = performance.now()
    try {
      return await complete(e, messages, o)
    } catch (err) {
      const overloaded = err instanceof HttpError && OVERLOADED.has(err.status)
      if (!overloaded || i >= waits.length) throw err
      note(e, err, since) // the last one is noted by ask()
      await new Promise((r) => setTimeout(r, retryDelay.ms * waits[i]))
    }
  }
}

/** What a page shows when every model failed: readable, no raw JSON */
export const aiErrorText = (err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  // not a model failure (sandbox, data…): said as it is (AUD-006)
  if (!(err instanceof AiError) && !/\b(429|5\d\d)\b|timeout/i.test(message)) {
    return `Erreur de traitement : ${message.slice(0, 160)}`
  }
  if (
    /\b(429|502|503|504)\b|overloaded|rate limit|surchargé|trop de requêtes/i
      .test(message)
  ) {
    return 'Les modèles sont surchargés en ce moment (points d’accès gratuits). Réessayez dans quelques minutes.'
  }
  if (/timeout|timed out|aborted|délai dépassé/i.test(message)) {
    return 'Le modèle n’a pas répondu à temps. Réessayez dans quelques minutes.'
  }
  if (/_API_KEY/.test(message)) return message
  // the attempts are listed under « Pourquoi ? »: no need to repeat them
  if (err instanceof AiError && err.failures.length) {
    return 'Le modèle n’a pas donné de réponse exploitable.'
  }
  return `Le modèle n’a pas donné de réponse exploitable (${
    message.slice(0, 160)
  }).`
}

type Completion = {
  choices: { message: { content: string | null } }[]
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens?: number
  }
}

/** the request body of a provider (both speak OpenAI chat completions) */
const requestBody = (
  e: Endpoint,
  messages: Message[],
  o: AskOptions<unknown>,
) => {
  const common = {
    model: e.model,
    messages,
    temperature: o.temperature ?? 0.2,
  }
  if (e.provider === 'gemini') {
    return {
      ...common,
      // the thinking tokens count in the output: room for them
      max_tokens: (o.maxTokens ?? 4096) + (e.reasoning ? 8192 : 0),
      ...(e.reasoning && { reasoning_effort: e.reasoning }),
      ...(o.json !== false && { response_format: { type: 'json_object' } }),
    }
  }
  const nemotron = e.model.startsWith('nvidia/')
  return {
    ...common,
    // its reasoning counts in the output tokens
    max_tokens: reasons(e)
      ? Math.max(o.maxTokens ?? 0, 16_384)
      : o.maxTokens ?? 4096,
    // Nemotron reasons by default: not needed for JSON answers, and slower
    ...(nemotron && { chat_template_kwargs: { enable_thinking: false } }),
    // JSON mode: the endpoint constrains the output to valid JSON (a quote
    // of code with its own quotes no longer breaks the answer)
    ...(nemotron && o.json !== false &&
      { response_format: { type: 'json_object' } }),
  }
}

type GeminiAnswer = {
  candidates?: { content?: { parts?: { text?: string }[] } }[]
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    thoughtsTokenCount?: number
  }
}

/** Gemini's own API, which reads a PDF or an image given inline */
const completeDocument = async (
  e: Endpoint,
  messages: Message[],
  o: AskOptions<unknown>,
  document: { mime: string; data: Uint8Array },
) => {
  const base = e.baseUrl.replace(/\/openai\/?$/, '')
  const res = await fetch(`${base}/models/${e.model}:generateContent`, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutOf(e, o)),
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': llmConfig.keys[e.provider],
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: o.system }] },
      contents: messages.filter((m) => m.role !== 'system').map((m, i) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [
          ...(i === 0
            ? [{
              inline_data: {
                mime_type: document.mime,
                data: encodeBase64(document.data),
              },
            }]
            : []),
          { text: m.content },
        ],
      })),
      generationConfig: {
        temperature: o.temperature ?? 0.2,
        maxOutputTokens: (o.maxTokens ?? 4096) + 8192,
        ...(o.json !== false && { responseMimeType: 'application/json' }),
      },
    }),
  })
  if (!res.ok) {
    throw new HttpError(res.status, (await res.text()).slice(0, 200))
  }
  const body = await res.json() as GeminiAnswer
  const usage = body.usageMetadata
  return {
    content: body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '')
      .join('') ?? '',
    tokensIn: usage?.promptTokenCount ?? 0,
    tokensOut: (usage?.candidatesTokenCount ?? 0) +
      (usage?.thoughtsTokenCount ?? 0),
  }
}

const complete = async (
  e: Endpoint,
  messages: Message[],
  o: AskOptions<unknown>,
) => {
  if (o.document) return completeDocument(e, messages, o, o.document)
  const res = await fetch(`${e.baseUrl}/chat/completions`, {
    method: 'POST',
    // a reasoning model takes minutes: precision first (it is on long jobs)
    signal: AbortSignal.timeout(timeoutOf(e, o)),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${llmConfig.keys[e.provider]}`,
    },
    body: JSON.stringify(requestBody(e, messages, o)),
  })
  if (!res.ok) {
    throw new HttpError(res.status, (await res.text()).slice(0, 200))
  }
  const body = await res.json() as Completion
  const usage = body.usage
  return {
    content: body.choices[0]?.message.content ?? '',
    tokensIn: usage?.prompt_tokens ?? 0,
    // hidden thinking tokens are billed as output: total - prompt
    tokensOut: Math.max(
      usage?.completion_tokens ?? 0,
      (usage?.total_tokens ?? 0) - (usage?.prompt_tokens ?? 0),
    ),
  }
}

/** One model: an invalid answer gets one retry with the validation error */
const attempt = async <T>(
  e: Endpoint,
  o: AskOptions<T>,
  note: Note,
  usage: { tokensIn: number; tokensOut: number },
): Promise<AiResult<T>> => {
  const { label, where } = e
  const messages: Message[] = [
    { role: 'system', content: o.system },
    { role: 'user', content: o.prompt },
  ]
  const started = performance.now()
  let tokensIn = 0
  let tokensOut = 0
  let lastError = ''
  for (let i = 0; i < 2; i++) {
    const since = performance.now()
    const answer = await completeWithRetry(
      e,
      messages,
      o as AskOptions<unknown>,
      note,
    )
    tokensIn += answer.tokensIn
    tokensOut += answer.tokensOut
    Object.assign(usage, { tokensIn, tokensOut })
    try {
      const value = o.json === false
        ? answer.content.trim()
        : extractJson(answer.content)
      const data = o.parse(value)
      return {
        data,
        trace: {
          model: label,
          where,
          latencyMs: Math.round(performance.now() - started),
          tokensIn,
          tokensOut,
          at: new Date().toISOString(),
        },
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      // the first one is corrected by the model, the last one by ask()
      if (i === 0) note(e, new InvalidAnswer(lastError), since)
      messages.push(
        { role: 'assistant', content: answer.content },
        {
          role: 'user',
          content:
            `Ta réponse est invalide : ${lastError}. Renvoie uniquement le JSON corrigé.`,
        },
      )
    }
  }
  throw new InvalidAnswer(lastError)
}

const replayTrace = (tier: Tier, from?: AiTrace): AiTrace => ({
  model: from?.model ?? llmConfig.endpoint(tier).label,
  where: from?.where ?? llmConfig.endpoint(tier).where,
  latencyMs: 100,
  tokensIn: from?.tokensIn ?? 0,
  tokensOut: from?.tokensOut ?? 0,
  at: new Date().toISOString(),
  replay: true,
})

/**
 * `withDemo`: only without key. With a key, the answer of the brief would
 * not match the recruiter's input (another job, another code): a recorded
 * answer to the same request, or an error the page offers to retry.
 */
const replay = async <T>(key: string, o: AskOptions<T>, withDemo: boolean) => {
  const cached = await readCache(key)
  if (cached) {
    return {
      data: o.parse(cached.data),
      trace: replayTrace(o.tier, cached.trace),
    }
  }
  if (withDemo && o.demo) {
    return { data: o.demo(), trace: replayTrace(o.tier, o.demoTrace) }
  }
}

export const ask = async <T>(asked: AskOptions<T>): Promise<AiResult<T>> => {
  // an English assessment: every step writes in English
  const o = { ...asked, system: inContentLang(asked.system) }
  const key = await cacheKey(o as AskOptions<unknown>)
  const chain = llmConfig.chain(o as AskOptions<unknown>)
    .filter((e) => llmConfig.keys[e.provider])
    // a document is read by Gemini only
    .filter((e) => !o.document || e.provider === 'gemini')
  // no key, or the demo company (api/lib/ai-context.ts): replay only
  if (!chain.length || replayOnly()) {
    const result = o.personal ? undefined : await replay(key, o, true)
    if (result) return result
    throw new AiError(
      replayOnly()
        ? 'Espace démo : réponses rejouées, aucune réponse enregistrée pour cette étape'
        : 'Aucune clé NVIDIA_API_KEY ni GEMINI_API_KEY et pas de réponse en cache',
      o.task,
    )
  }
  const failures: AiFailure[] = []
  const note: Note = (e, err, since) => {
    const reason = failureReason(err, timeoutOf(e, o as AskOptions<unknown>))
    const detail = (err instanceof Error ? err.message : String(err))
      .slice(0, 200)
    failures.push({
      model: e.label,
      reason,
      detail,
      ms: Math.round(performance.now() - since),
    })
    log.warn('llm-attempt-failed', {
      task: o.task,
      model: e.model,
      reason,
      detail,
    })
  }
  const withFailures = (result: AiResult<T>) =>
    failures.length
      ? { ...result, trace: { ...result.trace, failures: [...failures] } }
      : result
  for (const [i, e] of chain.entries()) {
    const since = performance.now()
    const usage = { tokensIn: 0, tokensOut: 0 }
    const stat = (ok: boolean, reason?: string) =>
      llmConfig.onCall?.({
        task: o.task,
        model: e.label,
        ok,
        ms: Math.round(performance.now() - since),
        ...usage,
        ...(reason && { reason }),
      })
    try {
      const result = await attempt(e, o, note, usage)
      stat(true)
      if (llmConfig.record && !o.personal) await writeCache(key, result)
      return withFailures(result)
    } catch (err) {
      note(e, err, since)
      const last = failures.at(-1)!
      stat(false, last.reason)
      if (i === 0) o.onFallback?.(`${last.model} : ${last.reason}`)
    }
  }
  const result = o.personal ? undefined : await replay(key, o, false)
  if (result) return withFailures(result)
  throw new AiError(
    failures.map((f) => `${f.model} : ${f.reason}`).join(' ; '),
    o.task,
    failures,
  )
}
