import { db, sql } from '@01edu/db'
import { respond } from '@01edu/api/response'
import { Company, demoMemberId, Entry, Member } from '/api/schema.ts'
import { emailEnabled } from '/api/email.ts'
import { domainReceivesMail } from '/api/lib/mail-domain.ts'
import { passwordProblem } from '/web/lib/password-rules.ts'
import {
  constantTimeEqual,
  hashPassword,
  verifyPassword,
} from '/api/password.ts'
export { hashPassword, verifyPassword } from '/api/password.ts'

export const SESSION_SECONDS = 14 * 24 * 60 * 60
export type MemberSession = {
  entryId: number
  memberId: number
  companyId: number
  createdAt: number
}
export type MemberView = {
  member: { id: number; name: string; email: string }
  company: { id: number; name: string }
  demo: boolean
  /** the personal link can be e-mailed (RESEND_API_KEY) */
  canEmail: boolean
}
const b64 = { alphabet: 'base64url' as const, omitPadding: true }
const encoder = new TextEncoder()
const byEmail = Member.sql<
  keyof typeof Member.properties,
  string
>`SELECT * FROM member WHERE memberEmail = ?`.get
const failureCount = sql<{ count: number }, { email: string; since: number }>`
  SELECT count(*) AS count FROM entryInternal
  WHERE type = ${Entry.type.MEMBER_LOGIN_FAILED}
    AND createdAt > :since AND json_extract(data, '$.email') = :email
`.get
sql`CREATE INDEX IF NOT EXISTS member_failed_login ON entryInternal(type, createdAt) WHERE type = ${Entry.type.MEMBER_LOGIN_FAILED}`
  .run()

const invalidCredentials = () =>
  new respond.UnauthorizedError({
    message: 'E-mail ou mot de passe incorrect.',
  })
/** a refused field: the sign-up page shows the message on that input */
const badField = (input: string, message: string): never => {
  throw new respond.BadRequestError({ message, input })
}

const bounded = (
  value: string,
  label: string,
  max: number,
  input?: string,
) => {
  const clean = value.trim()
  if (!clean || clean.length > max) {
    const message = !clean
      ? `${label} : champ obligatoire.`
      : `${label} : ${max} caractères au plus.`
    if (input) badField(input, message)
    throw new respond.BadRequestError({ message: `${label} invalide.` })
  }
  return clean
}

const signature = async (salt: Uint8Array, bytes: Uint8Array) => {
  const buffer = new Uint8Array(16 + bytes.length)
  buffer.set(salt.slice(0, 16))
  buffer.set(bytes, 16)
  return new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))
}

export const generateSession = async (memberId: number) => {
  const member = Member.require(memberId)
  const entryId = Entry.insert.MEMBER_LOGIN({
    memberId,
    companyId: member.companyId,
  })
  const bytes = encoder.encode(String(entryId))
  const hash = await signature(member.memberPassword, bytes)
  return `${bytes.toBase64(b64)}:${hash.toBase64(b64)}`
}

const sessionRow = sql<MemberSession & { memberPassword: Uint8Array }, number>`
  SELECT e.id AS entryId, e.memberId, m.companyId, e.createdAt, m.memberPassword
  FROM entryInternal e JOIN member m ON m.memberId = e.memberId
  WHERE e.id = ? AND e.type = ${Entry.type.MEMBER_LOGIN} AND e.archivedAt IS NULL
`.get
export const decodeSession = async (
  token?: string,
): Promise<MemberSession | undefined> => {
  if (!token || token.length > 160) return
  try {
    const parts = token.split(':')
    if (parts.length !== 2) return
    const bytes = Uint8Array.fromBase64(parts[0], b64)
    const text = new TextDecoder().decode(bytes)
    if (!/^[1-9]\d*$/.test(text)) return
    const id = Number(text)
    if (!Number.isSafeInteger(id)) return
    const row = sessionRow(id)
    if (!row || row.createdAt + SESSION_SECONDS <= Date.now() / 1000) return
    const hash = Uint8Array.fromBase64(parts[1], b64)
    if (!constantTimeEqual(hash, await signature(row.memberPassword, bytes))) {
      return
    }
    const { memberPassword: _password, ...session } = row
    return session
  } catch {
    return
  }
}
export const logout = (session: MemberSession) => Entry.archive(session.entryId)
export const memberView = (memberId: number): MemberView => {
  const member = Member.require(memberId)
  const company = Company.require(member.companyId)
  return {
    member: {
      id: memberId,
      name: member.memberName,
      email: member.memberEmail,
    },
    company: { id: company.companyId, name: company.companyName },
    demo: memberId === demoMemberId,
    canEmail: emailEnabled(),
  }
}

