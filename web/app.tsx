import { paths } from '/web/paths.ts'
import { setup } from 'npm:@twind/preact'
import { Fragment, h, JSX, render } from 'npm:preact'
import { buildPreflightTokens, customClasses, semanticColors } from './theme.ts'
import { url } from '/web/lib/router-signal.ts'
import { tailwindColors } from '/web/tailwind-colors.ts'
import {
  CandidateTopBar,
  PublicHeader,
  RecruiterTopBar,
} from '/web/ui/topbar.tsx'
import { NotFoundPage } from '/web/pages/not-found-page.tsx'
import { makePlaceholder } from '/web/pages/placeholder-page.tsx'
import { screens } from '/web/screens.ts'
import { Notifications } from '/web/ui/notifications.tsx'
import { DesktopOnly } from '/web/ui/desktop-only.tsx'
import { DemoPanel } from '/web/ui/demo-panel.tsx'
import { ComponentsPage } from '/web/pages/components-page.tsx'
import { LandingPage } from '/web/pages/landing/landing-page.tsx'
import { landingPaths } from '/web/lib/section-scroll.ts'
import { LoginPage, SignupPage } from '/web/pages/auth/auth-pages.tsx'
import { memberStatus } from '/web/lib/member-store.ts'
import { AssessmentsPage } from '/web/pages/recruiter/assessments-page.tsx'
import { NewAssessmentPage } from '/web/pages/recruiter/new-assessment-page.tsx'
import { ReviewPage } from '/web/pages/recruiter/review-page.tsx'
import { AssessmentPage } from '/web/pages/recruiter/assessment-page.tsx'
import { ConsentPage } from '/web/pages/candidate/consent-page.tsx'
import { WorkspacePage } from '/web/pages/workspace/workspace-page.tsx'
import { RulesPage } from '/web/pages/candidate/rules-page.tsx'
import { QuestionsPage } from '/web/pages/questions/questions-page.tsx'
import { DonePage } from '/web/pages/candidate/done-page.tsx'
import { ReportPage } from '/web/pages/report/report-page.tsx'
import '/web/ui/themetoggle.tsx'

Object.assign(globalThis, { h, Fragment })
setup({
  darkMode: 'class',
  preflight: (preflight) => ({
    ...preflight,
    '@import':
      `url('https://fonts.googleapis.com/css2?family=Unbounded:wght@500;600;700&family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,600;12..96,700&family=Space+Mono:wght@400;700&display=swap')`,
    ...customClasses,
    // `@apply placeholder:…` gives an invalid `:placeholder` selector
    '.input::placeholder': { color: 'var(--color-content-tertiary)' },
    ...buildPreflightTokens(),
  }),
  props: { tw: true },
  theme: {
    extend: {
      colors: { ...tailwindColors, ...semanticColors.colors },
      // named templates: Twind ignores arbitrary grid-cols-[…] values
      gridTemplateColumns: {
        'form-preview': 'minmax(0,3fr) minmax(0,2fr)',
        'wide-narrow': 'minmax(0,1.3fr) minmax(0,1fr)',
        'split': 'minmax(0,1.4fr) minmax(0,1fr)',
        'nav-main': '168px minmax(0,1fr)',
        // R6: anchors · content (880 px max) · sticky decision column
        'report': '168px minmax(0,880px) 280px',
        'report-md': 'minmax(0,1fr) 264px',
        'cards': 'repeat(auto-fill, minmax(min(340px, 100%), 1fr))',
        'checks': 'repeat(auto-fit, minmax(180px, 1fr))',
      },
    },
    fontFamily: {
      // same type system as wurus.app
      main: ['Bricolage Grotesque', 'system-ui', 'sans-serif'],
      display: ['Unbounded', 'Bricolage Grotesque', 'sans-serif'],
      mono: ['Space Mono', 'ui-monospace', 'monospace'],
      brand: ['Nasalization Rg', 'Unbounded', 'sans-serif'],
    },
    animation: {
      spin: 'dfd-spin .8s linear infinite',
      blink: 'dfd-blink 1s step-end infinite',
    },
  },
})

// Screens replace their placeholder as they get implemented.
const routes: { [key: string]: () => JSX.Element | null } = {
  ...Object.fromEntries(screens.map((s) => [s.path, makePlaceholder(s)])),
  [paths.components]: ComponentsPage,
  // the landing and each of its sections (/faq…)
  ...Object.fromEntries(landingPaths.map((path) => [path, LandingPage])),
  [paths.login]: LoginPage,
  [paths.signup]: SignupPage,
  [paths.recruiter]: AssessmentsPage,
  [paths.newAssessment]: NewAssessmentPage,
  [paths.review]: ReviewPage,
  [paths.assessment]: AssessmentPage,
  [paths.report]: ReportPage,
  [paths.candidate]: ConsentPage,
  [paths.workspace]: WorkspacePage,
  [paths.rules]: RulesPage,
  [paths.questions]: QuestionsPage,
  [paths.done]: DonePage,
}

const App = () => {
  const path = url.relativePath === '' ? '/' : url.relativePath
  const RouteComponent = routes[path as keyof typeof routes]
  const screen = screens.find((s) => s.path === path)
  // the company space waits for the session: signed out, it leads to /login
  if (screen?.space === 'recruiter' && memberStatus.value !== 'in') {
    return <div tw='bg-surface-page min-h-screen' />
  }
  const showTopBar = !screen?.fullscreen
  return (
    <div tw='bg-surface-page text-content-primary min-h-screen font-main flex flex-col'>
      {showTopBar && (screen?.space === 'recruiter'
        ? <RecruiterTopBar />
        : screen?.space === 'candidate'
        ? <CandidateTopBar />
        : <PublicHeader />)}
      {!RouteComponent ? <NotFoundPage /> : screen?.fullscreen
        ? (
          <DesktopOnly>
            <RouteComponent />
          </DesktopOnly>
        )
        : <RouteComponent />}
      <DemoPanel />
      <Notifications />
    </div>
  )
}

const root = document.getElementById('app')
if (!root) throw Error('unable to find root element #app')
render(<App />, root)
root.style.opacity = '1'
