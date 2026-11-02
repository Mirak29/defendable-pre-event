// Server events (GET/api/events), like tournament's web/lib/session.ts: the
// server only sends [at, type, id] of new entries, pages refetch what they
// show. The followed assessment or candidate depends on the current page.
import { computed, effect, signal } from '@preact/signals'
import { url } from '/web/lib/router-signal.ts'
import { isCandidatePath, paths } from '/web/paths.ts'
import { entries } from '/api/entries.ts'

type EntryRecord = typeof entries
type EntryKey = keyof EntryRecord
type EntryType = EntryRecord[EntryKey]
type Handler = (entry: { at: number; type: EntryType; id: number }) => void

export const sourceDisconnectedAt = signal(Date.now())

/** set by the candidate store once the session exists (cookie) */
export const candidateSessionId = signal(0)

const listeners = new Set<{ type: EntryType; handler: Handler }>()

export const onEvent = (
  entryTypes: EntryKey | EntryKey[],
  handler: Handler,
) => {
  const disposable: { type: EntryType; handler: Handler }[] = []
  for (const key of Array.isArray(entryTypes) ? entryTypes : [entryTypes]) {
    const listener = { type: entries[key], handler }
    disposable.push(listener)
    listeners.add(listener)
  }
  return () => {
    for (const listener of disposable) listeners.delete(listener)
  }
}

const follow = computed((): Record<string, string> => {
  if (isCandidatePath(url.path)) {
    return candidateSessionId.value
      ? { candidate: 'me', session: String(candidateSessionId.value) }
      : {}
  }
  if (url.path === paths.report && url.params.candidate) {
    return { candidate: url.params.candidate }
  }
  return url.params.id ? { assessment: url.params.id } : {}
})

let source: EventSource | undefined
const setDisconnected = () =>
  sourceDisconnectedAt.peek() || (sourceDisconnectedAt.value = Date.now())

effect(() => {
  const params = follow.value
  const sourceUrl = `api/events?${new URLSearchParams(params)}`
  if (source) {
    if (source.url.endsWith(sourceUrl)) return
    source.close()
    source = undefined
  }
  if (!Object.keys(params).length) return
  setDisconnected()
  source = new EventSource(sourceUrl)
  source.addEventListener('message', (event) => {
    const [at, type, id] = JSON.parse(event.data)
    for (const listener of listeners) {
      if (listener.type !== type) continue
      try {
        listener.handler({ at, type, id })
      } catch (err) {
        console.error(err)
      }
    }
  })

  let timeout = setTimeout(setDisconnected, 20_000)
  source.addEventListener('ack', () => {
    sourceDisconnectedAt.peek() && (sourceDisconnectedAt.value = 0)
    clearTimeout(timeout)
    timeout = setTimeout(setDisconnected, 20_000)
  })
  source.addEventListener('open', () => {
    sourceDisconnectedAt.value = 0
  })
  source.addEventListener('error', setDisconnected)
})
