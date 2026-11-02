// Formatting helpers shared by the UI, in the language of the interface
// (web/lib/i18n.ts; French on the API side).
import { lang, t } from '/web/lib/i18n.ts'

/** 4200 → "4,2 s" */
export const formatLatency = (ms: number) => {
  const s = (ms / 1000).toFixed(1)
  return `${lang.value === 'en' ? s : s.replace('.', ',')} s`
}

/** 1842 → "1 842" */
export const formatInt = (n: number) =>
  n.toLocaleString(lang.value === 'en' ? 'en-GB' : 'fr-FR')

/** ISO date → "23/09/2026 · 10:14:08" */
export const formatDateTime = (iso: string) => {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} · ${
    p(d.getHours())
  }:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 4363 s → "01:12:43" (hours) or "72:43" (minutes) */
export const formatClock = (totalSec: number, withHours = true) => {
  const sec = Math.max(0, Math.floor(totalSec))
  const p = (n: number) => String(n).padStart(2, '0')
  return withHours
    ? `${p(Math.floor(sec / 3600))}:${p(Math.floor(sec / 60) % 60)}:${
      p(sec % 60)
    }`
    : `${p(Math.floor(sec / 60))}:${p(sec % 60)}`
}

// getters: the label follows the language where it is read
export const levelLabels = {
  junior: 'Junior',
  get intermediate() {
    return t('Intermédiaire', 'Intermediate')
  },
  senior: 'Senior',
} as const

/** ISO date → "22/09/2026" */
export const formatDate = (iso: string) => formatDateTime(iso).split(' · ')[0]

/** 72 → "1 h 12", 17 → "17 min" */
export const formatMinutes = (min: number) =>
  min < 60
    ? `${min} min`
    : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`

/** "l. 22–30" or "l. 23" */
export const formatLines = (from: number, to = from) =>
  from === to
    ? `${t('l.', 'line')} ${from}`
    : `${t('l.', 'lines')} ${from}–${to}`
