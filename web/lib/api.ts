import { makeClient } from '@01edu/api-client'
import type { RouteDefinitions } from '/api/routes.ts'
import { useMemo } from 'npm:preact/hooks'

const BASE_URL = document.baseURI.endsWith('/')
  ? document.baseURI.slice(0, -1)
  : document.baseURI

export const api = makeClient<RouteDefinitions>(BASE_URL)

export type ApiOutput = {
  [K in keyof typeof api]: Awaited<ReturnType<typeof api[K]['fetch']>>
}

export const useApi = <K extends keyof typeof api>(path: K) =>
  useMemo(() => api[path].signal(), [])
