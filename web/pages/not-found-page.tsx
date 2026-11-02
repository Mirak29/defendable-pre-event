import { paths } from '/web/paths.ts'
import { A } from '/web/lib/router-signal.ts'
import { OctagonX } from '/web/assets/icons.tsx'
import { t } from '/web/lib/i18n.ts'

export function NotFoundPage() {
  return (
    <main tw='flex-1 flex flex-col items-center justify-center gap-4 px-8 py-24 text-center'>
      <OctagonX tw='w-8 h-8 text-content-tertiary' />
      <h1 tw='text-[22px] font-medium m-0'>
        {t('Page introuvable', 'Page not found')}
      </h1>
      <p tw='text-content-secondary m-0'>
        {t(
          'La page que vous cherchez n’existe pas.',
          'The page you are looking for does not exist.',
        )}
      </p>
      <A href={paths.home} tw='btn btn-secondary'>
        {t('Retour à l’accueil', 'Back to home')}
      </A>
    </main>
  )
}
