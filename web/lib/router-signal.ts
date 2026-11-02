export { navigate, replaceParams, url } from '@01edu/signal-router'

import type { JSX } from 'preact'
import type { Token } from 'npm:@twind/preact'
import { A as RouterA } from '@01edu/signal-router'
import type { LinkProps as RouterLinkProps } from '@01edu/signal-router'

/* tw prop support */
export type LinkProps = RouterLinkProps & {
  tw?: Token
}

export const A = (props: LinkProps): JSX.Element => {
  const { tw, class: className, ...rest } = props
  const finalClass = typeof tw === 'string'
    ? tw
    : Array.isArray(tw)
    ? tw.join(' ')
    : className
  return RouterA({ ...rest, class: finalClass })
}
