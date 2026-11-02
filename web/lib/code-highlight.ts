// Editor highlighting with the CSS Custom Highlight API, like tournament's
// syntax-highlighter.ts: ranges over the editor's single text node, no DOM
// rewrite, so CodeJar keeps the caret. Colors live in style.css.
import { tokenizeLine, type TokenKind } from '/web/lib/code-tokens.ts'

const KINDS: TokenKind[] = ['kw', 'str', 'type', 'fn', 'num', 'com']
const EXTRA = ['code-error', 'code-focus'] as const

export const setupTokenHighlights = () => {
  if (!CSS.highlights) {
    console.warn('CSS Custom Highlight API not supported: no highlighting.')
    return
  }
  for (const name of [...KINDS.map((k) => `tok-${k}`), ...EXTRA]) {
    CSS.highlights.has(name) || CSS.highlights.set(name, new Highlight())
  }
}

const textNode = (editor: HTMLElement) =>
  editor.firstChild instanceof Text ? editor.firstChild : null

/** offset in the whole text of the first char of each line */
const lineOffsets = (code: string) => {
  const offsets = [0]
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '\n') offsets.push(i + 1)
  }
  return offsets
}

export const highlightCode = (
  editor: HTMLElement,
  code: string,
  file: string,
) => {
  const node = textNode(editor)
  if (!CSS.highlights || !node) return
  for (const k of KINDS) CSS.highlights.get(`tok-${k}`)?.clear()
  let offset = 0
  for (const line of code.split('\n')) {
    for (const [text, kind] of tokenizeLine(line, file)) {
      if (kind !== 'txt' && text.length) {
        const range = new Range()
        range.setStart(node, offset)
        range.setEnd(node, offset + text.length)
        CSS.highlights.get(`tok-${kind}`)?.add(range)
      }
      offset += text.length
    }
    offset++ // the \n
  }
}

export type CodeProblem = {
  line: number
  column: number
  length: number
  message: string
  code: string // e.g. deno-ts(2322)
}

/** wavy red underline under each problem (type errors from deno check) */
export const highlightProblems = (
  editor: HTMLElement,
  code: string,
  problems: CodeProblem[],
) => {
  const node = textNode(editor)
  const errors = CSS.highlights?.get('code-error')
  if (!errors) return
  errors.clear()
  if (!node) return
  const offsets = lineOffsets(code)
  for (const p of problems) {
    const start = (offsets[p.line - 1] ?? -1) + p.column - 1
    if (start < 0 || start + p.length > code.length) continue
    const range = new Range()
    range.setStart(node, start)
    range.setEnd(node, start + p.length)
    errors.add(range)
  }
}
