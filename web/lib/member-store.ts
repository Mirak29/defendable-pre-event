// Company session (U3), from the API (api/member.ts): the httpOnly cookie
// `dfd_session` is set by the server; the page only reads who is signed in,
// like tournament's `session` signal over GET/api/user/me.
import { computed, effect, signal } from '@preact/signals'
import { api } from '/web/lib/api.ts'
import { navigate, url } from '/web/lib/router-signal.ts'
import { isRecruiterPath, paths } from '/web/paths.ts'
import type { MemberView } from '/api/member.ts'

const meApi = api['GET/api/me'].signal()

export const member = computed(() => meApi.$.value.data)
/** 'in' signed in, 'out' signed out, 'loading' not known yet */
export const memberStatus = computed(() => {
  const state = meApi.$.value
  if (state.data) return 'in' as const
  return state.error ? 'out' as const : 'loading' as const
})

export const setMember = (view: MemberView) => {
  meApi.$.value = { data: view, at: Date.now() }
}

/** whether « Essayer la démo » can sign in the demo member (DEMO_ACCESS) */
const demoApi = api['GET/api/demo'].signal()
export const demoAvailable = computed(() =>
  demoApi.$.value.data?.available === true
)

/** where to go once signed in: only a page of the company space */
export const nextPath = () => {
  const next = url.params.next
  return next && isRecruiterPath(next.split('?')[0]) ? next : paths.recruiter
}

export const enterDemo = async () => {
  setMember(await api['POST/api/demo/session'].fetch())
}

export const signOut = async () => {
  await api['POST/api/logout'].fetch().catch(() => {})
  meApi.$.value = { error: Error('Déconnecté'), at: Date.now() }
  navigate({ href: paths.home })
}

/** the demo buttons need to know if the demo account is open */
export const demoChecked = signal(false)
const checkDemo = () => {
  if (demoChecked.peek()) return
  demoChecked.value = true
  demoApi.fetch().catch(() => {})
}

meApi.fetch().catch(() => {})
checkDemo()

// The company space needs a session: without one, sign in first and come
// back to the requested page (`next`); signed in, /login and /signup lead to
// the company space. The server refuses the calls anyway (401).
effect(() => {
  const status = memberStatus.value
  const path = url.path
  if (status === 'out' && isRecruiterPath(path)) {
    navigate({
      href: paths.login,
      params: { next: `${location.pathname}${location.search}` },
      replace: true,
    })
  } else if (
    status === 'in' && (path === paths.login || path === paths.signup)
  ) {
    navigate({ href: nextPath(), replace: true })
  }
})
