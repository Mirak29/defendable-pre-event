// Runs the candidate's code (C2) in a `deno` subprocess, like tournament's
// match-runner runs tactics in restricted workers: temporary folder, no
// network, env, subprocess, FFI or write access, read access limited to the
// folder, offline modules only (--cached-only), 10 s and 64 KB at most, and
// a queue so a burst of runs cannot take the whole machine.
import { join, normalize, toFileUrl } from 'jsr:@std/path'
import { makeQueue } from '/api/lib/make-queue.ts'
import { log } from '/api/lib/log.ts'
import type { CandidateFiles, TestCase, TestResult } from '/web/types.ts'
import {
  captureSkeleton,
  captureVars,
  type CaseRecord,
  judgeCase,
  parseStep,
  type RecordedResponse,
  substituteVars,
} from '/api/test-steps.ts'

export const RUN_TIMEOUT_MS = 10_000
export const OUTPUT_LIMIT = 64 * 1024
const CASE_TIMEOUT_MS = 2_000
// evaluation runs print the recorded responses: more room than a playground
const EVAL_OUTPUT_LIMIT = 4 * 1024 * 1024
const BODY_LIMIT = 32 * 1024
const MAX_FILES = 40
const MAX_FILE_SIZE = 200 * 1024

const nextSlot = makeQueue(2)
// escape sequences of terminal colors (intended control character)
// deno-lint-ignore no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g

const PERMISSIONS = [
  '--config',
  'deno.json', // written by writeWorkspace, never the candidate's (AUD-002)
  '--cached-only',
  '--no-prompt',
  '--deny-net',
  '--deny-env',
  '--deny-run',
  '--deny-ffi',
  '--deny-sys',
  '--deny-write',
]

export type OutputChunk = { text: string; stream: 'out' | 'err' }

export type SandboxRun = {
  command: string
  chunks: OutputChunk[]
  exitCode: number
  durationMs: number
  timedOut: boolean
  truncated: boolean
  /** import refused before or during the run */
  refusedImport?: string
}

export type CodeProblem = {
  file: string
  line: number
  column: number
  length: number
  message: string
  code: string // deno-ts(2322)
}

/* ---------- files ---------- */

const isSafePath = (path: string) =>
  /^(src\/)?[\w.-]+\.(ts|json|md)$/.test(path) && !path.includes('..')

export const assertFiles = (files: CandidateFiles) => {
  const entries = Object.entries(files)
  if (entries.length > MAX_FILES) throw Error('Trop de fichiers')
  for (const [path, code] of entries) {
    if (!isSafePath(path)) throw Error(`Chemin refusé : ${path}`)
    if (typeof code !== 'string' || code.length > MAX_FILE_SIZE) {
      throw Error(`Fichier trop gros : ${path}`)
    }
  }
  return files
}

// Specifiers the code may import: files of the workspace and the entries of
// deno.json that point to jsr:/npm: (the cache decides if they are offline).
const IMPORT =
  /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\s*\(\s*([^)]*)\)/g

export const findRefusedImport = (files: CandidateFiles) => {
  let map: Record<string, string> = {}
  try {
    map = JSON.parse(files['deno.json'] || '{}').imports || {}
  } catch {
    return 'deno.json invalide'
  }
  for (const [name, target] of Object.entries(map)) {
    if (!/^(jsr|npm):/.test(target)) return `${name} → ${target}`
  }
  for (const [path, code] of Object.entries(files)) {
    if (!path.endsWith('.ts')) continue
    for (const m of code.matchAll(IMPORT)) {
      const dynamic = m[3]?.trim()
      if (dynamic !== undefined && !/^['"][^'"]+['"]$/.test(dynamic)) {
        return `import(${dynamic})`
      }
      const spec = m[1] ?? m[2] ?? dynamic!.slice(1, -1)
      if (spec.startsWith('./') || spec.startsWith('../')) {
        const base = path.includes('/') ? path.replace(/\/[^/]+$/, '') : '.'
        const target = normalize(join(base, spec)).replaceAll('\\', '/')
        if (target.startsWith('..') || !(target in files)) return spec
        continue
      }
      if (spec in map || Object.keys(map).some((k) => spec.startsWith(k))) {
        continue
      }
      if (/^(jsr|npm):/.test(spec)) continue // --cached-only decides
      return spec
    }
  }
}

