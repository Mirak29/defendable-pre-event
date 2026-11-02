import { tailwindColors } from '/web/tailwind-colors.ts'
type ClassMap = Record<string, { '@apply': string }>

// Twind (@twind/preact, same as tournament) is not Tailwind v3: arbitrary
// properties (`[tab-size:2]`), `grid-cols-[22px_1fr]` and some utilities
// (`max-h-none`, `opacity-45`, `decoration-*`, `underline-offset-*`,
// `scroll-mt-*`) generate nothing. Name grid templates in the theme
// (app.tsx), use inline `style` for odd properties, `opacity-[.45]` values.
// Never build JSX at module level: `h` is only global once app.tsx runs.

const style = `.btn {
    @apply inline-flex items-center justify-center gap-1.5 h-[34px] px-3.5
      rounded-lg font-medium text-[13.5px] whitespace-nowrap transition-colors
      duration-150 border cursor-pointer disabled:opacity-[.45]
      disabled:cursor-not-allowed no-underline;
    }
    .btn-primary {
      @apply bg-accent border-accent text-on-accent hover:bg-accent-hover
        hover:border-accent-hover;
    }
    .btn-secondary {
      @apply bg-surface-elevated border-border-strong text-content-primary
        hover:bg-surface-hover;
    }
    .btn-ghost {
      @apply bg-transparent border-transparent text-content-secondary
        hover:bg-surface-hover;
    }
    .btn-danger {
      @apply bg-err border-err text-on-accent hover:opacity-90;
    }
    .btn-sm {
      @apply h-[28px] px-2.5 text-[12.5px] rounded-md;
    }
    .btn-icon {
      @apply h-[30px] w-[30px] px-0;
    }
    .card {
      @apply bg-surface-elevated border border-border-primary rounded-xl;
    }
    .card-sunken {
      @apply bg-surface-sunken border border-border-primary rounded-xl;
    }
    .input {
      @apply w-full rounded-lg border border-border-strong px-3 py-2 text-[14px]
        text-content-primary bg-surface-elevated
        transition-colors focus:outline-none focus:border-accent
        disabled:cursor-not-allowed disabled:opacity-[.45];
    }
    .badge {
      @apply inline-flex items-center gap-1 h-[22px] px-2 rounded-md border
        text-[12px] font-medium whitespace-nowrap select-none;
    }
    .badge-neutral {
      @apply bg-surface-sunken border-border-primary text-content-secondary;
    }
    .badge-accent {
      @apply bg-accent-soft border-transparent text-accent-text;
    }
    .badge-ok {
      @apply bg-ok-soft border-transparent text-ok;
    }
    .badge-err {
      @apply bg-err-soft border-transparent text-err;
    }
    .badge-warn {
      @apply bg-warn-soft border-transparent text-warn;
    }
    .badge-ai {
      @apply bg-ai-soft border-ai-line text-ai;
    }
    .kbd {
      @apply inline-flex items-center h-[18px] px-1.5 rounded border
        border-border-strong bg-surface-sunken font-mono text-[11px]
        text-content-secondary;
    }`

