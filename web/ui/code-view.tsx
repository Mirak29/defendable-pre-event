import { useEffect, useRef } from 'npm:preact/hooks'
import type { Token } from 'npm:@twind/preact'
import { A, url } from '/web/lib/router-signal.ts'
import { tokenizeLine, type TokenKind } from '/web/lib/code-tokens.ts'
import { formatLines } from '/web/lib/format.ts'
import { DrawerDialog } from '/web/ui/dialog.tsx'
import { Check, FileCode } from '/web/assets/icons.tsx'
import type { CandidateFiles } from '/web/types.ts'
import { t } from '/web/lib/i18n.ts'

const tokenColor: Record<TokenKind, string> = {
  kw: 'text-code-kw',
  str: 'text-code-str',
  type: 'text-code-type',
  fn: 'text-code-fn',
  num: 'text-code-num',
  com: 'text-code-com',
  txt: 'text-code-text',
}

// type error underline (Twind has no decoration-wavy utilities)
const squiggleStyle = {
  textDecoration: 'underline wavy var(--color-err)',
  textDecorationSkipInk: 'none',
  textUnderlineOffset: '3px',
}

export type LineRange = [from: number, to: number]

/** "22-30" | "23" → [22, 30] | [23, 23] */
export const parseRange = (value?: string | null): LineRange | undefined => {
  if (!value) return
  const [from, to] = value.split(/[-–]/).map(Number)
  return from ? [from, to || from] : undefined
}

type CodeViewProps = {
  code: string
  file: string
  from?: number
  to?: number
  /** cited lines: amber background and left bar */
  highlight?: LineRange
  /** type error: wavy red underline on [line, fromCol, toCol] (1-based) */
  squiggle?: [line: number, fromCol: number, toCol: number]
  activeLine?: number
  size?: number
  /** scroll so the highlighted lines are centered */
  center?: boolean
  /** read-only excerpt that cannot be selected nor copied */
  noSelect?: boolean
  tw?: Token
}

/** Read-only code, VS Code look: line numbers and TypeScript colors */
export const CodeView = ({
  code,
  file,
  from = 1,
  to,
  highlight,
  squiggle,
  activeLine,
  size = 13,
  center,
  noSelect,
  tw,
}: CodeViewProps) => {
  const lines = code.split('\n')
  const last = Math.min(lines.length, to ?? lines.length)
  const lineHeight = Math.round(size * 1.6)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scroller.current
    if (!el || !center || !highlight) return
    const top = (highlight[0] - from) * lineHeight
    const height = (highlight[1] - highlight[0] + 1) * lineHeight
    el.scrollTop = Math.max(0, top - (el.clientHeight - height) / 2)
  }, [center, highlight?.[0], highlight?.[1], file])

  const rows = []
  for (let n = from; n <= last; n++) {
    const isHl = highlight && n >= highlight[0] && n <= highlight[1]
    let col = 1
    const parts = tokenizeLine(lines[n - 1] ?? '', file).flatMap(
      ([text, kind]) => {
        const start = col
        col += text.length
        if (!squiggle || squiggle[0] !== n) return [[text, kind, false]]
        // split the token around the squiggle columns
        const a = Math.max(0, squiggle[1] - start)
        const b = Math.max(0, squiggle[2] - start + 1)
        return [
          [text.slice(0, a), kind, false],
          [text.slice(a, b), kind, true],
          [text.slice(b), kind, false],
        ].filter(([t]) => t) as [string, TokenKind, boolean][]
      },
    ) as [string, TokenKind, boolean][]

    rows.push(
      <div
        key={n}
        tw={[
          'flex min-w-max pr-4',
          isHl
            ? 'bg-hl shadow-[inset_3px_0_0_var(--color-hl-bar)]'
            : n === activeLine && 'bg-code-active',
        ]}
      >
        <span
          tw={[
            'flex-none w-[52px] pr-[18px] text-right select-none',
            isHl || n === activeLine ? 'text-code-text' : 'text-code-ln',
          ]}
        >
          {n}
        </span>
        <span tw='whitespace-pre' style={{ tabSize: 2 }}>
          {parts.length
            ? parts.map(([text, kind, squiggly], i) => (
              <span
                key={i}
                tw={tokenColor[kind]}
                style={squiggly ? squiggleStyle : undefined}
              >
                {text}
              </span>
            ))
            : ' '}
        </span>
      </div>,
    )
  }

  return (
    <div
      ref={scroller}
      tw={[
        'bg-code-bg text-code-text overflow-auto py-1.5 font-mono',
        noSelect && 'select-none',
        tw,
      ]}
      style={{ fontSize: `${size}px`, lineHeight: `${lineHeight}px` }}
      onCopy={noSelect ? (e) => e.preventDefault() : undefined}
    >
      {rows}
    </div>
  )
}

