import { paths } from '/web/paths.ts'
import { A, url } from '/web/lib/router-signal.ts'
import { demoMode, toggleDemo } from '/web/lib/demo.ts'
import { Building2, LogOut, Play, Presentation } from '/web/assets/icons.tsx'
import ThemeToggle from '/web/ui/themetoggle.tsx'
import { invitation, me } from '/web/lib/candidate-store.ts'
import { useState } from 'preact/hooks'
import { onSectionClick } from '/web/lib/section-scroll.ts'
import { member, memberStatus, signOut } from '/web/lib/member-store.ts'
import { t, tv } from '/web/lib/i18n.ts'
import { LangToggle } from '/web/ui/lang-toggle.tsx'

export const Logo = () => (
  <A
    href={paths.home}
    aria-label={t('Defendable, accueil', 'Defendable, home')}
    tw='flex items-center gap-2.5 sm:gap-[11px] text-content-primary no-underline'
  >
    <span tw='w-5 h-5 flex-none rounded-[5px] border-[1.5px] border-content-primary inline-flex items-center justify-center'>
      <span tw='w-2 h-2 bg-content-primary rounded-[2px]' />
    </span>
    {/* wordmark written like the WURUS one: Nasalization, caps, wide tracking */}
    <span tw='font-brand font-bold text-[15px] sm:text-[17px] leading-none uppercase tracking-[0.2em] sm:tracking-[0.24em] whitespace-nowrap'>
      Defendable
    </span>
  </A>
)

export const DemoBadge = () => (
  <span tw='badge border-accent text-accent-text bg-transparent'>
    <Presentation tw='w-3 h-3' />
    {t('Mode démo', 'Demo mode')}
  </span>
)

// a function: the labels follow the language
const anchors = () => [
  [paths.principle, t('Le principe', 'The idea')],
  [paths.how, t('Comment ça marche', 'How it works')],
  [paths.forCandidates, t('Pour les candidats', 'For candidates')],
  [paths.faq, 'FAQ'],
]

export const PublicHeader = () => {
  const [open, setOpen] = useState(false)
  return (
    <header
      class='public-header'
      tw='sticky top-0 z-40 bg-surface-elevated border-b border-border-primary'
    >
      <div tw='max-w-[1440px] mx-auto px-5 lg:px-10 py-4 flex flex-wrap items-center justify-between gap-4'>
        <Logo />
        <nav aria-label={t('Présentation', 'Overview')} class='public-links'>
          {anchors().map(([path, label]) => (
            <a
              key={path}
              href={path}
              aria-current={url.path === path ? 'location' : undefined}
              onClick={onSectionClick(path)}
            >
              {label}
            </a>
          ))}
        </nav>
        <div tw='flex items-center gap-2'>
          <LangToggle />
          <ThemeToggle />
          <A
            href={memberStatus.value === 'in' ? paths.recruiter : paths.login}
            aria-current={url.path === paths.login ? 'page' : undefined}
            tw='btn btn-primary hidden md:inline-flex'
          >
            {t('Espace entreprise', 'Company space')}
          </A>
          <button
            type='button'
            class='public-menu-button'
            tw='btn btn-secondary'
            aria-expanded={open}
            aria-controls='public-mobile-nav'
            onClick={() => setOpen(!open)}
          >
            Menu
          </button>
        </div>
        {open && (
          <nav
            id='public-mobile-nav'
            aria-label={t('Présentation mobile', 'Mobile overview')}
            class='public-mobile-nav'
            tw='w-full flex flex-col gap-4 border-t border-border-primary pt-4'
          >
            {anchors().map(([path, label]) => (
              <a
                key={path}
                href={path}
                aria-current={url.path === path ? 'location' : undefined}
                onClick={onSectionClick(path, () => setOpen(false))}
              >
                {label}
              </a>
            ))}
            <A
              href={memberStatus.value === 'in' ? paths.recruiter : paths.login}
              tw='btn btn-primary'
            >
              {t('Espace entreprise', 'Company space')}
            </A>
          </nav>
        )}
      </div>
    </header>
  )
}

// the current page of the company space is marked (colour, underline and
// aria-current); R4, R5 and R6 belong to « Mes épreuves »
const recruiterLinks = () =>
  [
    [paths.recruiter, t('Mes épreuves', 'My assessments')],
    [paths.newAssessment, t('Nouvelle épreuve', 'New assessment')],
  ] as const
const currentRecruiterLink = (path: string) =>
  path === paths.newAssessment ? paths.newAssessment : paths.recruiter

export const RecruiterTopBar = () => {
  const current = currentRecruiterLink(url.path)
  const account = member.value
  return (
    <header tw='sticky top-0 z-40 flex flex-wrap items-center justify-between gap-4 px-5 py-3 border-b border-border-primary bg-surface-elevated'>
      <Logo />
      <nav
        aria-label={t('Espace entreprise', 'Company space')}
        tw='flex items-center gap-5 text-sm'
      >
        {recruiterLinks().map(([path, label]) => (
          <A
            key={path}
            href={path}
            aria-current={current === path ? 'page' : undefined}
            tw={[
              'py-1 no-underline border-b-2',
              current === path
                ? 'text-content-primary font-semibold border-accent'
                : 'text-content-secondary border-transparent hover:text-content-primary',
            ]}
          >
            {label}
          </A>
        ))}
      </nav>
      <div tw='flex items-center gap-2'>
        {demoMode.value && <DemoBadge />}
        <button
          type='button'
          tw='btn btn-secondary'
          aria-pressed={demoMode.value}
          onClick={toggleDemo}
        >
          <Play tw='w-4 h-4' />
          {t('Démo guidée', 'Guided demo')}
        </button>
        <LangToggle />
        <ThemeToggle />
        {account && (
          <>
            <span
              tw='hidden md:inline-flex items-center gap-1.5 text-[13px] text-content-secondary max-w-[220px] truncate'
              title={`${account.member.name} · ${account.member.email}`}
            >
              <Building2 tw='w-4 h-4 flex-none' />
              {tv(account.company.name)}
            </span>
            <button
              type='button'
              data-test='logout-btn'
              tw='btn btn-ghost h-8 px-2.5 text-[13px]'
              onClick={signOut}
            >
              <LogOut tw='w-4 h-4' />
              <span tw='hidden sm:inline'>
                {t('Se déconnecter', 'Sign out')}
              </span>
            </button>
          </>
        )}
      </div>
    </header>
  )
}

export const CandidateTopBar = () => (
  <header tw='flex flex-wrap items-center justify-between gap-4 px-5 py-4 border-b border-border-primary bg-surface-elevated'>
    <Logo />
    <span tw='text-sm text-content-secondary'>
      {(url.path === paths.candidate
        ? invitation.value?.company
        : me.value?.assessment.company) ??
        t('Espace candidat', 'Candidate space')}
    </span>
    <div tw='flex items-center gap-2'>
      <LangToggle />
      <ThemeToggle />
    </div>
  </header>
)