/**
 * The only configuration the runtime reads: the jsr:/npm: imports of the
 * candidate's deno.json. No scopes, unstable features or other options
 * (AUD-002).
 */
const trustedConfig = (files: CandidateFiles) => {
  let imports: unknown
  try {
    imports = JSON.parse(files['deno.json'] || '{}')?.imports
  } catch { /* refused by findRefusedImport */ }
  const entries = imports && typeof imports === 'object'
    ? Object.entries(imports).filter(([, target]) =>
      typeof target === 'string' && /^(jsr|npm):/.test(target)
    )
    : []
  return JSON.stringify({ imports: Object.fromEntries(entries) })
}

// configuration files Deno would read by itself: never written
const isConfigFile = (path: string) => /(^|\/)(deno|package)\.json$/.test(path)

const writeWorkspace = async (files: CandidateFiles) => {
  const dir = await Deno.makeTempDir({ prefix: 'dfd-' })
  await Deno.mkdir(join(dir, 'src'), { recursive: true })
  for (const [path, code] of Object.entries(files)) {
    if (!isConfigFile(path)) await Deno.writeTextFile(join(dir, path), code)
  }
  await Deno.writeTextFile(join(dir, 'deno.json'), trustedConfig(files))
  return dir
}

/* ---------- module graph ---------- */

const GRAPH_TIMEOUT_MS = 10_000
const REMOTE_ALLOWED = /^(https:\/\/jsr\.io\/|jsr:|npm:|node:)/

/**
 * The module loader reads the static graph of the entry points without
 * checking --allow-read (AUD-002): the server reads that graph first, without
 * running anything, from every .ts file of the workspace (any of them can be
 * an entry point, a test or a worker), and refuses any module outside it.
 */
const findOutsideModule = async (dir: string, files: CandidateFiles) => {
  const roots = Object.keys(files).filter((p) => p.endsWith('.ts'))
  if (!roots.length) return
  await Deno.mkdir(join(dir, '__dfd__'), { recursive: true })
  await Deno.writeTextFile(
    join(dir, '__dfd__', 'graph.ts'),
    roots.map((p) => `import '../${p}'\n`).join(''),
  )
  let graph: { modules?: { specifier?: unknown }[] }
  {
    using _slot = await nextSlot()
    try {
      const { stdout } = await new Deno.Command(Deno.execPath(), {
        args: [
          'info',
          '--json',
          // nothing is downloaded; a remote module cannot import a local
          // file, so the local part of the graph is complete without them
          '--no-remote',
          '--no-npm',
          '--config',
          'deno.json',
          '__dfd__/graph.ts',
        ],
        cwd: dir,
        env: { NO_COLOR: '1' },
        stdin: 'null',
        stdout: 'piped',
        stderr: 'null',
        signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
      }).output()
      graph = JSON.parse(new TextDecoder().decode(stdout))
    } catch {
      return 'graphe des modules illisible'
    }
  }
  const windows = Deno.build.os === 'windows'
  const fold = (url: string) => windows ? url.toLowerCase() : url
  const inside = fold(`${toFileUrl(await Deno.realPath(dir)).href}/`)
  for (const { specifier } of graph.modules ?? []) {
    if (typeof specifier !== 'string') return 'graphe des modules illisible'
    if (specifier.startsWith('file:')) {
      if (!fold(specifier).startsWith(inside)) return 'fichier hors du projet'
      continue
    }
    if (!REMOTE_ALLOWED.test(specifier)) return specifier
  }
}

/* ---------- process ---------- */

const readLimited = async (
  stream: ReadableStream<Uint8Array>,
  kind: OutputChunk['stream'],
  chunks: OutputChunk[],
  state: { size: number; truncated: boolean; limit: number },
) => {
  const decoder = new TextDecoder()
  for await (const bytes of stream) {
    if (state.truncated) continue // keep draining so the process can end
    // colors can be forced by the parent environment (FORCE_COLOR)
    let text = decoder.decode(bytes, { stream: true }).replace(ANSI, '')
    if (state.size + text.length > state.limit) {
      text = text.slice(0, state.limit - state.size)
      state.truncated = true
    }
    state.size += text.length
    const last = chunks.at(-1)
    last?.stream === kind
      ? last.text += text
      : chunks.push({ text, stream: kind })
  }
}

