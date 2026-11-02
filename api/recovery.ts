// Background jobs live in the server process: a restart interrupts them.
// At boot, what was running is marked as failed so the pages show their
// "Réessayer" button (brief §2.13) instead of an endless spinner.
import { Assessment, Candidate } from '/api/schema.ts'
import { json } from '/api/assessment.ts'
import { log } from '/api/lib/log.ts'
import type { Progress } from '/web/types.ts'

const INTERRUPTED = 'Interrompu par un redémarrage du serveur.'

const interrupt = (progress: Progress | undefined): Progress => ({
  ...progress,
  steps: (progress?.steps ?? []).map((s) =>
    s.state === 'run' ? { state: 'error' } : s
  ),
  error: INTERRUPTED,
})

const generating = Assessment.sql`
  SELECT * FROM assessment WHERE assessmentStatus = 'generating'
`.all

const preparing = Candidate.sql`
  SELECT * FROM candidate
  WHERE candidateSubmittedAt IS NOT NULL AND candidateQuestions IS NULL
`.all

const reporting = Candidate.sql`
  SELECT * FROM candidate
  WHERE candidateFinishedAt IS NOT NULL
    AND (candidateReport IS NULL OR json_extract(candidateReport, '$.status') = 'pending')
`.all

export const recoverInterruptedJobs = () => {
  for (const a of generating()) {
    // a regeneration keeps its previous draft
    Assessment.update({
      assessmentId: a.assessmentId,
      assessmentStatus: a.assessmentSpec ? 'draft' : 'failed',
      assessmentGeneration: interrupt(json<Progress>(a.assessmentGeneration)),
    })
    log.warn('job-interrupted', { assessmentId: a.assessmentId })
  }
  for (const c of preparing()) {
    const progress = json<Progress>(c.candidatePreparation)
    if (progress?.error) continue
    Candidate.update({
      candidateId: c.candidateId,
      candidatePreparation: interrupt(progress),
    })
    log.warn('job-interrupted', { candidateId: c.candidateId, job: 'C4' })
  }
  for (const c of reporting()) {
    Candidate.update({
      candidateId: c.candidateId,
      candidateReport: { status: 'failed', error: INTERRUPTED },
    })
    log.warn('job-interrupted', { candidateId: c.candidateId, job: 'R6' })
  }
}
