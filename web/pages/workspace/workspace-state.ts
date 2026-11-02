// C2 workspace state, module level signals like tournament's studio. Files
// come from the candidate session; the API saves them, type-checks them
// (deno check) and runs them in the Deno sandbox (api/sandbox.ts).
import { computed, effect, signal } from '@preact/signals'
import { url } from '/web/lib/router-signal.ts'
import { api } from '/web/lib/api.ts'
import { me } from '/web/lib/candidate-store.ts'
import { demoFileOrder } from '/fixtures/demo-files.ts'
import { demoOf } from '/fixtures/demos.ts'
import type { CandidateFiles, TestResult } from '/web/types.ts'
import type { CodeProblem, OutputChunk, SandboxRun } from '/api/sandbox.ts'
import { eachSec } from '/web/lib/signals.ts'
import { setDragEvents } from '/web/lib/drag.ts'
import {
  OUTPUT_LIMIT_KB,
  type OutputLine,
  type OutputVariant,
  RUN_TIMEOUT_S,
  type RunOutput,
  runPlayground,
} from '/web/lib/workspace-runner.ts'
import type { SaveState } from '/web/ui/timer.tsx'
import { notify } from '/web/ui/notifications.tsx'
import { lang, t } from '/web/lib/i18n.ts'

/* ---------- files and auto-save ---------- */

export const files = signal<CandidateFiles>({})
const savedFiles = signal<CandidateFiles>({})
export const saveState = signal<SaveState>('saved')
const savedAt = signal(Date.now())
const loadedFor = signal(0)

export const srcFiles = computed(() =>
  Object.keys(files.value).filter((p) => p.startsWith('src/')).sort((a, b) =>
    (demoFileOrder.indexOf(a) + 1 || 99) - (demoFileOrder.indexOf(b) + 1 || 99)
  )
)
export const rootFiles = computed(() =>
  Object.keys(files.value).filter((p) => !p.startsWith('src/'))
)

/* ---------- tabs ---------- */

export const openTabs = signal<string[]>([])
export const activeFile = signal<string | null>(null)

export const openFile = (path: string) => {
  openTabs.value.includes(path) || (openTabs.value = [...openTabs.value, path])
  activeFile.value = path
}

export const closeTab = (path: string) => {
  const tabs = openTabs.value.filter((p) => p !== path)
  openTabs.value = tabs
  if (activeFile.value === path) activeFile.value = tabs.at(-1) ?? null
}

// the session's files, once per candidate
effect(() => {
  const view = me.value
  if (!view || loadedFor.peek() === view.id) return
  loadedFor.value = view.id
  files.value = view.files
  savedFiles.value = view.files
  savedAt.value = view.savedAt ?? Date.now()
  const tabs = srcFiles.peek().filter((p) => !p.endsWith('_test.ts'))
    .slice(0, 3)
  openTabs.value = tabs
  // the demo draft opens on its type error (brief C2)
  activeFile.value = tabs.find((p) => p.includes('repository')) ?? tabs[0] ??
    null
})

export const isDirty = (path: string) =>
  files.value[path] !== savedFiles.value[path]

let saveTimer: ReturnType<typeof setTimeout> | undefined
const save = async () => {
  if (me.peek()?.submittedAt) return
  const sent = files.peek()
  saveState.value = 'saving'
  try {
    const result = await api['POST/api/candidate/files'].fetch({ files: sent })
    savedFiles.value = sent
    savedAt.value = result.savedAt
    saveState.value = files.peek() === sent ? 'saved' : 'saving'
  } catch {
    // offline or server down: "Hors ligne, nouvelle tentative…"
    saveState.value = 'offline'
    clearTimeout(saveTimer)
    saveTimer = setTimeout(save, 5000)
  }
}
addEventListener('online', () => saveState.peek() === 'offline' && save())
addEventListener('offline', () => saveState.value = 'offline')

/* ---------- type errors: deno check on the server ---------- */

export const problems = signal<CodeProblem[]>([])
let checkTimer: ReturnType<typeof setTimeout> | undefined
let checkRun = 0

const check = async () => {
  const run = ++checkRun
  try {
    const found = await api['POST/api/candidate/check'].fetch({
      files: files.peek(),
    })
    if (run === checkRun) problems.value = found
  } catch { /* keep the previous problems */ }
}

const scheduleCheck = (delay = 1200) => {
  clearTimeout(checkTimer)
  checkTimer = setTimeout(check, delay)
}

// first check once the files are loaded
effect(() => {
  loadedFor.value && scheduleCheck(0)
})

export const problemsOf = (file: string | null) =>
  file ? problems.value.filter((p) => p.file === file) : []

