// U3: sign in and create a company space (tournament's login and register
// pages). The candidate never signs in: they only open their link.
import { useSignal } from '@preact/signals'
import { ErrorWithData } from '@01edu/api-client'
import { api } from '/web/lib/api.ts'
import { A } from '/web/lib/router-signal.ts'
import { paths } from '/web/paths.ts'
import { demoAvailable, enterDemo, setMember } from '/web/lib/member-store.ts'
import { Input, Label } from '/web/ui/form.tsx'
import { Check, CircleX, Eye, EyeOff, Minus, Play } from '/web/assets/icons.tsx'
import { passwordProblem, passwordRules } from '/web/lib/password-rules.ts'
import { t } from '/web/lib/i18n.ts'

const login = api['POST/api/login'].signal()
const signup = api['POST/api/signup'].signal()

const Card = (
  { title, intro, children }: {
    title: string
    intro: string
    children: preact.ComponentChildren
  },
) => (
  <main tw='flex-1 w-full max-w-[440px] mx-auto px-4 py-12 sm:py-20'>
    <h1 tw='m-0 text-[26px] font-semibold'>{title}</h1>
    <p tw='mt-2 mb-7 text-[14px] text-content-secondary'>{intro}</p>
    {children}
  </main>
)

const FormError = ({ message }: { message?: string }) =>
  message
    ? (
      <p
        role='alert'
        tw='m-0 flex items-start gap-2 text-[13px] text-err'
      >
        <CircleX tw='w-4 h-4 flex-none mt-px' />
        {message}
      </p>
    )
    : null

/** a message of the server about one field, on that field */
const clearValidity = (e: Event) =>
  (e.currentTarget as HTMLInputElement).setCustomValidity('')

const reportOn = (form: HTMLFormElement, input: string, message: string) => {
  const el = form.elements.namedItem(input)
  if (!(el instanceof HTMLInputElement)) return
  el.setCustomValidity(message)
  el.reportValidity()
}

/** the rules of the password, checked as one types: an icon and a label */
const PasswordRules = ({ password }: { password: string }) => (
  <ul
    id='password-rules'
    data-test='password-rules'
    tw='m-0 p-0 list-none grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1 text-[12.5px]'
  >
    {passwordRules.map((rule) => {
      const ok = rule.ok(password)
      return (
        <li
          key={rule.label}
          tw={[
            'flex items-center gap-1.5',
            ok ? 'text-ok' : 'text-content-secondary',
          ]}
        >
          {ok
            ? <Check tw='w-3.5 h-3.5 flex-none' />
            : <Minus tw='w-3.5 h-3.5 flex-none' />}
          <span>
            {rule.label}
            <span tw='sr-only'>
              {ok ? t(' : respecté', ': met') : t(' : manquant', ': missing')}
            </span>
          </span>
        </li>
      )
    })}
  </ul>
)

const PasswordField = (
  { name, label, hint, autocomplete, onInput, describedBy }: {
    name: string
    label: string
    hint?: string
    autocomplete: string
    onInput?: (e: Event) => void
    describedBy?: string
  },
) => {
  const shown = useSignal(false)
  const Icon = shown.value ? EyeOff : Eye
  return (
    <div tw='flex flex-col gap-1.5'>
      <Label for={name}>{label}</Label>
      <div tw='relative'>
        <Input
          name={name}
          type={shown.value ? 'text' : 'password'}
          required
          autocomplete={autocomplete}
          data-test={`${name === 'password' ? 'auth' : name}-password`}
          tw='w-full pr-10'
          aria-describedby={describedBy}
          onInput={(e) => {
            clearValidity(e)
            onInput?.(e)
          }}
        />
        <button
          type='button'
          tw='absolute right-1 top-1 h-[26px] w-8 inline-flex items-center justify-center text-content-secondary hover:text-content-primary'
          aria-label={shown.value
            ? t('Masquer le mot de passe', 'Hide the password')
            : t('Afficher le mot de passe', 'Show the password')}
          aria-pressed={shown.value}
          onClick={() => shown.value = !shown.value}
        >
          <Icon tw='w-4 h-4' />
        </button>
      </div>
      {hint && <span tw='text-[12px] text-content-secondary'>{hint}</span>}
    </div>
  )
}

const Field = ({ name, label, type = 'text', autocomplete }: {
  name: string
  label: string
  type?: string
  autocomplete: string
}) => (
  <div tw='flex flex-col gap-1.5'>
    <Label for={name}>{label}</Label>
    <Input
      name={name}
      type={type}
      required
      autocomplete={autocomplete}
      data-test={`auth-${name}`}
      onInput={clearValidity}
    />
  </div>
)

/** « Essayer la démo »: signs in the demo member, then the company space */
export const DemoAccess = () => {
  const failed = useSignal('')
  if (!demoAvailable.value) return null
  return (
    <div tw='mt-8 pt-6 border-t border-border-primary flex flex-col gap-3'>
      <p tw='m-0 text-[13px] text-content-secondary'>
        {t(
          'Découvrir Defendable sans créer de compte, avec l’épreuve de démo.',
          'Discover Defendable without an account, with the demo assessment.',
        )}
      </p>
      <button
        type='button'
        data-test='demo-login-btn'
        tw='btn btn-secondary h-10 self-start'
        onClick={async () => {
          // signed in: the guard of member-store opens the requested page
          try {
            await enterDemo()
          } catch (err) {
            failed.value = err instanceof Error ? err.message : String(err)
          }
        }}
      >
        <Play tw='w-4 h-4' />
        {t('Essayer avec le compte démo', 'Try with the demo account')}
      </button>
      <FormError message={failed.value} />
    </div>
  )
}

const text = (form: FormData, name: string) => String(form.get(name) ?? '')

