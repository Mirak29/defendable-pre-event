import { effect, signal } from '@preact/signals'
import { Moon, Sun } from '/web/assets/icons.tsx'
import { t } from '/web/lib/i18n.ts'

// Check stored theme or fallback to system preference
const getInitialTheme = () => {
  if (typeof window === 'undefined') return 'light'
  const stored = localStorage.getItem('theme')
  if (stored === 'dark' || stored === 'light') return stored
  return globalThis.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

export const themeSignal = signal<'light' | 'dark'>(getInitialTheme())

if (typeof window !== 'undefined') {
  effect(() => {
    localStorage.setItem('theme', themeSignal.value)
    // semantic tokens use light-dark(), driven by color-scheme
    document.documentElement.style.colorScheme = themeSignal.value
    document.documentElement.dataset.theme = themeSignal.value
  })
}

function ThemeToggle() {
  const isDark = themeSignal.value === 'dark'
  return (
    <button
      type='button'
      tw='btn btn-secondary btn-icon w-8 h-8 text-content-secondary hover:text-content-primary'
      aria-label={isDark
        ? t('Passer au thème clair', 'Switch to light theme')
        : t('Passer au thème sombre', 'Switch to dark theme')}
      title={isDark
        ? t('Thème clair', 'Light theme')
        : t('Thème sombre', 'Dark theme')}
      onClick={() => (themeSignal.value = isDark ? 'light' : 'dark')}
    >
      {isDark ? <Sun tw='w-4 h-4' /> : <Moon tw='w-4 h-4' />}
    </button>
  )
}
export default ThemeToggle