export const updateFile = (path: string, code: string) => {
  if (files.peek()[path] === code) return
  files.value = { ...files.peek(), [path]: code }
  saveState.value = navigator.onLine ? 'saving' : 'offline'
  clearTimeout(saveTimer)
  saveTimer = setTimeout(save, 800)
  scheduleCheck()
}

export const savedAgo = computed(() => {
  const sec = Math.max(0, Math.round((eachSec.value - savedAt.value) / 1000))
  return sec < 60
    ? t(`il y a ${Math.max(sec, 1)} s`, `${Math.max(sec, 1)} s ago`)
    : t(`il y a ${Math.floor(sec / 60)} min`, `${Math.floor(sec / 60)} min ago`)
})

/** guided demo: "Charger une solution exemple" */
export const loadExampleSolution = async () => {
  // the solution of the demo in the language of the site (guided demo)
  files.value = { ...demoOf(lang.value).files }
  await save()
  scheduleCheck(0)
  await run('eval')
  const results = evalResults.peek()
  if (!results) return
  const passed = results.filter((r) => r.passed).length
  notify({
    status: passed === results.length ? 'success' : 'info',
    description: t(
      `Solution exemple chargée · ${passed}/${results.length} tests d’évaluation réussis`,
      `Example solution loaded · ${passed}/${results.length} evaluation tests passed`,
    ),
  })
}

/** "+ Nouveau fichier": always in src/, always .ts, no folders */
export const createFile = (rawName: string) => {
  const name = rawName.replace(/\.ts$/, '').replace(/[^\w-]/g, '')
  if (!name) return false
  const path = `src/${name}.ts`
  if (path in files.peek()) {
    openFile(path)
    return true
  }
  updateFile(path, `// ${name}.ts\n`)
  openFile(path)
  return true
}

/* ---------- runs, in the Deno sandbox ---------- */

export type RunKind = 'run' | 'mine' | 'eval'
export const running = signal<RunKind | null>(null)
export const bottomTab = signal<'out' | 'mine'>('out')
export const rightTab = signal<'brief' | 'tests'>('brief')
export const rightOpen = signal(true)
export const rawOpen = signal(false)
export const output = signal<RunOutput | null>(null)
export const evalResults = signal<TestResult[] | null>(null)
export const lastEvalAt = signal(0)

export type OwnTest = { name: string; ok: boolean; duration: string }
export const ownTests = signal<
  { tests: OwnTest[]; passed: number; failed: number; raw: string } | null
>(null)

export const lastEvalAgo = computed(() => {
  const min = Math.floor((eachSec.value - lastEvalAt.value) / 60_000)
  return min < 1
    ? t('il y a quelques secondes', 'a few seconds ago')
    : t(`il y a ${min} min`, `${min} min ago`)
})

const seconds = (ms: number) => {
  const s = (ms / 1000).toFixed(1)
  return `${lang.value === 'en' ? s : s.replace('.', ',')} s`
}

const textOf = (chunks: OutputChunk[]) => chunks.map((c) => c.text).join('')

/** SandboxRun → lines and status of the console (brief C2 states) */
export const toRunOutput = (run: SandboxRun): RunOutput => {
  const lines: OutputLine[] = []
  for (const chunk of run.chunks) {
    for (const text of chunk.text.replace(/\n$/, '').split('\n')) {
      lines.push({
        text,
        tone: chunk.stream === 'out'
          ? undefined
          : /^\s+at /.test(text)
          ? 'indent-error'
          : 'error',
      })
    }
  }
  const err = textOf(run.chunks.filter((c) => c.stream === 'err'))
  const status: RunOutput['status'] = run.refusedImport
    ? {
      tone: 'warn',
      icon: 'package-x',
      text: t(
        `Import non autorisé (${run.refusedImport}) : seules les dépendances listées dans deno.json sont disponibles hors ligne. Terminé en ${
          seconds(run.durationMs)
        } · code 1`,
        `Import not allowed (${run.refusedImport}): only the dependencies listed in deno.json are available offline. Finished in ${
          seconds(run.durationMs)
        } · code 1`,
      ),
    }
    : run.timedOut
    ? {
      tone: 'warn',
      icon: 'timer-off',
      text: t(
        `Arrêté après ${RUN_TIMEOUT_S} s : le programme ne s’est pas terminé. Les serveurs et les boucles infinies sont interrompus.`,
        `Stopped after ${RUN_TIMEOUT_S} s: the program did not end. Servers and infinite loops are interrupted.`,
      ),
    }
    : run.truncated
    ? {
      tone: 'warn',
      icon: 'scissors',
      text: t(
        `Sortie tronquée à ${OUTPUT_LIMIT_KB} Ko`,
        `Output cut at ${OUTPUT_LIMIT_KB} KB`,
      ),
    }
    : err.includes('Requires net access')
    ? {
      tone: 'warn',
      icon: 'circle-x',
      text: t(
        'Réseau désactivé : un serveur ne peut pas écouter ici. Appelez handler() directement depuis playground.ts.',
        'Network disabled: a server cannot listen here. Call handler() directly from playground.ts.',
      ),
    }
    : run.exitCode !== 0
    ? {
      tone: 'error',
      icon: 'circle-x',
      text: t(
        `Erreur d’exécution · terminé en ${
          seconds(run.durationMs)
        } · code ${run.exitCode}`,
        `Runtime error · finished in ${
          seconds(run.durationMs)
        } · code ${run.exitCode}`,
      ),
    }
    : {
      tone: 'ok',
      icon: 'circle-check',
      text: t(
        `Terminé en ${seconds(run.durationMs)} · code 0`,
        `Finished in ${seconds(run.durationMs)} · code 0`,
      ),
    }
  return { command: `$ ${run.command}`, lines, status }
}

