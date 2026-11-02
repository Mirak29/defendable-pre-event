import { log } from '/api/lib/log.ts'
import { routeHandler } from '/api/routes.ts'
import '/api/schema.ts'
import { recoverInterruptedJobs } from '/api/recovery.ts'
import { withAiScope } from '/api/lib/ai-context.ts'
import { translateMessage } from '/web/lib/messages.ts'

import { server } from '@01edu/api/server'

const fetch = server({ log, routeHandler })

/** the language of the page (web/lib/i18n.ts), French by default */
const wantsEnglish = (req: Request) =>
  /(?:^|;\s*)dfd_lang=en(?:;|$)/.test(req.headers.get('cookie') ?? '')

/** an error of the API in English: its `message`, translated */
const inEnglish = async (res: Response) => {
  if (res.ok || !res.headers.get('content-type')?.includes('json')) return res
  const body = await res.clone().json().catch(() => undefined)
  if (typeof body?.message !== 'string') return res
  const headers = new Headers(res.headers)
  headers.delete('content-length')
  return new Response(
    JSON.stringify({ ...body, message: translateMessage(body.message) }),
    { status: res.status, statusText: res.statusText, headers },
  )
}

export default {
  async fetch(req: Request) {
    // @01edu/api fails on an empty Cookie header (sent by some HTTP clients)
    if (req.headers.get('cookie') === '') {
      const headers = new Headers(req.headers)
      headers.delete('cookie')
      req = new Request(req, { headers })
    }
    // the scope of the request, inherited by the jobs it starts
    const res = await withAiScope(() => fetch(req, new URL(req.url)))
    return wantsEnglish(req) ? inEnglish(res) : res
  },
}

recoverInterruptedJobs()
log.info('server-start')
