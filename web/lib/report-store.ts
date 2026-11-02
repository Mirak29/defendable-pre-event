// R6 report of `?candidate=`, from the API (api/report.ts), refreshed when
// the report is generated. The decision is human only: the system never
// recommends one.
import { computed, effect } from '@preact/signals'
import { api } from '/web/lib/api.ts'
import { onEvent } from '/web/lib/events.ts'
import { url } from '/web/lib/router-signal.ts'
import { paths } from '/web/paths.ts'
import type { Decision, DecisionChoice, ReportView } from '/api/report.ts'

export type { Decision, DecisionChoice, ReportView }

const report = api['GET/api/report'].signal()

const followed = () =>
  url.path === paths.report ? url.params.candidate : undefined

effect(() => {
  const candidate = followed()
  if (candidate) report.fetch({ candidate })
})

const refresh = () => {
  const candidate = followed()
  if (candidate) report.fetch({ candidate })
}
onEvent(['CANDIDATE_REPORT_READY', 'DECISION_SAVED'], refresh)

export const reportView = computed((): ReportView | undefined => {
  const data = report.$.value.data
  return data && data.candidateId === Number(followed()) ? data : undefined
})

export const reportError = computed(() => report.$.value.error?.message)

export const saveDecision = async (
  candidateId: number,
  choice: DecisionChoice,
  note: string,
) => {
  const decision = await api['POST/api/decision'].fetch({
    candidate: candidateId,
    choice,
    note,
  })
  const view = report.$.peek().data
  if (view?.candidateId === candidateId) {
    report.$.value = { data: { ...view, decision }, at: Date.now() }
  }
  return decision
}

export const retryReport = async (candidateId: number) => {
  await api['POST/api/report/retry'].fetch({ candidate: candidateId })
  refresh()
}
