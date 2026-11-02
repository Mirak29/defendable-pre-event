import { logger } from '@01edu/api/log'
import { APP_ENV, DEVTOOL_REPORT_TOKEN, DEVTOOL_URL } from '@01edu/api/env'

type Level = 'info' | 'error' | 'warn' | 'debug'
type Props = Record<string, unknown>

// In production, @01edu/api sends the logs to 01edu's devtools (tournament)
// and throws without them; a deployment outside that infrastructure (the
// Docker image of the README) logs to the console instead.
const consoleLog = () => {
  const write = (level: Level, event: string, props?: Props) =>
    console[level](
      JSON.stringify({ at: new Date().toISOString(), level, event, ...props }),
    )
  return Object.assign(write, {
    error: (event: string, props?: Props) => write('error', event, props),
    debug: (event: string, props?: Props) => write('debug', event, props),
    warn: (event: string, props?: Props) => write('warn', event, props),
    info: (event: string, props?: Props) => write('info', event, props),
  })
}

export const log = APP_ENV === 'prod' && !(DEVTOOL_URL && DEVTOOL_REPORT_TOKEN)
  ? consoleLog()
  : await logger({})
