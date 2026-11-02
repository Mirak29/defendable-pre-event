// Small validators for model answers: they throw readable French errors,
// sent back to the model for one corrected attempt (api/llm.ts).

type Obj = Record<string, unknown>

export const obj = (v: unknown, path: string): Obj => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    throw Error(`${path} doit être un objet`)
  }
  return v as Obj
}

/** A text too long for the UI is shortened, never a reason to reject */
export const str = (v: unknown, path: string, max = 2000): string => {
  if (typeof v !== 'string' || !v.trim()) {
    throw Error(`${path} doit être une chaîne non vide`)
  }
  const text = v.trim()
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`
}

export const optStr = (v: unknown, path: string, max = 2000) =>
  v == null || v === '' ? undefined : str(v, path, max)

export const num = (v: unknown, path: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw Error(`${path} doit être un nombre`)
  }
  return v
}

export const bool = (v: unknown, path: string): boolean => {
  if (typeof v !== 'boolean') throw Error(`${path} doit être un booléen`)
  return v
}

export const oneOf = <const T extends readonly (string | number)[]>(
  v: unknown,
  values: T,
  path: string,
): T[number] => {
  if (!values.includes(v as T[number])) {
    throw Error(
      `${path} doit valoir ${values.map((x) => `« ${x} »`).join(', ')}`,
    )
  }
  return v as T[number]
}

/**
 * `clip`: a list longer than `max` keeps its first items instead of
 * rejecting the whole answer (like a text too long for the UI)
 */
export const arr = <T>(
  v: unknown,
  path: string,
  item: (v: unknown, path: string) => T,
  { min = 0, max = 50, clip = false } = {},
): T[] => {
  if (!Array.isArray(v)) throw Error(`${path} doit être un tableau`)
  if (v.length < min) {
    throw Error(`${path} doit contenir au moins ${min} éléments`)
  }
  if (v.length > max && !clip) {
    throw Error(`${path} contient plus de ${max} éléments`)
  }
  return v.slice(0, max).map((x, i) => item(x, `${path}[${i}]`))
}

/** `str` for array items */
export const strItem = (v: unknown, path: string) => str(v, path)

/**
 * Items a result can do without (a claim, a signal): an invalid one is
 * dropped instead of failing the whole answer, extra ones are cut.
 */
export const validItems = <T>(
  v: unknown,
  path: string,
  item: (v: unknown, path: string) => T,
  max = 50,
): T[] =>
  Array.isArray(v)
    ? v.slice(0, max).flatMap((x, i) => {
      try {
        return [item(x, `${path}[${i}]`)]
      } catch {
        return []
      }
    })
    : []

const loose = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase()

/**
 * `oneOf` that forgives the slips of a model: accents, case, gender or
 * number ("élevé" for "élevée", "Démontrée" for "Démontré"), and synonyms
 */
export const oneOfLoose = <const T extends readonly string[]>(
  v: unknown,
  values: T,
  path: string,
  synonyms: Record<string, T[number]> = {},
): T[number] => {
  if (typeof v === 'string') {
    const key = loose(v)
    const synonym = Object.entries(synonyms).find(([k]) => loose(k) === key)
    if (synonym) return synonym[1]
    const match = values.find((x) => {
      const value = loose(x)
      return value === key ||
        (Math.min(value.length, key.length) >= 4 &&
          (value.startsWith(key) || key.startsWith(value)))
    })
    if (match) return match
  }
  return oneOf(v, values, path)
}
