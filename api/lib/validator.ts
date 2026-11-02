// Validators for JSON values the router cannot describe with OBJ/ARR (the
// assessment spec, candidate files…): typed for the client, checked by our
// own code (api/lib/check.ts) when they come from outside.
import { assertFiles } from '/api/sandbox.ts'

type DefJson<T> = {
  type: 'object'
  properties: Record<string, never>
  report: (
    value: unknown,
  ) => { path: string[]; type: 'object'; value: unknown }[]
  optional?: boolean
  description?: string
  assert: (value: unknown) => T
}

/** `check` throws on an invalid value: the router answers 400 */
export const JSON_OF = <T>(
  description: string,
  check: (value: unknown) => T = (value) => value as T,
): DefJson<T> => {
  const report = (value: unknown) => {
    try {
      check(value)
      return []
    } catch (err) {
      return [{
        path: [err instanceof Error ? err.message : String(err)],
        type: 'object' as const,
        value,
      }]
    }
  }
  return {
    type: 'object',
    properties: {},
    description,
    report,
    assert: check,
  }
}

/** { "src/app.ts": "…" } */
export const FILES = JSON_OF<Record<string, string>>(
  'Files of the candidate, by path',
  (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw Error('files doit être un objet')
    }
    for (const [path, code] of Object.entries(value)) {
      if (typeof code !== 'string') throw Error(`${path} doit être du texte`)
    }
    // the rules of the sandbox, at the door: an invalid file is refused
    // before being saved or frozen by the submission (AUD-006)
    return assertFiles(value as Record<string, string>)
  },
)