const insertCompany = db.transaction(
  (companyName: string, name: string, email: string, password: Uint8Array) => {
    if (byEmail(email)) {
      throw new respond.ConflictError({
        message: 'Cet e-mail est déjà utilisé.',
        input: 'email',
      })
    }
    const companyId = Company.insert({
      companyName,
      companyCreatedAt: Date.now(),
    })
    const memberId = Member.insert({
      companyId,
      memberName: name,
      memberEmail: email,
      memberPassword: password,
      memberCreatedAt: Date.now(),
    })
    Entry.insert.COMPANY_CREATED({ companyId })
    Entry.insert.MEMBER_CREATED({ companyId, memberId })
    return memberId
  },
)
/** format, length and a domain that receives mail */
const validEmail = async (raw: string) => {
  const email = bounded(raw, 'E-mail', 254, 'email').toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    badField('email', 'E-mail invalide : vérifiez son format (nom@domaine.fr).')
  }
  if (!await domainReceivesMail(email)) {
    badField(
      'email',
      `Le domaine « ${
        email.split('@')[1]
      } » ne reçoit pas d’e-mails : vérifiez l’adresse.`,
    )
  }
  return email
}

export const createCompany = async (
  input: {
    companyName: string
    name: string
    email: string
    password: string
    /** the sign-up page always sends it; checked when present */
    confirmPassword?: string | null
  },
) => {
  const companyName = bounded(
    input.companyName,
    'Nom de l’entreprise',
    160,
    'companyName',
  )
  const name = bounded(input.name, 'Nom', 160, 'name')
  const problem = passwordProblem(input.password)
  if (problem) badField('password', problem)
  if (
    input.confirmPassword != null && input.confirmPassword !== input.password
  ) {
    badField('confirmPassword', 'Les deux mots de passe ne correspondent pas.')
  }
  const email = await validEmail(input.email)
  const password = await hashPassword(input.password)
  return insertCompany(companyName, name, email, password)
}

// Count in-flight verifications too: concurrent requests cannot bypass the cap.
const pending = new Map<string, number>()
const dummy = crypto.getRandomValues(new Uint8Array(48))
export const authenticate = async (rawEmail: string, password: string) => {
  if (rawEmail.length > 254 || password.length > 1024) {
    throw invalidCredentials()
  }
  const email = rawEmail.trim().toLowerCase()
  const failures =
    failureCount({ email, since: Date.now() / 1000 - 15 * 60 })?.count ?? 0
  if (failures + (pending.get(email) ?? 0) >= 10) {
    throw new respond.TooManyRequestsError({
      message: 'Trop de tentatives. Réessayez dans 15 minutes.',
    })
  }
  pending.set(email, (pending.get(email) ?? 0) + 1)
  try {
    const member = byEmail(email)
    const valid = await verifyPassword(
      password,
      member?.memberPassword ?? dummy,
    )
    if (!member || !valid) {
      Entry.insert.MEMBER_LOGIN_FAILED({ data: { email } })
      throw invalidCredentials()
    }
    return await generateSession(member.memberId)
  } finally {
    const count = (pending.get(email) ?? 1) - 1
    count ? pending.set(email, count) : pending.delete(email)
  }
}
