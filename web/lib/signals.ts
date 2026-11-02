import { computed, Signal } from 'npm:@preact/signals'

// return time at each animation frames
export const eachFrame = new Signal({ now: Date.now(), delta: 0 })
;(function rafLoop() {
  const old = eachFrame.peek()
  const now = Date.now()
  eachFrame.value = { now, delta: now - old.now }
  requestAnimationFrame(rafLoop)
})()

export const listSignal = <T>(value: T[]) => {
  const version = new Signal(0)
  const bump = () => version.value++
  return {
    bump,
    peek: () => value,
    add: (...elems: T[]) => {
      value.push(...elems)
      bump()
    },
    clear: () => {
      value.length = 0
      version.value = 0
    },
    get value() {
      version.value
      return value
    },
  }
}

const SEC = 1000
const MIN = SEC * 60
const HOUR = MIN * 60
const DAY = HOUR * 24

const each = (unit: number) =>
  computed(
    () => Math.floor(eachFrame.value.now / unit) * unit,
  )

export const eachSec = each(SEC)
export const eachMin = each(MIN)
export const eachHour = each(HOUR)
export const eachDay = each(DAY)

type FetchState<T> =
  | { data: T; pending?: undefined; controller?: undefined; error?: undefined }
  | {
    data?: T
    pending: number
    controller?: AbortController
    error?: undefined
  }
  | { data?: T; pending?: undefined; controller?: undefined; error: Error }

type SignalFetcherReturn<T> = {
  state: Signal<FetchState<T>>
  reset: () => void
  fetch: (url: string) => Promise<void>
  readonly data: T | undefined
  readonly error: Error | undefined
  readonly pending: number | undefined
}

export const signalFetcher = <T>(
  transformer: (response: Response) => Promise<T>,
): SignalFetcherReturn<T> => {
  const state = new Signal<FetchState<T>>({ pending: 0 })

  return {
    state,
    reset: () => {
      state.peek().controller?.abort()
      state.value = { pending: 0 }
    },
    fetch: async (url: string) => {
      const prev = state.peek()
      try {
        const controller = new AbortController()
        prev.controller?.abort()
        state.value = { pending: Date.now(), controller, data: prev.data }

        const response = await fetch(url, { signal: controller.signal })
        const data = await transformer(response)

        state.value = { data }
      } catch (err) {
        state.value = (err instanceof DOMException && err.name === 'AbortError')
          ? { pending: 0, data: prev.data }
          : { error: err as Error, data: prev.data }
      }
    },
    get data() {
      return state.value.data
    },
    get error() {
      return state.value.error
    },
    get pending() {
      return state.value.pending
    },
  }
}
