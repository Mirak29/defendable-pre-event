import { APP_ENV, BASE_URL, ENV, PROD } from '@01edu/api/env'

export { APP_ENV }

export { BASE_URL }

// @01edu/db reads DATABASE_PATH itself: keep the .env-* files in sync
export const DATABASE_PATH = ENV(
  'DATABASE_PATH',
  APP_ENV === 'test' ? ':memory:' : 'defendable.db',
)

export const REDIRECT_URI = PROD('REDIRECT_URI', '')

export const HOSTNAME = `localhost:${ENV('PORT', '8000')}`
export const API_URL = `http://${HOSTNAME}/api`

export const ORIGIN = APP_ENV === 'prod' ? REDIRECT_URI : `http://${HOSTNAME}`