const spawn = async (
  dir: string,
  args: string[],
  command: string,
  timeoutMs = RUN_TIMEOUT_MS,
  { input, outputLimit = OUTPUT_LIMIT }: {
    input?: string // written on stdin, then closed
    outputLimit?: number
  } = {},
): Promise<SandboxRun> => {
  using _slot = await nextSlot()
  const started = performance.now()
  const child = new Deno.Command(Deno.execPath(), {
    args,
    cwd: dir,
    env: { NO_COLOR: '1', FORCE_COLOR: '0' },
    stdin: input === undefined ? 'null' : 'piped',
    stdout: 'piped',
    stderr: 'piped',
  }).spawn()
  if (input !== undefined) {
    const writer = child.stdin.getWriter()
    writer.write(new TextEncoder().encode(input))
      .then(() => writer.close())
      .catch(() => {/* the process ended before reading */})
  }
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    try {
      child.kill('SIGKILL')
    } catch { /* already exited */ }
  }, timeoutMs)
  const chunks: OutputChunk[] = []
  const state = { size: 0, truncated: false, limit: outputLimit }
  await Promise.all([
    readLimited(child.stdout, 'out', chunks, state),
    readLimited(child.stderr, 'err', chunks, state),
  ])
  const { code } = await child.status
  clearTimeout(timer)
  return {
    command,
    chunks,
    exitCode: code,
    durationMs: Math.round(performance.now() - started),
    timedOut,
    truncated: state.truncated,
  }
}

/** runs `fn` in a fresh workspace, or `onRefused` when its graph leaves it */
const inWorkspace = async <T>(
  files: CandidateFiles,
  fn: (dir: string) => Promise<T>,
  onRefused: (spec: string) => T,
) => {
  const dir = await writeWorkspace(assertFiles(files))
  try {
    const outside = await findOutsideModule(dir, files)
    if (outside) return onRefused(outside)
    return await fn(dir)
  } finally {
    Deno.remove(dir, { recursive: true }).catch((err) =>
      log.warn('sandbox-cleanup', { dir, message: String(err) })
    )
  }
}

const refused = (command: string, spec: string): SandboxRun => ({
  command,
  chunks: [],
  exitCode: 1,
  durationMs: 0,
  timedOut: false,
  truncated: false,
  refusedImport: spec,
})

const withImportCheck = (run: SandboxRun): SandboxRun => {
  const err = run.chunks.filter((c) => c.stream === 'err').map((c) => c.text)
    .join('')
  const m = err.match(
    /(?:Specifier not found in cache: "([^"]+)"|npm package not found in cache: "([^"]+)")/,
  )
  return m ? { ...run, refusedImport: m[1] ?? m[2] } : run
}

/* ---------- commands ---------- */

/** "Exécuter": `deno run playground.ts` */
export const runPlayground = (
  files: CandidateFiles,
  timeoutMs = RUN_TIMEOUT_MS,
) => {
  const command = 'deno run playground.ts'
  const spec = findRefusedImport(files)
  if (spec) return Promise.resolve(refused(command, spec))
  return inWorkspace(
    files,
    async (dir) =>
      withImportCheck(
        await spawn(
          dir,
          ['run', ...PERMISSIONS, `--allow-read=${dir}`, 'playground.ts'],
          command,
          timeoutMs,
        ),
      ),
    (spec) => refused(command, spec),
  )
}

export type OwnTestsRun = SandboxRun & { passed: number; failed: number }

/** "Mes tests": `deno test src/` */
export const runOwnTests = async (
  files: CandidateFiles,
): Promise<OwnTestsRun> => {
  const command = 'deno test src/'
  const spec = findRefusedImport(files)
  const run = spec ? refused(command, spec) : await inWorkspace(
    files,
    async (dir) =>
      withImportCheck(
        await spawn(
          dir,
          ['test', ...PERMISSIONS, `--allow-read=${dir}`, 'src/'],
          command,
        ),
      ),
    (spec) => refused(command, spec),
  )
  const text = run.chunks.map((c) => c.text).join('')
  const summary = text.match(/(\d+) passed[^|]*\| (\d+) failed/)
  return {
    ...run,
    passed: Number(summary?.[1] ?? 0),
    failed: Number(summary?.[2] ?? 0),
  }
}

