export const entries = {
  UNKNOWN: 1,
  ASSESSMENT_CREATED: 2,
  ASSESSMENT_UPDATED: 3,
  ASSESSMENT_APPROVED: 4,
  CANDIDATE_INVITED: 5,
  ASSESSMENT_GENERATION_STEP: 6,
  CANDIDATE_BUILD_STARTED: 7,
  CANDIDATE_CODE_SUBMITTED: 8,
  CANDIDATE_PREPARATION_STEP: 9,
  CANDIDATE_QUESTIONS_STARTED: 10,
  CANDIDATE_ANSWER_SENT: 11,
  CANDIDATE_INTEGRITY_EVENT: 12,
  CANDIDATE_FINISHED: 13,
  CANDIDATE_REPORT_READY: 14,
  DECISION_SAVED: 15,
  COMPANY_CREATED: 16,
  MEMBER_CREATED: 17,
  MEMBER_LOGIN: 18,
  MEMBER_LOGIN_FAILED: 19,
  CANDIDATE_LINK_SENT: 20,
} as const

export type Entries = typeof entries
export type EntryTypeName = keyof Entries
export type EntryTypeId = Entries[EntryTypeName]
export const entryNames = Object.fromEntries(
  Object.entries(entries).map((e) => e.reverse()),
) as { [Name in EntryTypeName as Entries[Name]]: Name }
