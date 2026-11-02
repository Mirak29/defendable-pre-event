import { computed, effect, signal } from '@preact/signals'
import { CodeJar } from '/web/vendor/codejar/codejar.js'
import {
  highlightCode,
  highlightProblems,
  setupTokenHighlights,
} from '/web/lib/code-highlight.ts'
import {
  activeFile,
  closeTab,
  files,
  isDirty,
  openFile,
  openTabs,
  problemsOf,
  updateFile,
} from '/web/pages/workspace/workspace-state.ts'
import { FileIcon } from '/web/pages/workspace/file-explorer.tsx'
import { CircleX, X } from '/web/assets/icons.tsx'
import { t } from '/web/lib/i18n.ts'

/* ---------- CodeJar, wired like tournament's editor-state.ts ---------- */

const editorElem = signal<HTMLDivElement | null>(null)
const setEditorElem = (elem: HTMLDivElement | null) => {
  editorElem.value = elem
}

const highlight = (el: HTMLElement) => {
  const file = activeFile.peek() ?? ''
  const code = el.textContent ?? ''
  highlightCode(el, code, file)
  // last deno check of the server, refreshed shortly after typing
  highlightProblems(el, code, problemsOf(file))
}

const editor = computed(() => {
  if (editorElem.value === null) return null
  setupTokenHighlights()
  const jar = CodeJar(editorElem.value, highlight, {
    tab: '  ',
    indentOn: /[(\[{]$/,
    spellcheck: false,
    catchTab: true,
    preserveIdent: true,
    addClosing: true,
    history: true,
  })
  // CodeJar sets overflow-y: auto; the parent already scrolls with the
  // line numbers, so a second scrollbar would appear inside the editor
  editorElem.value.style.overflowY = 'visible'
  jar.onUpdate((code: string) => {
    const file = activeFile.peek()
    file && updateFile(file, code)
  })
  return jar
})

effect(() => {
  const current = editor.value
  return () => current?.destroy()
})

// switching tabs, or files replaced from outside (the example solution of the
// guided demo), loads the file in the editor; typing leaves it as it is
effect(() => {
  const jar = editor.value
  const file = activeFile.value
  if (!jar || !file) return
  const code = files.value[file] ?? ''
  if (jar.toString() !== code) jar.updateCode(code)
})

// a new deno check result: underline the problems of the open file
effect(() => {
  const el = editorElem.value
  const found = problemsOf(activeFile.value)
  if (el && editor.value) highlightProblems(el, el.textContent ?? '', found)
})

const lineCount = computed(() =>
  (files.value[activeFile.value ?? ''] ?? '').split('\n').length
)

const problemOpen = signal(true)

/* ---------- UI ---------- */

const Tabs = () => (
  <div
    class='no-scrollbar'
    tw='h-9 flex-none flex bg-surface-sunken border-b border-border-primary overflow-x-auto overflow-y-hidden'
  >
    {openTabs.value.map((path) => {
      const on = path === activeFile.value
      const name = path.split('/').pop()
      return (
        <div
          key={path}
          tw={[
            'flex items-center gap-2 pl-3 pr-2 text-[12.5px] whitespace-nowrap border-r border-border-primary',
            on
              ? 'bg-code-bg text-content-primary shadow-[inset_0_2px_0_var(--color-accent)] -mb-px'
              : 'text-content-secondary',
          ]}
        >
          <button
            type='button'
            onClick={() => openFile(path)}
            tw='flex items-center gap-1.5 cursor-pointer'
          >
            <FileIcon path={path} />
            {name}
          </button>
          {isDirty(path) && (
            <span
              title={t('Modification non enregistrée', 'Unsaved change')}
              tw='w-[7px] h-[7px] rounded-full bg-content-secondary'
            />
          )}
          <button
            type='button'
            aria-label={t(`Fermer l’onglet ${name}`, `Close the ${name} tab`)}
            onClick={() => closeTab(path)}
            tw='w-[18px] h-[18px] rounded inline-flex items-center justify-center text-content-tertiary hover:bg-surface-hover hover:text-content-primary cursor-pointer'
          >
            <X tw='w-3 h-3' />
          </button>
        </div>
      )
    })}
  </div>
)

const ProblemButton = () => {
  const list = problemsOf(activeFile.value)
  if (!list.length) return null
  return (
    <button
      type='button'
      onClick={() => problemOpen.value = !problemOpen.value}
      aria-expanded={problemOpen.value}
      tw='inline-flex items-center gap-1 font-main font-medium text-[11.5px] text-err cursor-pointer'
    >
      <CircleX tw='w-[13px] h-[13px]' />
      {list.length} {t(
        `problème${list.length > 1 ? 's' : ''}`,
        `problem${list.length > 1 ? 's' : ''}`,
      )}
    </button>
  )
}

const ProblemTooltip = () => {
  const file = activeFile.value
  const [p] = problemsOf(file)
  if (!p || !problemOpen.value) return null
  return (
    <div
      role='tooltip'
      tw='absolute right-4 top-2 w-[470px] max-w-[calc(100%-32px)] bg-surface-elevated border border-border-strong rounded-md shadow-[var(--shadow-lg)] text-[12.5px] z-10'
    >
      <div tw='flex gap-2 px-3 py-[9px] border-b border-border-primary'>
        <CircleX tw='w-[15px] h-[15px] flex-none mt-px text-err' />
        <div tw='font-mono text-[12px] leading-[1.5]'>
          {p.message}
          <span tw='block text-content-tertiary'>
            {file?.split('/').pop()}({p.line},{p.column}) · {p.code}
          </span>
        </div>
      </div>
    </div>
  )
}

/** Center of C2: tabs, breadcrumb, CodeJar editor with line numbers */
export const EditorPanel = () => {
  const file = activeFile.value
  return (
    <section tw='flex-1 min-w-0 flex flex-col bg-code-bg'>
      <Tabs />
      {file
        ? (
          <>
            <div tw='h-[26px] flex-none flex items-center gap-1.5 px-4 font-mono text-[12px] text-content-tertiary'>
              {file.split('/').join('  ›  ')}
              <span tw='flex-1' />
              <ProblemButton />
            </div>
            <div tw='relative flex-1 min-h-0'>
              <div tw='absolute inset-0 overflow-auto flex font-mono text-[12.5px] leading-[20px]'>
                <div
                  aria-hidden
                  tw='flex-none w-[52px] pr-[18px] pt-1.5 text-right text-code-ln select-none'
                >
                  {Array.from(
                    { length: lineCount.value },
                    (_, i) => <div key={i}>{i + 1}</div>,
                  )}
                </div>
                <div
                  ref={setEditorElem}
                  aria-label={t(`Éditeur : ${file}`, `Editor: ${file}`)}
                  tw='flex-1 min-w-0 pt-1.5 pr-4 text-code-text focus:outline-none'
                  style={{
                    whiteSpace: 'pre',
                    tabSize: 2,
                    caretColor: 'var(--color-accent)',
                  }}
                />
              </div>
              <ProblemTooltip />
            </div>
          </>
        )
        : (
          <div tw='flex-1 flex items-center justify-center text-content-tertiary text-[13px]'>
            Ouvrez un fichier depuis la colonne Fichiers.
          </div>
        )}
    </section>
  )
}