/** `deno check`: type errors shown in the editor (C2) */
export const checkTypes = async (
  files: CandidateFiles,
): Promise<CodeProblem[]> => {
  const entries = Object.keys(files).filter((p) => p.endsWith('.ts'))
  if (!entries.length) return []
  // deno check runs nothing but loads the graph: its errors could quote a
  // file outside the workspace, so the same policy applies (AUD-002)
  const run = await inWorkspace(
    files,
    (dir) =>
      spawn(
        dir,
        ['check', '--config', 'deno.json', '--cached-only', ...entries],
        'deno check',
      ),
    () => undefined,
  )
  if (!run) return []
  const text = run.chunks.map((c) => c.text).join('')
  const problems = parseCheckOutput(text)
  // a failure we cannot read would hide the errors from the candidate
  if (run.exitCode !== 0 && !problems.length) {
    log.warn('sandbox-check-unparsed', { output: text.slice(0, 600) })
  }
  return problems
}

/**
 * TS2322 [ERROR]: Type 'string' is not assignable to type 'number'.
 *   const record = { clicks: "0" };
 *                    ~~~~~~
 *     at file:///tmp/dfd-x/src/links_repository.ts:27:44
 */
export const parseCheckOutput = (text: string): CodeProblem[] => {
  const problems: CodeProblem[] = []
  const blocks = text.replaceAll('\r', '').split(/\n(?=TS\d+ \[ERROR\])/)
  for (const block of blocks) {
    const head = block.match(/^(?:.*\n)*?TS(\d+) \[ERROR\]: (.+)/)
    const at = block.match(/at file:\/\/\/.*?\/dfd-[^/]+\/(.+?):(\d+):(\d+)/)
    if (!head || !at) continue
    const tilde = block.match(/\n\s*(~+)\s*\n/)
    problems.push({
      file: at[1],
      line: Number(at[2]),
      column: Number(at[3]),
      length: tilde?.[1].length ?? 1,
      message: head[2].trim(),
      code: `deno-ts(${head[1]})`,
    })
  }
  return problems
}

/* ---------- evaluation tests ---------- */

// Trust boundary (AUD-001): the candidate's code only runs in the workers,
// and a worker only records the responses of the handler. The expectations
// never enter the sandbox and the verdict is computed by the server
// (judgeCase). Whatever a worker posts is at most what a handler written on
// purpose would answer: that is what is evaluated.

// Each test runs in its own worker, so the in-memory state of the candidate's
// modules starts empty for every test (a fresh module graph per worker).
const caseWorker = `
${captureVars.toString().replace(/^/, 'const captureVars = ')}
${substituteVars.toString().replace(/^/, 'const substituteVars = ')}
const BODY_LIMIT = ${BODY_LIMIT}
// a prediction question may reuse a created id: "DELETE /bookings/$id1" is
// the id of the first created resource ($id the first one, or $bookingId)
const probe = async (handler, requests) => {
  const responses = []
  const vars = {}
  let ids = 0
  for (const r of requests) {
    const res = await handler(new Request('http://localhost' + substituteVars(r.path, vars), {
      method: r.method,
      body: r.body ? substituteVars(r.body, vars) : undefined,
      headers: r.body ? { 'content-type': 'application/json' } : undefined,
      redirect: 'manual',
    }))
    const body = await res.text()
    responses.push({ status: res.status, body: body.slice(0, BODY_LIMIT) })
    try {
      const json = JSON.parse(body)
      for (const [k, v] of Object.entries(json && typeof json === 'object' && !Array.isArray(json) ? json : {})) {
        if (!/^(id|_id|uuid)$|Id$/.test(k) || (typeof v !== 'string' && typeof v !== 'number')) continue
        if (/^(id|_id|uuid)$/.test(k)) {
          vars['id' + ++ids] = v
          vars.id ??= v
        }
        vars[k] ??= v
      }
    } catch { /* not JSON */ }
  }
  return responses
}
// the answer goes through the port received with the job, kept in this
// closure before the candidate's code is loaded: self.postMessage is ignored
self.onmessage = async ({ data, ports: [port] }) => {
  const post = (message) => port.postMessage(message)
  const responses = []
  try {
    const mod = await import('../src/app.ts')
    const handler = mod.handler ?? mod.default?.fetch
    if (data.probe) {
      post({ responses: await probe(handler, data.probe) })
      return
    }
    if (typeof handler !== 'function') return post({ responses, noHandler: true })
    // values captured by "$id" in a response, reused by the next requests
    const vars = {}
    for (const step of data.steps) {
      let res
      const path = substituteVars(step.path, vars)
      const body = step.body && substituteVars(step.body, vars)
      for (let i = 0; i < step.repeat; i++) {
        res = await handler(new Request('http://localhost' + path, {
          method: step.method,
          body,
          headers: body ? { 'content-type': 'application/json' } : undefined,
          redirect: 'manual',
        }))
      }
      const text = await res.text()
      const headers = {}
      for (const name of step.headers) {
        const value = res.headers.get(name)
        if (value !== null) headers[name] = value
      }
      responses.push({ status: res.status, headers, body: text.slice(0, BODY_LIMIT) })
      if (step.capture) {
        try { captureVars(JSON.parse(text), step.capture, vars) } catch { /* judged by the server */ }
      }
    }
    post({ responses })
  } catch (err) {
    post({ responses, error: err?.message ?? String(err) })
  }
}
`

