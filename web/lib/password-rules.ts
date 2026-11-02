// Password of a company space: 10 characters, a lower case and an upper case
// letter, a digit and a special character. Shared by the API (api/member.ts
// refuses a weak password) and the sign-up page (the same rules, checked as
// one types). The labels follow the language of the page (French on the
// API, whose messages are translated at the response, api/server.ts).
import { t } from '/web/lib/i18n.ts'

export type PasswordRule = { label: string; ok: (password: string) => boolean }

export const PASSWORD_MIN = 10
export const PASSWORD_MAX = 1024

// getters: each label is read in the language of the moment
export const passwordRules: PasswordRule[] = [
  {
    get label() {
      return t(
        `${PASSWORD_MIN} caractères minimum`,
        `at least ${PASSWORD_MIN} characters`,
      )
    },
    ok: (p) => p.length >= PASSWORD_MIN,
  },
  {
    get label() {
      return t('une minuscule', 'a lower-case letter')
    },
    ok: (p) => /\p{Ll}/u.test(p),
  },
  {
    get label() {
      return t('une majuscule', 'an upper-case letter')
    },
    ok: (p) => /\p{Lu}/u.test(p),
  },
  {
    get label() {
      return t('un chiffre', 'a digit')
    },
    ok: (p) => /\d/.test(p),
  },
  {
    get label() {
      return t(
        'un caractère spécial (! ? - _ …)',
        'a special character (! ? - _ …)',
      )
    },
    ok: (p) => /[^\p{L}\p{N}]/u.test(p),
  },
]

/** the first rule the password breaks, as a sentence; undefined when strong */
export const passwordProblem = (password: string) => {
  if (password.length > PASSWORD_MAX) {
    return t(
      `Le mot de passe doit contenir ${PASSWORD_MAX} caractères au plus.`,
      `The password must contain at most ${PASSWORD_MAX} characters.`,
    )
  }
  const missing = passwordRules.filter((r) => !r.ok(password))
  if (!missing.length) return
  const rules = missing.map((r) => r.label).join(', ')
  return t(
    `Le mot de passe doit contenir ${rules}.`,
    `The password must contain ${rules}.`,
  )
}
