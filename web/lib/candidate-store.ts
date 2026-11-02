// Candidate session (C1 → C7), from the API (api/candidate.ts). The session
// is an httpOnly cookie set at C1; the server is the clock, the page only
// aligns on it (`serverNow`) and refetches on its events.
import { computed, effect, signal } from '@preact/signals'
import { t } from '/web/lib/i18n.ts'
import { api } from '/web/lib/api.ts'
import { candidateSessionId, onEvent } from '/web/lib/events.ts'
import { url } from '/web/lib/router-signal.ts'
import { isCandidatePath, paths } from '/web/paths.ts'
import type {
  CandidateFiles,
  CandidateView,
  IntegrityKind,
} from '/web/types.ts'

const meApi = api['GET/api/candidate/me'].signal()
const clockOffset = signal(0)

export const me = computed(() => meApi.$.value.data)
/** 'none' when there is no session yet (C1 not accepted) */
export const meStatus = computed(() => {
  const state = meApi.$.value
  if (state.data) return 'ready' as const
  return state.error ? 'none' as const : 'loading' as const
})

const setMe = (view: CandidateView) => {
  clockOffset.value = view.now - Date.now()
  meApi.$.value = { data: view, at: Date.now() }
}

export const loadMe = async () => {
  await meApi.fetch()
  const data = meApi.$.peek().data
  if (data) clockOffset.value = data.now - Date.now()
}

/** C1 needs no session: every other candidate page loads it */
effect(() => {
  if (!isCandidatePath(url.path) || url.path === paths.candidate) return
  meApi.$.peek().data || loadMe()
})

effect(() => {
  candidateSessionId.value = me.value?.id ?? 0
})

onEvent([
  'CANDIDATE_CODE_SUBMITTED',
  'CANDIDATE_PREPARATION_STEP',
  'CANDIDATE_FINISHED',
], () => loadMe())

export const serverNow = () => Date.now() + clockOffset.peek()

export const buildSeconds = () => (me.value?.assessment.durationMin ?? 90) * 60

export const elapsedBuildSeconds = (now = serverNow()) => {
  const start = me.value?.startedAt
  const end = me.value?.submittedAt ?? now
  return start ? Math.max(0, Math.floor((end - start) / 1000)) : 0
}

/* ---------- C1: invitation and start ---------- */

const invitationApi = api['GET/api/invitation'].signal()
export const invitation = computed(() => invitationApi.$.value.data)
export const invitationError = computed(() =>
  invitationApi.$.value.error?.message
)

effect(() => {
  if (url.path !== paths.candidate) return
  invitationApi.fetch({ invitation: url.params.invitation ?? '' })
})

/** C1 "Commencer": creates the session, the clock starts on the server */
export const startBuild = async (demo = false) => {
  const token = invitation.peek()?.invitation
  if (!token) {
    throw Error(t('Lien d’évaluation invalide', 'Invalid assessment link'))
  }
  setMe(
    await api['POST/api/candidate/start'].fetch({ invitation: token, demo }),
  )
}

/* ---------- C3, C4 ---------- */

export const submitBuild = async (
  tools: string[],
  otherTool: string | undefined,
  files: CandidateFiles,
) =>
  setMe(
    await api['POST/api/candidate/submit'].fetch({
      tools,
      otherTool,
      files: me.peek()?.submittedAt ? undefined : files,
    }),
  )

export const startQuestions = () =>
  api['POST/api/candidate/questions/start'].fetch()

export const retryPreparation = async () => {
  await api['POST/api/candidate/preparation/retry'].fetch()
  loadMe()
}

/* ---------- C6: facts for the recruiter, no automatic penalty ---------- */

export const logEvent = (
  event: { type: IntegrityKind; question: number; durationSec?: number },
) =>
  api['POST/api/candidate/integrity'].fetch({
    kind: event.type,
    question: event.question,
    durationSec: event.durationSec,
  }).catch(() => {/* best effort: the answer matters more */})