// The main thread never loads the candidate's code. It reads a random token
// on stdin before starting any worker, and prefixes its lines with it: a
// worker cannot read it, so it cannot forge a line the server accepts.
const evalRunner = `
let input = ''
const decoder = new TextDecoder()
for await (const chunk of Deno.stdin.readable) input += decoder.decode(chunk, { stream: true })
const { token, jobs } = JSON.parse(input)
input = ''
for (const job of jobs) {
  const started = performance.now()
  const w = new Worker(new URL('./case.js', import.meta.url), { type: 'module' })
  const { port1, port2 } = new MessageChannel()
  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ timeout: true }), ${CASE_TIMEOUT_MS})
    port1.onmessage = (e) => { clearTimeout(timer); resolve({ data: e.data }) }
    w.onerror = (e) => { e.preventDefault(); clearTimeout(timer); resolve({ error: String(e.message) }) }
    w.postMessage(job.probe ? { probe: job.probe } : { steps: job.steps }, [port2])
  })
  port1.close()
  w.terminate()
  let line
  try {
    line = JSON.stringify({ id: job.id, durationMs: Math.round(performance.now() - started), ...result })
  } catch {
    line = JSON.stringify({ id: job.id, durationMs: 0, invalid: true })
  }
  console.log(token + line)
}
`

type HarnessLine = {
  id: string
  durationMs: number
  data?: unknown
  timeout?: boolean
  error?: string
  invalid?: boolean
}

/**
 * Runs the harness on the candidate's files and returns its lines by job id.
 * Lines without the token are the candidate's output; a malformed or
 * repeated line is a failed job, never a crash (AUD-001).
 */
