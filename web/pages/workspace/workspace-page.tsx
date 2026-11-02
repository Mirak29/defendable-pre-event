import { paths } from '/web/paths.ts'
import { effect } from '@preact/signals'
import { useEffect } from 'npm:preact/hooks'
import { navigate, url } from '/web/lib/router-signal.ts'
import { eachSec } from '/web/lib/signals.ts'
import { formatClock } from '/web/lib/format.ts'
import {
  buildSeconds,
  elapsedBuildSeconds,
  loadMe,
  me,
  meStatus,
} from '/web/lib/candidate-store.ts'
import { Spinner } from '/web/ui/spinner.tsx'
import {
  run,
  type RunKind,
  running,
  savedAgo,
  saveState,
} from '/web/pages/workspace/workspace-state.ts'
import { FileExplorer } from '/web/pages/workspace/file-explorer.tsx'
import { EditorPanel } from '/web/pages/workspace/editor-panel.tsx'
import { SidePanel } from '/web/pages/workspace/side-panel.tsx'
import { ConsolePanel } from '/web/pages/workspace/console-panel.tsx'
import { SubmitDialog } from '/web/pages/workspace/submit-dialog.tsx'
import { SaveIndicator } from '/web/ui/timer.tsx'
import { t } from '/web/lib/i18n.ts'
import {
  FlaskConical,
  Hammer,
  ListChecks,
  LoaderCircle,
  Play,
  Send,
  Timer,
} from '/web/assets/icons.tsx'

// Ctrl+Entrée runs playground.ts, like the "Exécuter" button
addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.key !== 'Enter') return
  if (url.peek().pathname !== paths.workspace) return
  e.preventDefault()
  run('run')
})

const RunButton = (
  { kind, icon: Icon, children }: {
    kind: RunKind
    icon: typeof Play
    children: preact.ComponentChildren
  },
) => {
  const busy = running.value
  const mine = busy === kind
  return (
    <button
      type='button'
      data-test={`run-${kind}-btn`}
      onClick={() => run(kind)}
      disabled={!!busy && !mine}
      aria-busy={mine}
      tw='btn btn-secondary h-[30px] px-2.5 text-[13px]'
    >
      {mine
        ? <LoaderCircle tw='w-3.5 h-3.5 animate-spin text-accent-text' />
        : <Icon tw='w-3.5 h-3.5' />}
      {children}
    </button>
  )
}

/** elapsed time, with the remaining time: amber under 20 %, red under 30 s */
const Clock = ({ elapsed }: { elapsed: number }) => {
  const total = buildSeconds()
  const remaining = Math.max(0, total - elapsed)
  const level = remaining < 30
    ? 'bg-err-soft text-err'
    : remaining < total * 0.2
    ? 'bg-warn-soft text-warn'
    : 'bg-surface-sunken text-content-primary'
  return (
    <span
      role='timer'
      title={`${t('Temps restant :', 'Time left:')} ${
        formatClock(remaining, false)
      }`}
      tw={[
        'inline-flex items-center gap-1.5 h-6 px-2 rounded-md font-mono font-bold text-[13px] whitespace-nowrap',
        level,
      ]}
    >
      <Timer tw='w-3.5 h-3.5' />
      {formatClock(elapsed)}
      <span tw='font-main font-medium text-[11.5px]'>
        · {formatClock(remaining, false)} {t('restantes', 'left')}
      </span>
    </span>
  )
}

const WorkspaceBar = (
  { elapsed, title }: { elapsed: number; title: string },
) => (
  <header tw='h-12 flex-none flex items-center gap-3 pl-4 pr-3 border-b border-border-primary bg-surface-elevated'>
    <span
      tw='font-semibold text-[13px] max-w-[250px] truncate'
      title={title}
    >
      {title}
    </span>
    <span tw='badge badge-accent h-[22px] font-semibold text-[11.5px]'>
      <Hammer tw='w-3 h-3' />
      {t('Phase 1/2 · Construction', 'Phase 1/2 · Building')}
    </span>
    <Clock elapsed={elapsed} />
    <SaveIndicator state={saveState.value} savedAgo={savedAgo.value} />
    <span tw='flex-1' />
    <RunButton kind='run' icon={Play}>
      {t('Exécuter', 'Run')}
      <kbd tw='kbd text-[10.5px]'>{t('Ctrl+Entrée', 'Ctrl+Enter')}</kbd>
    </RunButton>
    <RunButton kind='mine' icon={FlaskConical}>
      {t('Mes tests', 'My tests')}
    </RunButton>
    <RunButton kind='eval' icon={ListChecks}>
      {t('Tests d’évaluation', 'Evaluation tests')}
    </RunButton>
    <span tw='w-px h-[22px] bg-border-strong mx-0.5' />
    <button
      type='button'
      tw='btn btn-primary h-[30px] px-3.5 text-[13px]'
      data-test='submit-btn'
      onClick={() => navigate({ params: { dialog: 'submit' } })}
    >
      <Send tw='w-3.5 h-3.5' />
      {t('Soumettre', 'Submit')}
    </button>
  </header>
)

// time is up: the server submits the code, the declaration dialog opens
// by itself and cannot be closed (C3)
let expiredLoaded = false
effect(() => {
  eachSec.value
  if (url.value.pathname !== paths.workspace || !me.value) return
  const expired = url.params.soumission === 'expire' ||
    elapsedBuildSeconds() >= buildSeconds()
  if (!expired) return
  if (!me.value.submittedAt && !expiredLoaded) {
    expiredLoaded = true
    loadMe() // the server has submitted the code in the meantime
  }
  if (url.params.dialog !== 'submit') {
    navigate({ params: { dialog: 'submit' }, replace: true })
  }
})

/** C2 — workspace, full screen without the global top bar */
export const WorkspacePage = () => {
  const view = me.value
  const status = meStatus.value
  useEffect(() => {
    // no session: back to the candidate link (C1)
    if (status === 'none') navigate({ href: paths.candidate, replace: true })
    // already submitted by hand: on to the questions (C4)
    if (view?.submittedAt && !view.autoSubmitted) {
      navigate({ href: paths.rules, params: { dialog: null }, replace: true })
    }
  }, [status, view?.submittedAt])
  eachSec.value // re-render every second for the clock
  if (!view) {
    return (
      <div tw='h-screen flex items-center justify-center'>
        <Spinner tw='w-5 h-5 text-content-tertiary' />
      </div>
    )
  }
  const total = buildSeconds()
  const elapsed = elapsedBuildSeconds()
  const expired = url.params.soumission === 'expire' || elapsed >= total
  return (
    <div tw='h-screen flex flex-col overflow-hidden bg-surface-page text-content-primary'>
      <WorkspaceBar elapsed={elapsed} title={view.assessment.title} />
      <div tw='flex-1 min-h-0 flex'>
        <div tw='flex-1 min-w-0 flex flex-col'>
          <div tw='flex-1 min-h-0 flex'>
            <FileExplorer />
            <EditorPanel />
          </div>
          <ConsolePanel />
        </div>
        <SidePanel />
      </div>
      <SubmitDialog
        remainingSec={Math.max(0, total - elapsed)}
        expired={expired}
      />
    </div>
  )
}
