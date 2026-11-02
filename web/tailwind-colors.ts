const steps = [
  ...[10, 30, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500],
  ...[600, 650, 700, 750, 800, 850, 900, 950],
] as const

type Step = typeof steps[number]

const near = (n: number) => Math.round(n * 1000) / 1000

// [chroma, hue] in OKLCH, derived from the Claude Design prototype tokens
export const colorSpecs = {
  indigo: [0.2, 268], // accent, main actions
  gray: [0.012, 272], // neutral base
  green: [0.13, 150], // passed / demonstrated
  red: [0.19, 27], // failed / contradiction
  amber: [0.14, 75], // partial / warning
  violet: [0.2, 310], // reserved to what the AI produces or interprets
} as const

export const tailwindColors = Object.fromEntries(
  Object.entries(colorSpecs).map(([name, [chroma, hue]]) => [
    name,
    Object.fromEntries(
      steps.map((n) => [n, `oklch(${near(1 - n / 1000)} ${chroma} ${hue})`]),
    ) as Record<Step, string>,
  ]),
) as { [K in keyof typeof colorSpecs]: Record<Step, string> }
