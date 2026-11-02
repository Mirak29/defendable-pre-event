// Independent of the schema so startup can initialize the demo member.
const iterations = Deno.env.get('APP_ENV') === 'test'
  ? Number(Deno.env.get('PASSWORD_ITERATIONS') ?? 1000)
  : 600_000
if (!Number.isSafeInteger(iterations) || iterations < 1000) {
  throw Error('PASSWORD_ITERATIONS must be an integer >= 1000')
}

export const constantTimeEqual = (a: Uint8Array, b: Uint8Array) => {
  if (a.length !== b.length) return false
  let difference = 0
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i]
  return difference === 0
}

export const hashPassword = async (
  password: string,
  salt = crypto.getRandomValues(new Uint8Array(16)),
) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  )
  const stored = new Uint8Array(48)
  stored.set(salt)
  stored.set(new Uint8Array(hash), 16)
  return stored
}

export const verifyPassword = async (password: string, stored: Uint8Array) => {
  // Demo members without an explicit password have only a random salt.
  const computed = await hashPassword(
    password,
    new Uint8Array(stored.slice(0, 16)),
  )
  return stored.length === 48 && constantTimeEqual(computed, stored)
}
