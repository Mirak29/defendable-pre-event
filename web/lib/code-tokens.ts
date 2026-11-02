// Tiny line tokenizer for read-only code (TypeScript, JSON, Markdown).
// Ported from the prototype (shared.js). Token kinds map to the `code-*`
// semantic colors of web/theme.ts.

export type TokenKind = 'kw' | 'str' | 'type' | 'fn' | 'num' | 'com' | 'txt'
export type CodeToken = [text: string, kind: TokenKind]

const KW = new Set(
  'import export from const let var function return if else try catch throw new async await class extends interface type as typeof instanceof of for while in is this super default break continue switch case finally true false null undefined'
    .split(' '),
)
const BUILTIN_TYPES = new Set(
  'string number boolean unknown void never any Record Promise Map Response Request Error URL Boolean Date'
    .split(' '),
)

const tokenizeTs = (line: string): CodeToken[] => {
  const out: CodeToken[] = []
  let i = 0
  let prev = '' // last non-blank char, to tell a regex from a division
  const push = (text: string, kind: TokenKind) => {
    out.push([text, kind])
    if (text.trim()) prev = text.trim().slice(-1)
  }
  while (i < line.length) {
    const rest = line.slice(i)
    let m: RegExpMatchArray | null
    if ((m = rest.match(/^\/\/.*/))) push(m[0], 'com')
    else if (
      (m = rest.match(
        /^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/,
      ))
    ) push(m[0], 'str')
    else if (
      '=(,:'.includes(prev) &&
      (m = rest.match(/^\/(?![\/*])(?:[^\/\\\n]|\\.)+\/[gimsuy]*/))
    ) push(m[0], 'str')
    else if ((m = rest.match(/^\d+(?:\.\d+)?/))) push(m[0], 'num')
    else if ((m = rest.match(/^[A-Za-z_$][\w$]*/))) {
      const word = m[0]
      const after = line.slice(i + word.length)
      const kind: TokenKind = KW.has(word)
        ? 'kw'
        : BUILTIN_TYPES.has(word) || /^[A-Z]/.test(word)
        ? 'type'
        : /^\s*\(/.test(after)
        ? 'fn'
        : 'txt'
      push(word, kind)
    } else {
      push(line[i], 'txt')
      i++
      continue
    }
    i += m[0].length
  }
  return out
}

const tokenizeJson = (line: string): CodeToken[] =>
  line.split(/("(?:[^"\\]|\\.)*")/).filter(Boolean).map((part, index, all) => {
    if (part[0] !== '"') return [part, 'txt']
    const isKey = /^\s*:/.test(all[index + 1] || '')
    return [part, isKey ? 'type' : 'str']
  })

export const tokenizeLine = (line: string, file: string): CodeToken[] => {
  if (/\.json$/.test(file)) return tokenizeJson(line)
  if (/\.md$/.test(file)) return [[line, /^#/.test(line) ? 'kw' : 'txt']]
  if (/\.(ts|tsx|js)$/.test(file)) return tokenizeTs(line)
  return [[line, 'txt']]
}
