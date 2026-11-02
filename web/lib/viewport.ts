import { Signal } from 'npm:@preact/signals'

// Breakpoints of Twind (Tailwind defaults), in px
export const BREAKPOINTS = { sm: 640, md: 768, lg: 1024, xl: 1280 } as const

// Workspace and questions are desktop only (brief §1: 1280 px minimum)
export const DESKTOP_MIN_WIDTH = BREAKPOINTS.md

export const viewportWidth = new Signal(
  typeof window === 'undefined' ? DESKTOP_MIN_WIDTH : innerWidth,
)

if (typeof window !== 'undefined') {
  addEventListener('resize', () => viewportWidth.value = innerWidth, {
    passive: true,
  })
}
