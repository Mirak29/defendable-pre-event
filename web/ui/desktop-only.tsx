import { paths } from '/web/paths.ts'
import type { ComponentChildren } from 'npm:preact'
import { DESKTOP_MIN_WIDTH, viewportWidth } from '/web/lib/viewport.ts'
import { Logo } from '/web/ui/topbar.tsx'
import { A } from '/web/lib/router-signal.ts'
import { Info } from '/web/assets/icons.tsx'
import { t } from '/web/lib/i18n.ts'

/**
 * Workspace and questions are desktop only (1280 px minimum): below that,
 * the screen is not mounted and a short explanation is shown instead.
 */
export const DesktopOnly = ({ children }: { children: ComponentChildren }) => {
  if (viewportWidth.value >= DESKTOP_MIN_WIDTH) return <>{children}</>
  return (
    <main tw='flex-1 flex flex-col items-center justify-center gap-5 px-4 py-12 text-center'>
      <Logo />
      <div tw='card max-w-[440px] w-full p-6 flex flex-col items-center gap-3'>
        <Info tw='w-6 h-6 text-content-tertiary' />
        <h1 tw='m-0 text-[18px] font-semibold'>
          {t('Écran trop étroit', 'Screen too narrow')}
        </h1>
        <p tw='m-0 text-content-secondary text-[14px]'>
          {t(
            `Cette étape de l’évaluation se passe sur un ordinateur, avec une fenêtre d’au moins ${DESKTOP_MIN_WIDTH} px de large. Agrandissez la fenêtre pour continuer.`,
            `This step of the assessment takes place on a computer, in a window at least ${DESKTOP_MIN_WIDTH} px wide. Widen the window to continue.`,
          )}
        </p>
        <p tw='m-0 font-mono text-[12px] text-content-tertiary'>
          {t('Largeur actuelle :', 'Current width:')} {viewportWidth.value} px
        </p>
        <A href={paths.home} tw='btn btn-secondary btn-sm mt-1'>
          {t('Retour à l’accueil', 'Back to home')}
        </A>
      </div>
    </main>
  )
}