export const LoginPage = () => (
  <Card
    title={t('Espace entreprise', 'Company space')}
    intro={t(
      'Connectez-vous pour créer vos épreuves et lire les rapports de vos candidats.',
      'Sign in to create your assessments and read your candidates’ reports.',
    )}
  >
    <form
      tw='flex flex-col gap-4'
      onSubmit={async (e) => {
        e.preventDefault()
        if (login.pending) return
        const form = new FormData(e.currentTarget)
        await login.fetch({
          email: text(form, 'email'),
          password: text(form, 'password'),
        })
        const data = login.$.peek().data
        if (data) setMember(data) // the guard opens the requested page
      }}
    >
      <Field
        name='email'
        label='E-mail'
        type='email'
        autocomplete='email'
      />
      <PasswordField
        name='password'
        label={t('Mot de passe', 'Password')}
        autocomplete='current-password'
      />
      <FormError message={login.error?.message} />
      <button
        type='submit'
        data-test='login-btn'
        tw='btn btn-primary h-10'
        disabled={!!login.pending}
      >
        {login.pending
          ? t('Connexion…', 'Signing in…')
          : t('Se connecter', 'Sign in')}
      </button>
    </form>
    <p tw='mt-5 text-[13.5px] text-content-secondary'>
      {t('Pas encore d’espace ?', 'No space yet?')}{' '}
      <A href={paths.signup} tw='text-accent-text'>
        {t('Créer un espace entreprise', 'Create a company space')}
      </A>
    </p>
    <DemoAccess />
  </Card>
)

export const SignupPage = () => {
  const password = useSignal('')
  const confirm = useSignal('')
  const mismatch = !!confirm.value && confirm.value !== password.value
  const fieldError = signup.error instanceof ErrorWithData &&
    typeof signup.error.data.input === 'string'
  return (
    <Card
      title={t('Créer un espace entreprise', 'Create a company space')}
      intro={t(
        'Votre espace réunit vos épreuves et les rapports de vos candidats. Les candidats, eux, n’ont pas de compte : ils reçoivent un lien.',
        'Your space gathers your assessments and your candidates’ reports. Candidates have no account: they receive a link.',
      )}
    >
      <form
        tw='flex flex-col gap-4'
        onSubmit={async (e) => {
          e.preventDefault()
          if (signup.pending) return
          const el = e.currentTarget
          const form = new FormData(el)
          // the same rules as the API, said on the field before any request
          const problem = passwordProblem(text(form, 'password'))
          if (problem) return reportOn(el, 'password', problem)
          if (text(form, 'password') !== text(form, 'confirmPassword')) {
            return reportOn(
              el,
              'confirmPassword',
              t(
                'Les deux mots de passe ne correspondent pas.',
                'The two passwords do not match.',
              ),
            )
          }
          await signup.fetch({
            companyName: text(form, 'companyName'),
            name: text(form, 'name'),
            email: text(form, 'email'),
            password: text(form, 'password'),
            confirmPassword: text(form, 'confirmPassword'),
          })
          const { data, error } = signup.$.peek()
          if (data) return setMember(data) // the guard opens the space
          // a refused field: its message on it
          if (error instanceof ErrorWithData) {
            const input = error.data.input
            if (typeof input === 'string') reportOn(el, input, error.message)
          }
        }}
      >
        <Field
          name='companyName'
          label={t('Nom de l’entreprise', 'Company name')}
          autocomplete='organization'
        />
        <Field
          name='name'
          label={t('Votre nom', 'Your name')}
          autocomplete='name'
        />
        <Field
          name='email'
          label={t('E-mail professionnel', 'Work e-mail')}
          type='email'
          autocomplete='email'
        />
        <div tw='flex flex-col gap-2'>
          <PasswordField
            name='password'
            label={t('Mot de passe', 'Password')}
            autocomplete='new-password'
            describedBy='password-rules'
            onInput={(e) =>
              password.value = (e.currentTarget as HTMLInputElement).value}
          />
          <PasswordRules password={password.value} />
        </div>
        <div tw='flex flex-col gap-1.5'>
          <PasswordField
            name='confirmPassword'
            label={t('Confirmer le mot de passe', 'Confirm the password')}
            autocomplete='new-password'
            describedBy='confirm-status'
            onInput={(e) =>
              confirm.value = (e.currentTarget as HTMLInputElement).value}
          />
          <span
            id='confirm-status'
            aria-live='polite'
            data-test='confirm-status'
            tw={[
              'flex items-center gap-1.5 text-[12.5px] min-h-[18px]',
              mismatch ? 'text-err' : 'text-ok',
            ]}
          >
            {mismatch && (
              <>
                <CircleX tw='w-3.5 h-3.5 flex-none' />
                {t(
                  'Les deux mots de passe ne correspondent pas.',
                  'The two passwords do not match.',
                )}
              </>
            )}
            {!mismatch && confirm.value && (
              <>
                <Check tw='w-3.5 h-3.5 flex-none' />
                {t('Les mots de passe correspondent.', 'The passwords match.')}
              </>
            )}
          </span>
        </div>
        <FormError message={fieldError ? undefined : signup.error?.message} />
        <button
          type='submit'
          data-test='signup-btn'
          tw='btn btn-primary h-10'
          disabled={!!signup.pending}
        >
          {signup.pending
            ? t('Création…', 'Creating…')
            : t('Créer l’espace', 'Create the space')}
        </button>
      </form>
      <p tw='mt-5 text-[13.5px] text-content-secondary'>
        {t('Déjà un espace ?', 'Already have a space?')}{' '}
        <A href={paths.login} tw='text-accent-text'>
          {t('Se connecter', 'Sign in')}
        </A>
      </p>
    </Card>
  )
}
