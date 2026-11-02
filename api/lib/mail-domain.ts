// Can this domain receive e-mail? Its MX records: a typo (gmial.com) or an
// invented domain is refused at sign-up. Answers are cached for 24 h; a DNS failure (no
// network) never blocks a sign-up, only a domain known to have no MX does.
import { APP_ENV, ENV } from '@01edu/api/env'
import { log } from '/api/lib/log.ts'

const DAY = 24 * 3600 * 1000
const cache = new Map<string, { hasMx: boolean; at: number }>()

/** mutable so tests can fake the DNS; off in tests unless asked */
export const mailDomainConfig = {
  enabled: ENV('EMAIL_DNS_CHECK', APP_ENV === 'test' ? '0' : '1') === '1',
  resolveMx: (domain: string) =>
    Deno.resolveDns(domain, 'MX', {
      nameServer: { ipAddr: '1.1.1.1', port: 53 },
      signal: AbortSignal.timeout(3000),
    }),
  cache,
}

/** false only when the DNS says the domain has no mail server */
export const domainReceivesMail = async (email: string) => {
  if (!mailDomainConfig.enabled) return true
  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain) return false
  const cached = cache.get(domain)
  if (cached && Date.now() - cached.at < DAY) return cached.hasMx
  try {
    const records = await mailDomainConfig.resolveMx(domain)
    // a "null MX" (RFC 7505, exchange ".") says the domain takes no e-mail
    const hasMx = records.some((r) => r.exchange.replace(/\.$/, '') !== '')
    cache.set(domain, { hasMx, at: Date.now() })
    return hasMx
  } catch (err) {
    // NXDOMAIN or no MX record: the domain cannot receive e-mail
    if (err instanceof Deno.errors.NotFound) {
      cache.set(domain, { hasMx: false, at: Date.now() })
      return false
    }
    log.warn('mail-domain-unknown', { domain, reason: String(err) })
    return true
  }
}
