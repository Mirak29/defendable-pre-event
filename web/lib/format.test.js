import { eq, test } from '/api/lib/test.ts'
import {
  formatClock,
  formatDateTime,
  formatInt,
  formatLatency,
  formatLines,
} from '/web/lib/format.ts'
import { tokenizeLine } from '/web/lib/code-tokens.ts'

test('format', async (step) => {
  await step('latency in seconds with a comma', () => {
    eq(formatLatency(4200), '4,2 s')
    eq(formatLatency(100), '0,1 s')
  })
  await step('integers with french grouping', () => {
    eq(formatInt(1842).replace(/\s/g, ' '), '1 842')
  })
  await step('date and time', () => {
    eq(formatDateTime('2026-09-22T10:14:08'), '22/09/2026 · 10:14:08')
  })
  await step('clock hh:mm:ss and mm:ss', () => {
    eq(formatClock(72 * 60 + 43), '01:12:43')
    eq(formatClock(47, false), '00:47')
    eq(formatClock(-3, false), '00:00')
  })
  await step('cited lines', () => {
    eq(formatLines(22, 30), 'l. 22–30')
    eq(formatLines(23), 'l. 23')
  })
})

test('code tokens', async (step) => {
  await step('typescript keywords, types, functions and strings', () => {
    const tokens = tokenizeLine(
      'export async function createLink(url: string): Promise<LinkRecord> {',
      'src/links_repository.ts',
    ).filter(([t]) => t.trim())
    eq(tokens.slice(0, 5), [
      ['export', 'kw'],
      ['async', 'kw'],
      ['function', 'kw'],
      ['createLink', 'fn'],
      ['(', 'txt'],
    ])
    eq(tokens.find(([t]) => t === 'Promise')?.[1], 'type')
  })
  await step('regex literal and comment', () => {
    eq(
      tokenizeLine('const ALIAS_PATTERN = /^[a-z]+$/; // ok', 'a.ts')
        .filter(([, k]) => k !== 'txt'),
      [['const', 'kw'], ['ALIAS_PATTERN', 'type'], ['/^[a-z]+$/', 'str'], [
        '// ok',
        'com',
      ]],
    )
  })
  await step('json keys and values', () => {
    eq(tokenizeLine('  "test": "deno test src/"', 'deno.json'), [
      ['  ', 'txt'],
      ['"test"', 'type'],
      [': ', 'txt'],
      ['"deno test src/"', 'str'],
    ])
  })
})