/** Amber tag showing the cited lines, e.g. "l. 22–30" */
export const LinesTag = ({ range }: { range: LineRange }) => (
  <span tw='inline-flex flex-none items-center whitespace-nowrap h-5 px-[7px] rounded-[5px] bg-hl shadow-[inset_2px_0_0_var(--color-hl-bar)] font-mono text-[11.5px] text-content-primary'>
    {formatLines(...range)}
  </span>
)

const basename = (path: string) => path.split('/').pop() || path

/**
 * Citation chip (brief §2.5): "links_repository.ts · l. 22–30 ✓ vérifiée".
 * A verified citation opens the code viewer; an unverified one is struck out.
 */
export const CitationChip = (
  { file, range, verified = true }: {
    file: string
    range: LineRange
    verified?: boolean
  },
) => {
  const text = `${basename(file)} · ${formatLines(...range)}`
  if (!verified) {
    return (
      <span tw='inline-flex items-center gap-1.5 h-6 px-2 rounded-md border border-dashed border-border-strong font-mono text-[12px] text-content-tertiary'>
        <span tw='line-through'>{text}</span>
        <span tw='font-main text-[11.5px] line-through'>
          {t('non vérifiée', 'not verified')}
        </span>
      </span>
    )
  }
  return (
    <A
      params={{ dialog: 'code', file, lines: range.join('-') }}
      tw='inline-flex items-center gap-1.5 h-6 px-2 rounded-md border border-border-strong bg-surface-sunken font-mono text-[12px] text-content-primary no-underline hover:border-accent'
      title={t('Ouvrir le code cité', 'Open the cited code')}
    >
      <FileCode tw='w-[13px] h-[13px] text-content-tertiary' />
      {text}
      <span tw='font-main font-medium text-[11.5px] text-ok inline-flex items-center gap-0.5'>
        <Check tw='w-[11px] h-[11px]' stroke-width={2.5} />
        {t('vérifiée', 'verified')}
      </span>
    </A>
  )
}

/**
 * Code viewer (brief §2.6): 640 px drawer on the right, read-only,
 * cited lines highlighted and centered. Opened by `?dialog=code&file=&lines=`.
 */
export const CodeDrawer = ({ files }: { files: CandidateFiles }) => {
  const file = url.params.file || ''
  const range = parseRange(url.params.lines)
  return (
    <DrawerDialog
      id='code'
      width='w-[640px]'
      closeParams={['file', 'lines']}
      tw='bg-code-bg'
      heading={
        <>
          <FileCode tw='w-4 h-4 text-code-kw flex-none' />
          <span tw='font-mono text-[13px] font-medium truncate min-w-0'>
            {file}
          </span>
          {range && <LinesTag range={range} />}
          <span tw='hidden sm:inline text-[12px] text-content-tertiary whitespace-nowrap'>
            {t('Lecture seule', 'Read only')}
          </span>
        </>
      }
    >
      {files[file] !== undefined
        ? (
          <CodeView
            code={files[file]}
            file={file}
            highlight={range}
            center
            tw='h-full'
          />
        )
        : (
          <p tw='p-6 m-0 text-content-secondary'>
            {t(
              'Fichier introuvable dans la soumission.',
              'File not found in the submission.',
            )}
          </p>
        )}
    </DrawerDialog>
  )
}
