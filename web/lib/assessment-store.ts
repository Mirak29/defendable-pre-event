// Recruiter side state, backed by the API (api/assessment.ts). Pages read
// signals; the followed assessment is the one of `?id=`, refetched on its
// server events (generation steps, approval, candidates).
import { computed, effect, signal } from '@preact/signals'
import { api } from '/web/lib/api.ts'
import { onEvent } from '/web/lib/events.ts'
import { url } from '/web/lib/router-signal.ts'
import { paths } from '/web/paths.ts'
import type {
  AssessmentState,
  CandidateStatus,
  CandidateSummary,
  GenerationInput,
  Level,
} from '/web/types.ts'

export type { AssessmentState, CandidateStatus, CandidateSummary }

const list = api['GET/api/assessments'].signal()
const current = api['GET/api/assessment'].signal()

export const assessments = computed(() => list.$.value.data ?? [])
export const assessmentsLoading = computed(() =>
  !list.$.value.data && !list.$.value.error
)
export const loadAssessments = () => list.fetch()

// pages that show one assessment through ?id=
const FOLLOWED = new Set<string>([
  paths.newAssessment,
  paths.review,
  paths.assessment,
])

effect(() => {
  const id = url.params.id
  if (!id || !FOLLOWED.has(url.path)) return
  current.fetch({ id })
})

export const refreshAssessment = () => {
  const id = url.params.id
  if (id && FOLLOWED.has(url.path)) current.fetch({ id })
}

onEvent([
  'ASSESSMENT_GENERATION_STEP',
  'ASSESSMENT_UPDATED',
  'ASSESSMENT_APPROVED',
  'CANDIDATE_INVITED',
  'CANDIDATE_LINK_SENT',
  'CANDIDATE_BUILD_STARTED',
  'CANDIDATE_QUESTIONS_STARTED',
  'CANDIDATE_FINISHED',
  'CANDIDATE_REPORT_READY',
], refreshAssessment)

/** the assessment of `id`: the followed one first, the list otherwise */
export const getAssessment = (id: string | number | null | undefined) => {
  const data = current.$.value.data
  if (data && data.id === Number(id)) return data
  return assessments.value.find((a) => a.id === Number(id))
}

/** `undefined` while the followed assessment is loading */
export const assessmentStatus = computed(() => {
  const state = current.$.value
  if (state.error) return 'error' as const
  return state.data && state.data.id === Number(url.params.id)
    ? 'ready' as const
    : 'loading' as const
})

export const assessmentError = computed(() => current.$.value.error?.message)

/* ---------- R4: tests deleted before approval (instant recompute) ---------- */

export const deletedTests = signal<Record<number, string[]>>({})

effect(() => {
  const a = current.$.value.data
  if (a) deletedTests.value = { ...deletedTests.peek(), [a.id]: a.deletedTests }
})

export const deletedOf = (id: number) =>
  computed(() => new Set(deletedTests.value[id] || []))

export const setDeletedTests = (id: number, testIds: string[]) => {
  deletedTests.value = { ...deletedTests.peek(), [id]: testIds }
  return updated(
    api['POST/api/assessment/deleted-tests'].fetch({ id, testIds }),
  )
}

/* ---------- actions ---------- */

/** R2 → R3: returns the id of the assessment being generated */
export const generateAssessment = async (
  input: GenerationInput,
  simulate?: 'repli' | 'echec',
) => {
  const { id } = await api['POST/api/assessment'].fetch({
    ...input,
    domain: input.domain,
    simulate,
  })
  list.fetch()
  return id
}

export const retryGeneration = async (id: number) => {
  await api['POST/api/assessment/retry'].fetch({ id })
  refreshAssessment()
}

export const prefillSkills = (jobDescription: string) =>
  api['POST/api/assessment/prefill'].fetch({ jobDescription }) as Promise<
    { level: Level; skills: string[]; trace: AssessmentState['trace'] }
  >

// answers of the API replace the followed assessment at once
const setCurrent = (a: AssessmentState) =>
  current.$.value = { data: a, at: Date.now() }

const updated = async (request: Promise<AssessmentState>) =>
  setCurrent(await request)

export const renameAssessment = (id: number, title: string) =>
  title.trim() &&
  updated(
    api['POST/api/assessment/update'].fetch({
      id,
      title: title.trim(),
      context: undefined,
      mission: undefined,
    }),
  )

/** R4: the brief the candidate reads in C2 (context or mission) */
export const updateBrief = (
  id: number,
  field: 'context' | 'mission',
  text: string,
) =>
  updated(
    api['POST/api/assessment/update'].fetch({
      id,
      title: undefined,
      context: field === 'context' ? text : undefined,
      mission: field === 'mission' ? text : undefined,
    }),
  )

/** R4 "Régénérer avec une consigne": progress comes through the events */
export const regenerateAssessment = async (id: number, instruction: string) => {
  await api['POST/api/assessment/regenerate'].fetch({ id, instruction })
  refreshAssessment()
}

/** R4 → R5: the assessment is frozen, deleted tests are dropped */
export const approveAssessment = async (id: number) => {
  setCurrent(await api['POST/api/assessment/approve'].fetch({ id }))
  list.fetch()
}

/** R5: the link a candidate opens (C1) */
/** the personal link of a candidate (U4): the only way into the test */
export const invitationLink = (invitation: string) =>
  `${location.origin}${paths.candidate}?invitation=${invitation}`

/** R5 « Inviter un candidat »: the personal link, and its e-mail if asked */
export const inviteCandidate = async (
  assessment: number,
  identity: {
    firstName: string
    lastName: string
    email: string
    profileUrl?: string
    note?: string
  },
  options: { sendEmail?: boolean; fromCv?: boolean } = {},
) => {
  const { candidateId, invitation, email } = await api[
    'POST/api/candidate/invite'
  ].fetch({
    assessment,
    ...identity,
    profileUrl: identity.profileUrl,
    note: identity.note,
    sendEmail: options.sendEmail,
    fromCv: options.fromCv,
  })
  refreshAssessment()
  return {
    candidateId,
    link: invitationLink(invitation),
    email: email ?? undefined,
  }
}

/** R5 « Envoyer le lien par e-mail » (U5): sent, or why not */
export const sendCandidateLink = async (candidate: number) => {
  const result = await api['POST/api/candidate/send-link'].fetch({ candidate })
  refreshAssessment()
  return result
}

/** base64 of a file, for the JSON API */
const base64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })

/** R5 « Importer un CV » (U5): the fields read, nothing stored */
export const readCv = async (assessment: number, file: File) =>
  api['POST/api/candidate/cv'].fetch({ assessment, data: await base64(file) })

export const revokeCandidate = async (candidate: number) => {
  await api['POST/api/candidate/revoke'].fetch({ candidate })
  refreshAssessment()
}