const runHarness = async (
  files: CandidateFiles,
  jobs: { id: string }[],
  command: string,
) => {
  const token = `__DFD_${crypto.randomUUID().replaceAll('-', '')}__`
  const run = await inWorkspace<SandboxRun | string>(files, async (dir) => {
    const harness = join(dir, '__dfd__')
    await Deno.mkdir(harness, { recursive: true })
    await Deno.writeTextFile(join(harness, 'case.js'), caseWorker)
    await Deno.writeTextFile(join(harness, 'run.js'), evalRunner)
    return spawn(
      dir,
      ['run', ...PERMISSIONS, `--allow-read=${dir}`, '__dfd__/run.js'],
      command,
      RUN_TIMEOUT_MS + jobs.length * CASE_TIMEOUT_MS,
      {
        input: JSON.stringify({ token, jobs }),
        outputLimit: EVAL_OUTPUT_LIMIT,
      },
    )
  }, (spec) => spec)
  if (typeof run === 'string') {
    return {
      lines: new Map<string, HarnessLine | 'invalid'>(),
      error: `Import non autorisé : ${run}`,
    }
  }
  const lines = new Map<string, HarnessLine | 'invalid'>()
  const out = run.chunks.filter((c) => c.stream === 'out').map((c) => c.text)
    .join('')
  const ids = new Set(jobs.map((j) => j.id))
  for (const line of out.split('\n')) {
    const at = line.indexOf(token)
    if (at < 0) continue
    let parsed: HarnessLine
    try {
      parsed = JSON.parse(line.slice(at + token.length))
    } catch {
      continue
    }
    if (!ids.has(parsed?.id)) continue
    lines.set(parsed.id, lines.has(parsed.id) ? 'invalid' : parsed)
  }
  const error = run.chunks.find((c) => c.stream === 'err')?.text.split('\n')[0]
  return { lines, error }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

/** the recorded responses, or undefined when their shape is wrong */
const toResponses = (v: unknown): RecordedResponse[] | undefined => {
  if (!Array.isArray(v)) return
  const responses: RecordedResponse[] = []
  for (const r of v) {
    if (!isObject(r) || !Number.isInteger(r.status)) return
    if (typeof r.body !== 'string') return
    const headers = Object.fromEntries(
      Object.entries(isObject(r.headers) ? r.headers : {})
        .filter(([, value]) => typeof value === 'string'),
    ) as Record<string, string>
    responses.push({ status: r.status as number, headers, body: r.body })
  }
  return responses
}

const toRecord = (data: unknown): CaseRecord | undefined => {
  if (!isObject(data)) return
  const responses = toResponses(data.responses)
  if (!responses) return
  return {
    responses,
    error: data.error === undefined ? undefined : String(data.error),
    noHandler: data.noHandler === true,
  }
}

/** "Tests d'évaluation" and the hidden tests after submission (C3) */
export const runEvaluation = async (
  files: CandidateFiles,
  tests: TestCase[],
): Promise<TestResult[]> => {
  const spec = findRefusedImport(files)
  if (spec) {
    return tests.map((t) => ({
      id: t.id,
      passed: false,
      durationMs: 0,
      received: `Import non autorisé : ${spec}`,
    }))
  }
  const parsed = tests.map((t) => ({
    id: t.id,
    steps: t.steps.map((s) => ({
      ...parseStep(s),
      requestText: s.request,
      responseText: s.response,
    })),
  }))
  // the sandbox gets the requests only: no status, body or header value
  const jobs = parsed.map((t) => ({
    id: t.id,
    steps: t.steps.map(({ request, response }) => ({
      ...request,
      capture: response.expect?.kind === 'json'
        ? captureSkeleton(response.expect.subset)
        : undefined,
      headers: response.expect?.kind === 'header'
        ? [response.expect.name.toLowerCase()]
        : [],
    })),
  }))
  const { lines, error } = await runHarness(files, jobs, 'tests d’évaluation')
  return parsed.map((t): TestResult => {
    const line = lines.get(t.id)
    if (!line) {
      return {
        id: t.id,
        passed: false,
        durationMs: 0,
        received: error || 'Non exécuté',
      }
    }
    const durationMs = line === 'invalid' ? 0 : line.durationMs
    if (line === 'invalid' || line.invalid) {
      return {
        id: t.id,
        passed: false,
        durationMs,
        received: 'Sortie invalide',
      }
    }
    if (line.timeout) {
      return {
        id: t.id,
        passed: false,
        durationMs,
        received: `Arrêté après ${CASE_TIMEOUT_MS / 1000} s`,
      }
    }
    if (line.error !== undefined) {
      return {
        id: t.id,
        passed: false,
        durationMs,
        received: `Erreur : ${line.error}`,
      }
    }
    const record = toRecord(line.data)
    if (!record) {
      return {
        id: t.id,
        passed: false,
        durationMs,
        received: 'Sortie invalide',
      }
    }
    return { id: t.id, durationMs, ...judgeCase(t.steps, record) }
  })
}

export type ProbeResponse = { status: number; body: string }

/**
 * Plays requests against the candidate's handler, in one fresh worker, and
 * returns every response: the expected answer of a "Prédiction" question is
 * what the code really does (brief: QCM vérifiés par exécution).
 */
export const probeRequests = async (
  files: CandidateFiles,
  sequences: {
    id: string
    requests: { method: string; path: string; body?: string }[]
  }[],
): Promise<Record<string, ProbeResponse[] | undefined>> => {
  if (findRefusedImport(files) || !sequences.length) return {}
  const { lines } = await runHarness(
    files,
    sequences.map((s) => ({ id: s.id, probe: s.requests })),
    'questions de prédiction',
  )
  const out: Record<string, ProbeResponse[] | undefined> = {}
  for (const s of sequences) {
    const line = lines.get(s.id)
    if (!line || line === 'invalid' || !isObject(line.data)) continue
    const responses = toResponses(line.data.responses)
    // one response per request, or the question is not checked
    if (responses?.length !== s.requests.length) continue
    out[s.id] = responses.map(({ status, body }) => ({ status, body }))
  }
  return out
}