const OWN_TEST = /^(.+?) \.\.\. (ok|FAILED) \(([^)]+)\)$/

const parseOwnTests = (
  run: SandboxRun & { passed: number; failed: number },
) => {
  const raw = textOf(run.chunks)
  const tests = raw.split('\n')
    .map((l) => l.trim().match(OWN_TEST))
    .filter((m): m is RegExpMatchArray => !!m)
    .map(([, name, ok, duration]) => ({ name, ok: ok === 'ok', duration }))
  return { tests, passed: run.passed, failed: run.failed, raw }
}

export const run = async (kind: RunKind) => {
  if (running.peek()) return
  // ?sortie= replays the output states of the prototype
  const variant = url.params.sortie as OutputVariant | undefined
  if (kind === 'run' && variant) {
    output.value = runPlayground(variant)
    bottomTab.value = 'out'
    return
  }
  running.value = kind
  try {
    const result = await api['POST/api/candidate/run'].fetch({
      kind,
      files: files.peek(),
    })
    savedFiles.value = files.peek()
    savedAt.value = Date.now()
    saveState.value = 'saved'
    if (result.run) {
      output.value = toRunOutput(result.run)
      bottomTab.value = 'out'
    }
    if (result.own) {
      ownTests.value = parseOwnTests(result.own)
      bottomTab.value = 'mine'
      // an import refused or a timeout is explained in the output tab
      if (result.own.refusedImport || result.own.timedOut) {
        output.value = toRunOutput(result.own)
        bottomTab.value = 'out'
      }
    }
    if (result.results) {
      evalResults.value = result.results
      lastEvalAt.value = Date.now()
      rightTab.value = 'tests'
      rightOpen.value = true
    }
  } catch (err) {
    notify({ status: 'failure', description: (err as Error).message })
  } finally {
    running.value = null
  }
}

/* ---------- bottom panel ---------- */

export const panelHeight = signal(220)
export const setPanelResizer = (ref: HTMLElement | null) => {
  if (!ref) return
  let startY = 0
  let startH = 0
  ref.addEventListener('pointerdown', (e) => {
    startY = e.clientY
    startH = panelHeight.peek()
  })
  setDragEvents(ref, 'row-resize', (e) => {
    panelHeight.value = Math.max(
      120,
      Math.min(520, startH - (e.clientY - startY)),
    )
  })
}

/* ---------- right panel (Énoncé / Tests d'évaluation) ---------- */

// about a third of the window by default (≈ 630 px on a 1920 px screen)
const MIN_RIGHT = 280
const maxRight = () => Math.max(MIN_RIGHT, Math.round(innerWidth / 2))
export const rightWidth = signal(
  Math.min(720, Math.max(360, Math.round(innerWidth / 3))),
)
export const setSideResizer = (ref: HTMLElement | null) => {
  if (!ref) return
  let startX = 0
  let startW = 0
  ref.addEventListener('pointerdown', (e) => {
    startX = e.clientX
    startW = rightWidth.peek()
  })
  setDragEvents(ref, 'col-resize', (e) => {
    // dragging to the left widens the panel
    rightWidth.value = Math.max(
      MIN_RIGHT,
      Math.min(maxRight(), startW + startX - e.clientX),
    )
  })
}

// initial output follows ?sortie= so the prototype states are reachable
effect(() => {
  const variant = url.params.sortie as OutputVariant | null
  if (!variant) return
  output.value = runPlayground(variant)
  bottomTab.value = 'out'
})