// [light, dark] : a ramp key from tailwind-colors.ts or a raw CSS color.
// Raw values are the exact tokens of the Claude Design prototype (_head.txt).
const semanticMap = {
  // surface
  'surface-page': ['oklch(0.975 0.004 272)', '#161826'],
  'surface-elevated': ['oklch(0.995 0.002 272)', '#1e202e'],
  'surface-sunken': ['oklch(0.955 0.005 272)', '#131420'],
  'surface-hover': ['oklch(0.94 0.006 272)', '#282a3a'],

  // border
  'border-primary': ['oklch(0.9 0.007 272)', '#2c2f40'],
  'border-strong': ['oklch(0.83 0.01 272)', '#3a3d50'],

  // content
  'content-primary': ['oklch(0.23 0.02 272)', '#e9e9ed'],
  'content-secondary': ['oklch(0.43 0.018 272)', 'oklch(0.77 0.015 278)'],
  'content-tertiary': ['oklch(0.54 0.015 272)', 'oklch(0.65 0.015 278)'],

  // accent (indigo): main actions only
  'accent': ['oklch(0.5 0.2 268)', 'oklch(0.56 0.18 268)'],
  'accent-hover': ['oklch(0.45 0.2 268)', 'oklch(0.62 0.17 268)'],
  'accent-soft': ['oklch(0.95 0.03 268)', 'oklch(0.3 0.07 268)'],
  'accent-text': ['oklch(0.46 0.2 268)', 'oklch(0.78 0.12 268)'],
  'on-accent': ['oklch(0.985 0.005 268)', 'oklch(0.99 0.005 268)'],

  // status
  'ok': ['oklch(0.5 0.13 150)', 'oklch(0.77 0.14 150)'],
  'ok-soft': ['oklch(0.95 0.04 150)', 'oklch(0.28 0.05 150)'],
  'err': ['oklch(0.52 0.19 27)', 'oklch(0.73 0.16 25)'],
  'err-soft': ['oklch(0.955 0.025 27)', 'oklch(0.28 0.06 25)'],
  'warn': ['oklch(0.5 0.12 65)', 'oklch(0.83 0.13 80)'],
  'warn-line': ['oklch(0.75 0.15 75)', 'oklch(0.75 0.14 75)'],
  'warn-soft': ['oklch(0.965 0.045 85)', 'oklch(0.3 0.05 80)'],

  // AI (violet): reserved to what the AI produces or interprets
  'ai': ['oklch(0.5 0.2 310)', 'oklch(0.77 0.14 310)'],
  'ai-soft': ['oklch(0.955 0.03 310)', 'oklch(0.28 0.06 310)'],
  'ai-line': ['oklch(0.83 0.08 310)', 'oklch(0.46 0.11 310)'],
  'ai-mark': ['oklch(0.91 0.06 310)', 'oklch(0.37 0.09 310)'],

  // cited lines highlight
  'hl': ['oklch(0.955 0.06 90)', 'oklch(0.31 0.06 85)'],
  'hl-bar': ['oklch(0.75 0.15 75)', 'oklch(0.78 0.14 80)'],

  // code
  'code-bg': ['oklch(0.99 0.002 272)', '#171926'],
  'code-ln': ['oklch(0.62 0.01 272)', 'oklch(0.52 0.02 278)'],
  'code-active': ['oklch(0.965 0.004 272)', '#1f2130'],
  'code-kw': ['oklch(0.48 0.16 250)', 'oklch(0.75 0.13 250)'],
  'code-str': ['oklch(0.5 0.13 40)', 'oklch(0.8 0.1 55)'],
  'code-type': ['oklch(0.5 0.1 190)', 'oklch(0.8 0.09 185)'],
  'code-fn': ['oklch(0.5 0.11 85)', 'oklch(0.87 0.1 95)'],
  'code-num': ['oklch(0.5 0.12 150)', 'oklch(0.8 0.11 150)'],
  'code-com': ['oklch(0.58 0.04 150)', 'oklch(0.62 0.05 150)'],
  'code-text': ['oklch(0.28 0.02 272)', 'oklch(0.88 0.01 278)'],

  // console: dark in both themes
  'console-bg': ['oklch(0.2 0.02 278)', 'oklch(0.17 0.02 278)'],
  'console-tab': ['oklch(0.26 0.02 278)', 'oklch(0.26 0.02 278)'],
  'console-text': ['oklch(0.93 0.008 278)', 'oklch(0.93 0.008 278)'],
  'console-muted': ['oklch(0.65 0.015 278)', 'oklch(0.65 0.015 278)'],

  // overlays
  'scrim': ['oklch(0.2 0.02 272 / .45)', 'oklch(0.1 0.02 278 / .62)'],
} as const
type SemanticKey = keyof typeof semanticMap

const css = (...args: Parameters<typeof String.raw>) => {
  const classMap: ClassMap = {}
  const text = String.raw(...args)
  for (
    const match of text.matchAll(
      /\.([\w-]+)\s*\{\s*@apply\s+([^}]+?)\s*;?\s*\}/g,
    )
  ) {
    classMap[`.${match[1]}`] = { '@apply': match[2].trim() }
  }
  return classMap
}

function buildFlat(): Record<string, string> {
  const flat: Record<string, string> = {}
  for (const [name, shades] of Object.entries(tailwindColors)) {
    for (
      const [shade, value] of Object.entries(shades as Record<string, string>)
    ) {
      flat[`${name}-${shade}`] = value
    }
  }
  return flat
}

export function buildPreflightTokens() {
  const flat = buildFlat()
  const vars: Record<string, string> = { 'color-scheme': 'light dark' }
  for (
    const [token, [lightKey, darkKey]] of Object.entries(semanticMap) as [
      SemanticKey,
      [string, string],
    ][]
  ) {
    const lv = flat[lightKey] ?? lightKey
    const dv = flat[darkKey] ?? darkKey
    vars[`--color-${token}`] = `light-dark(${lv}, ${dv})`
  }
  vars['--shadow'] =
    '0 1px 2px light-dark(oklch(0.2 0.02 272 / .06), oklch(0 0 0 / .3)), 0 4px 16px light-dark(oklch(0.2 0.02 272 / .06), oklch(0 0 0 / .25))'
  vars['--shadow-lg'] =
    '0 12px 40px light-dark(oklch(0.2 0.02 272 / .18), oklch(0 0 0 / .5))'
  return {
    ':root': vars,
    body: {
      'font-size': '14px',
      'line-height': '1.5',
      '-webkit-font-smoothing': 'antialiased',
    },
    // titles in Unbounded, tight like on wurus.app
    'h1, h2': {
      'font-family': "Unbounded, 'Bricolage Grotesque', sans-serif",
      'letter-spacing': '-0.03em',
    },
    '::selection': { background: 'var(--color-accent-soft)' },
    ':focus-visible': {
      outline: '2px solid var(--color-accent)',
      'outline-offset': '2px',
    },
  }
}
export const semanticColors = {
  colors: Object.fromEntries(
    (Object.keys(semanticMap) as SemanticKey[]).map((token) => [
      token,
      `var(--color-${token})`,
    ]),
  ) as Record<SemanticKey, string>,
}

export const customClasses = css`
  ${style};
`
