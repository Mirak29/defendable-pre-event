import { paths } from '/web/paths.ts'
import { A } from '/web/lib/router-signal.ts'
import { startDemo } from '/web/ui/demo-panel.tsx'
import { ArrowRight, Play } from '/web/assets/icons.tsx'
import { Logo } from '/web/ui/topbar.tsx'
import { WorkflowIllustration } from './workflow-illustration.tsx'
import { LandingSections } from './landing-sections.tsx'
import { useSectionUrl } from '/web/lib/section-scroll.ts'
import { t } from '/web/lib/i18n.ts'

export const LandingPage = () => {
  useSectionUrl()
  return (
    <main class='landing' data-test='landing'>
      <section class='landing-hero' aria-labelledby='landing-title'>
        <div>
          <p class='landing-eyebrow'>
            {t(
              'LE CODE EST UN DÉBUT. LA COMPRÉHENSION FAIT LA DIFFÉRENCE.',
              'CODE IS A START. UNDERSTANDING MAKES THE DIFFERENCE.',
            )}
          </p>
          <h1 id='landing-title'>
            {t(
              'Tout le monde peut livrer du code avec l’IA.',
              'Anyone can ship code with AI.',
            )}
            <br />
            {t('Nous vous montrons', 'We show you')}
            <br />
            <span tw='text-accent-text'>
              {t('qui le comprend.', 'who understands it.')}
            </span>
          </h1>
          <p class='landing-intro'>
            {t(
              'Une épreuve technique générée depuis votre offre, passée avec l’IA, puis défendue par le candidat sur son propre code. Le rapport sépare les faits vérifiés des interprétations. Aucun score global : la décision vous revient.',
              'A technical assessment generated from your job offer, taken with AI, then defended by the candidates on their own code. The report separates verified facts from interpretations. No overall score: the decision is yours.',
            )}
          </p>
          <div tw='flex flex-wrap gap-3 mt-7'>
            <A
              href={paths.recruiter}
              data-test='landing-signup-btn'
              tw='btn btn-primary h-11 px-5'
            >
              {t('Espace entreprise', 'Company space')}
              <ArrowRight tw='w-4 h-4' />
            </A>
            <button
              type='button'
              data-test='landing-demo-btn'
              tw='btn btn-secondary h-11 px-5'
              onClick={startDemo}
            >
              <Play tw='w-4 h-4' />
              {t('Essayer la démo guidée', 'Try the guided demo')}
            </button>
          </div>
          <p tw='mt-4 text-xs text-content-secondary'>
            {t(
              'IA autorisée. Preuves visibles. Décision humaine.',
              'AI allowed. Visible evidence. Human decision.',
            )}
          </p>
        </div>
        <WorkflowIllustration />
      </section>
      <LandingSections />
      <section class='landing-final' aria-labelledby='final-title'>
        <p class='landing-eyebrow'>
          {t(
            'VOTRE PROCHAINE RENCONTRE TECHNIQUE',
            'YOUR NEXT TECHNICAL INTERVIEW',
          )}
        </p>
        <h2 id='final-title'>
          {t('Passez du code livré', 'Move from shipped code')}
          <br />
          {t('à une discussion éclairée.', 'to an informed discussion.')}
        </h2>
        <p tw='text-content-secondary my-5'>
          {t(
            'Votre offre devient une épreuve. Les faits ouvrent la conversation.',
            'Your job offer becomes an assessment. The facts open the conversation.',
          )}
        </p>
        <A href={paths.recruiter} tw='btn btn-primary h-11 px-5'>
          {t('Créer une épreuve', 'Create an assessment')}
          <ArrowRight tw='w-4 h-4' />
        </A>
      </section>
      <footer tw='border-t border-border-primary py-8 flex flex-wrap items-center justify-between gap-5'>
        <Logo />
        <span tw='text-xs text-content-secondary'>
          {t('Le dernier mot reste humain.', 'The last word stays human.')}
        </span>
        <button type='button' tw='btn btn-ghost' onClick={startDemo}>
          {t('Démo guidée', 'Guided demo')}
        </button>
      </footer>
    </main>
  )
}
