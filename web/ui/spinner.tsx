import type { Token } from 'npm:@twind/preact'
import { t } from '/web/lib/i18n.ts'

/** Small ring spinner used for running operations */
export const Spinner = ({ tw }: { tw?: Token }) => (
  <span
    role='status'
    aria-label={t('En cours', 'In progress')}
    tw={[
      'inline-block w-3 h-3 flex-none rounded-full border-2 border-accent-soft border-t-accent animate-spin',
      tw,
    ]}
  />
)
